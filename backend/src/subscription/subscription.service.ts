import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Subscription } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { PaymentMethod } from "../locker/rental-calculator";
import { SubscriptionTierName } from "./dto/subscribe.dto";

export class AlreadySubscribedError extends ConflictException {
  constructor() {
    super("Ya existe una aportación activa para este estudiante en el periodo actual");
  }
}

export interface SubscribeParams {
  userId: string;
  periodId: string;
  tierName: SubscriptionTierName;
  method: PaymentMethod;
  ipAddress?: string;
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async subscribe(params: SubscribeParams) {
    // El monto NO se calcula en código (a diferencia del casillero) — se
    // lee del tier vigente en el periodo, porque el precio de cada tier es
    // una decisión de negocio que cambia con el tiempo (ver dto y prisma
    // schema). Si el tier no existe todavía para este periodo, es un error
    // de datos/seed, no algo que el servicio deba inventar un default para.
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { periodId_name: { periodId: params.periodId, name: params.tierName } },
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
            data: { userId: params.userId, tierId: tier.id, periodId: params.periodId, paymentId },
          }),
        onConflict: () => {
          throw new AlreadySubscribedError();
        },
      }
    );
  }
}
