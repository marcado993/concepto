import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Subscription } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { PeriodService } from "../shared/period/period.service";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { SubscriptionTierName } from "./dto/subscribe.dto";

export class AlreadySubscribedError extends ConflictException {
  constructor() {
    super("Ya existe una aportación activa para este estudiante en el periodo actual");
  }
}

export interface SubscribeParams {
  userId: string;
  tierName: SubscriptionTierName;
  ipAddress?: string;
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payphone: PayphoneClient,
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
        method: "PAYPHONE",
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

    // clientTransactionId es el ancla real contra reutilizar UN pago
    // aprobado para confirmar OTRA aportación distinta — sin esto, dos
    // aportaciones con el mismo tier (mismo monto) bastan para que el
    // mismo transactionId real "apruebe" ambas (mismo hallazgo que en
    // locker.service.ts confirmPayphonePayment).
    if (!result.approved || result.amountCents !== expectedCents || result.clientTransactionId !== subscriptionId) {
      await this.audit.record({
        actorId: userId,
        action: "subscription.payphone.rejected",
        entityType: "Subscription",
        entityId: subscription.id,
        ipAddress,
        metadata: { reason: "no_aprobado_monto_no_coincide_o_clientTransactionId_no_coincide", expectedCents, got: result },
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
