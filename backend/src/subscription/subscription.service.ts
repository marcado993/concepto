import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Subscription } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { OcrService } from "../shared/ocr/ocr.service";
import { PeriodService } from "../shared/period/period.service";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { receiptMentionsAmount } from "../shared/payment/receipt-validator";
import { PaymentMethod } from "../locker/rental-calculator";
import { SubscriptionTierName } from "./dto/subscribe.dto";

export class AlreadySubscribedError extends ConflictException {
  constructor() {
    super("Ya existe una aportación activa para este estudiante en el periodo actual");
  }
}

export interface SubscribeParams {
  userId: string;
  tierName: SubscriptionTierName;
  method: PaymentMethod;
  ipAddress?: string;
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payphone: PayphoneClient,
    private readonly ocr: OcrService,
    private readonly period: PeriodService
  ) {}

  // Público — mismo criterio que lockers/security/ventures: ver los tiers y
  // sus precios no expone nada sensible, no hay motivo para exigir login
  // solo para mirar cuánto cuesta cada uno.
  async listTiers() {
    const periodId = await this.period.getCurrentPeriodId();
    return this.prisma.subscriptionTier.findMany({
      where: { periodId },
      select: { id: true, name: true, amount: true, benefits: true },
      orderBy: { amount: "asc" },
    });
  }

  // Le dice al estudiante si ya aportó este periodo y en qué estado quedó
  // el pago — el frontend lo usa para no ofrecerle aportar dos veces, y
  // para retomar el paso de confirmación (subir comprobante / PayPhone) si
  // cerró la app a medio camino en vez de perder el progreso.
  async getMine(userId: string) {
    const periodId = await this.period.getCurrentPeriodId();
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId_periodId: { userId, periodId } },
      include: { tier: true, payment: true },
    });
    if (!subscription) return null;
    return {
      id: subscription.id,
      tierName: subscription.tier.name,
      amount: subscription.payment.amount,
      method: subscription.payment.method,
      paymentStatus: subscription.payment.status,
    };
  }

  async subscribe(params: SubscribeParams) {
    const periodId = await this.period.getCurrentPeriodId();

    // El monto NO se calcula en código (a diferencia del casillero) — se
    // lee del tier vigente en el periodo, porque el precio de cada tier es
    // una decisión de negocio que cambia con el tiempo (ver dto y prisma
    // schema). Si el tier no existe todavía para este periodo, es un error
    // de datos/seed, no algo que el servicio deba inventar un default para.
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { periodId_name: { periodId, name: params.tierName } },
    });
    if (!tier) {
      throw new NotFoundException(
        `El tier "${params.tierName}" no está configurado para el periodo activo`
      );
    }

    const amount = Number(tier.amount);

    return executeMoneyMutation<Subscription>(
      { prisma: this.prisma, audit: this.audit },
      {
        userId: params.userId,
        amount,
        method: params.method,
        ipAddress: params.ipAddress,
        auditAction: "subscription.created",
        auditEntityType: "Subscription",
        entityId: (subscription) => subscription.id,
        auditMetadata: () => ({ tierName: params.tierName }),
        // @@unique([userId, periodId]) en el schema: un aportante, un tier
        // activo por periodo — no "el primero que llega gana un descuento
        // extra por aportar dos veces".
        createEntity: (tx, paymentId) =>
          tx.subscription.create({
            data: { userId: params.userId, tierId: tier.id, periodId, paymentId },
          }),
        onConflict: () => {
          throw new AlreadySubscribedError();
        },
      }
    );
  }

  // Confirmación de comprobante de transferencia — mismo patrón que
  // LockerService.confirmReceipt(): OCR como filtro de primera línea (no
  // aprobación bancaria real), updateMany+WHERE status:"PENDING" para que
  // un doble click/reintento no pueda confirmar el mismo pago dos veces.
  async confirmReceipt(subscriptionId: string, userId: string, receiptImage: Buffer, ipAddress?: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { payment: true },
    });
    if (!subscription) throw new NotFoundException("Aportación no encontrada");
    if (subscription.userId !== userId) throw new ForbiddenException("Esta aportación no te pertenece");
    if (subscription.payment.method !== "TRANSFER") {
      throw new BadRequestException("Esta aportación no requiere confirmación de comprobante");
    }
    if (subscription.payment.status !== "PENDING") {
      throw new BadRequestException("Este comprobante ya fue procesado");
    }

    const ocrText = await this.ocr.extractText(receiptImage);
    const amount = Number(subscription.payment.amount);
    const valid = receiptMentionsAmount(ocrText, amount);

    if (!valid) {
      // ocrTextPreview: mismo hallazgo que locker.service.ts — sin esto,
      // un rechazo por OCR caído bajo presión de recursos y uno por un
      // comprobante genuinamente equivocado se ven idénticos en el log.
      await this.audit.record({
        actorId: userId,
        action: "subscription.receipt.rejected",
        entityType: "Subscription",
        entityId: subscription.id,
        ipAddress,
        metadata: { reason: "monto_no_coincide", expectedAmount: amount, ocrTextPreview: ocrText.slice(0, 500) },
      });
      throw new BadRequestException(
        "No pudimos confirmar el monto en el comprobante — verifica que la foto sea legible e intenta de nuevo"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: subscription.paymentId, status: "PENDING" },
        data: { status: "CONFIRMED", confirmedAt: new Date(), providerRef: `receipt-${subscription.id}` },
      });
      if (count === 0) {
        throw new ConflictException("Este comprobante ya fue procesado por otra petición");
      }
      await this.audit.record(
        {
          actorId: userId,
          action: "subscription.receipt.confirmed",
          entityType: "Subscription",
          entityId: subscription.id,
          ipAddress,
          metadata: { amount },
        },
        tx
      );
      return { subscription };
    });
  }

  // Confirmación de pago con PayPhone — mismo patrón que
  // LockerService.confirmPayphonePayment(): siempre re-verifica contra la
  // API real de PayPhone antes de marcar algo como pagado, nunca confía en
  // que el navegador "diga" que volvió con esos query params.
  async confirmPayphonePayment(subscriptionId: string, payphoneTransactionId: number, userId: string, ipAddress?: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { payment: true },
    });
    if (!subscription) throw new NotFoundException("Aportación no encontrada");
    if (subscription.userId !== userId) throw new ForbiddenException("Esta aportación no te pertenece");
    if (subscription.payment.method !== "PAYPHONE") {
      throw new BadRequestException("Esta aportación no se paga con PayPhone");
    }
    if (subscription.payment.status !== "PENDING") {
      throw new BadRequestException("Este pago ya fue procesado");
    }

    const amount = Number(subscription.payment.amount);
    const expectedCents = Math.round(amount * 100);

    let result;
    try {
      result = await this.payphone.confirm(payphoneTransactionId, subscriptionId);
    } catch (err) {
      await this.audit.record({
        actorId: userId,
        action: "subscription.payphone.rejected",
        entityType: "Subscription",
        entityId: subscription.id,
        ipAddress,
        metadata: { reason: "confirm_api_error", message: (err as Error).message },
      });
      throw new BadRequestException("No se pudo confirmar el pago con PayPhone — intenta de nuevo");
    }

    if (!result.approved || result.amountCents !== expectedCents) {
      await this.audit.record({
        actorId: userId,
        action: "subscription.payphone.rejected",
        entityType: "Subscription",
        entityId: subscription.id,
        ipAddress,
        metadata: { reason: "no_aprobado_o_monto_no_coincide", expectedCents, got: result },
      });
      throw new BadRequestException("PayPhone no aprobó esta transacción");
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: subscription.paymentId, status: "PENDING" },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          providerRef: String(result.transactionId),
        },
      });
      if (count === 0) {
        throw new ConflictException("Este pago ya fue procesado por otra petición");
      }
      await this.audit.record(
        {
          actorId: userId,
          action: "subscription.payphone.confirmed",
          entityType: "Subscription",
          entityId: subscription.id,
          ipAddress,
          metadata: { amount, providerRef: String(result.transactionId) },
        },
        tx
      );
      return { subscription };
    });
  }

  getPayphoneConfig() {
    return this.payphone.getPublicConfig();
  }
}
