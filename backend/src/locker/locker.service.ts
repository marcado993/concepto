import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { LockerRental } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { OcrService } from "../shared/ocr/ocr.service";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { calculateLockerPrice, PaymentMethod } from "./rental-calculator";
import { receiptMentionsAmount } from "./receipt-validator";

// Precio base semestral — configurable porque el sponsor puede fijarlo
// entre $5.50 y $9.00 según utilidad objetivo (ver rental-calculator.ts).
// $6.50 es el valor de partida ya usado hoy por AEIS, no un techo.
export const DEFAULT_LOCKER_BASE_PRICE = 6.5;

export class LockerUnavailableError extends ConflictException {
  constructor(lockerCode: string) {
    super(`El casillero ${lockerCode} ya no está disponible para este periodo`);
  }
}

export interface RentLockerParams {
  userId: string;
  lockerCode: string;
  method: PaymentMethod;
  ipAddress?: string;
}

@Injectable()
export class LockerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payphone: PayphoneClient,
    private readonly ocr: OcrService
  ) {}

  // Resolución mínima del periodo activo — hasta que exista un PeriodService
  // real (ver TODO en locker.controller.ts), se toma el periodo vigente o
  // más próximo por fecha en vez de exigir que el cliente lo mande. "Vigente
  // o próximo" (no solo "vigente") a propósito: el alquiler para el
  // semestre 2026-B debe poder abrirse antes de que arranque el 1 de
  // septiembre, no solo durante sus fechas exactas.
  private async getCurrentPeriodId(): Promise<string> {
    const period = await this.prisma.period.findFirst({
      where: { endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    if (!period) throw new NotFoundException("No hay un periodo activo configurado para alquilar casilleros");
    return period.id;
  }

  list() {
    return this.prisma.locker.findMany({
      select: { id: true, code: true, zone: true, status: true },
      orderBy: [{ zone: "asc" }, { code: "asc" }],
    });
  }

  async rent(params: RentLockerParams) {
    const locker = await this.prisma.locker.findUnique({ where: { code: params.lockerCode } });
    if (!locker) throw new NotFoundException(`Casillero ${params.lockerCode} no existe`);

    const periodId = await this.getCurrentPeriodId();
    const price = calculateLockerPrice(DEFAULT_LOCKER_BASE_PRICE, params.method);

    return executeMoneyMutation<LockerRental>(
      { prisma: this.prisma, audit: this.audit, payphone: this.payphone },
      {
        userId: params.userId,
        amount: price.amount,
        method: params.method,
        ipAddress: params.ipAddress,
        auditAction: "locker.rental.created",
        auditEntityType: "LockerRental",
        entityId: (rental) => rental.id,
        auditMetadata: () => ({ lockerCode: params.lockerCode }),
        // La restricción @@unique([lockerId, periodId]) en el esquema es la
        // que de verdad impide la doble-reserva bajo concurrencia real —
        // el chequeo de `locker.status` de arriba es solo el camino feliz,
        // no la garantía (ver escenario BDD "condición de carrera",
        // docs/dominio/05-metodologia-devsecops-pipeline.md §2).
        createEntity: async (tx, paymentId) => {
          const rental = await tx.lockerRental.create({
            data: { lockerId: locker.id, userId: params.userId, periodId, paymentId },
          });
          await tx.locker.update({
            where: { id: locker.id },
            data: { status: params.method === "PAYPHONE" ? "RENTED" : "RESERVED" },
          });
          return rental;
        },
        onConflict: () => {
          throw new LockerUnavailableError(params.lockerCode);
        },
      }
    );
  }

  // Confirmación de comprobante de transferencia — el paso que faltaba
  // para que un alquiler TRANSFER pase de RESERVED a RENTED (ver comentario
  // en `rent()` y el escenario BDD en locker.service.spec.ts). El OCR es un
  // filtro de primera línea, no una aprobación bancaria real — por eso
  // igual queda todo en AuditLog.metadata (incluida la razón de un
  // rechazo), para que sea revisable a mano si algo no calza.
  async confirmReceipt(rentalId: string, userId: string, receiptImage: Buffer, ipAddress?: string) {
    const rental = await this.prisma.lockerRental.findUnique({
      where: { id: rentalId },
      include: { payment: true, locker: true },
    });
    if (!rental) throw new NotFoundException("Alquiler no encontrado");
    if (rental.userId !== userId) throw new ForbiddenException("Este alquiler no te pertenece");
    if (rental.payment.method !== "TRANSFER") {
      throw new BadRequestException("Este alquiler no requiere confirmación de comprobante");
    }
    if (rental.payment.status !== "PENDING") {
      throw new BadRequestException("Este comprobante ya fue procesado");
    }

    const ocrText = await this.ocr.extractText(receiptImage);
    const amount = Number(rental.payment.amount);
    const valid = receiptMentionsAmount(ocrText, amount);

    if (!valid) {
      await this.audit.record({
        actorId: userId,
        action: "locker.receipt.rejected",
        entityType: "LockerRental",
        entityId: rental.id,
        ipAddress,
        metadata: { reason: "monto_no_coincide", expectedAmount: amount },
      });
      throw new BadRequestException(
        "No pudimos confirmar el monto en el comprobante — verifica que la foto sea legible e intenta de nuevo"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: rental.paymentId },
        data: { status: "CONFIRMED", confirmedAt: new Date(), providerRef: `receipt-${rental.id}` },
      });
      const updatedLocker = await tx.locker.update({
        where: { id: rental.lockerId },
        data: { status: "RENTED" },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: "locker.receipt.confirmed",
          entityType: "LockerRental",
          entityId: rental.id,
          ipAddress,
          metadata: { amount },
        },
        tx
      );
      return { rental, locker: updatedLocker };
    });
  }
}
