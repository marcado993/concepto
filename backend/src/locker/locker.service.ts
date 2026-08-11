import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LockerRental } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { calculateLockerPrice, PaymentMethod } from "./rental-calculator";

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
  periodId: string;
  method: PaymentMethod;
  ipAddress?: string;
}

@Injectable()
export class LockerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payphone: PayphoneClient
  ) {}

  async rent(params: RentLockerParams) {
    const locker = await this.prisma.locker.findUnique({ where: { code: params.lockerCode } });
    if (!locker) throw new NotFoundException(`Casillero ${params.lockerCode} no existe`);

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
            data: { lockerId: locker.id, userId: params.userId, periodId: params.periodId, paymentId },
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
}
