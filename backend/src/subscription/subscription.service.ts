import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Subscription } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
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
  fullName: string;
  ipAddress?: string;
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

    // Confirma/completa el nombre completo — mismo motivo que
    // locker.service.ts::rent(): antes aportar nunca lo pedía en
    // absoluto, así que un estudiante que SOLO aportara (nunca alquiló un
    // casillero) se quedaba con el placeholder interno para siempre (ver
    // PENDING_FULL_NAME en auth.service.ts).
    await this.prisma.user.update({ where: { id: params.userId }, data: { fullName: params.fullName } });

    // autoConfirm: true — aportaciones son informativas, sin pasarela real
    // (decisión de negocio: a diferencia de casilleros, acá no hay un pago
    // que de verdad se cobre dentro de la app). El Payment se crea
    // CONFIRMED de una vez, sin el paso intermedio "esperando PayPhone" que
    // sí existe en LockerService.rent(). Esto también hace que el
    // descuento de aportante (SubscriptionBenefitsService) aplique de
    // inmediato, no recién cuando alguien confirmara un pago que ya no
    // existe.
    return executeMoneyMutation<Subscription>(
      { prisma: this.prisma, audit: this.audit },
      {
        userId: params.userId,
        amount,
        method: "INFORMATIVE",
        ipAddress: params.ipAddress,
        auditAction: "subscription.created",
        auditEntityType: "Subscription",
        entityId: (subscription) => subscription.id,
        auditMetadata: () => ({ tierName: params.tierName }),
        autoConfirm: true,
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
}
