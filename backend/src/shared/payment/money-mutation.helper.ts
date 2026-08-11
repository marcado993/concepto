import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PayphoneClient } from "./payphone.client";
import { PaymentMethod } from "../../locker/rental-calculator";

// DRY: LockerService.rent y SubscriptionService.subscribe repetían, palabra
// por palabra, el mismo esqueleto — cobrar por PayPhone ANTES de tocar la
// base de datos, abrir una transacción, crear el Payment, crear la
// entidad de dominio, auditar dentro de la misma transacción, y traducir
// la violación de la restricción única (P2002) a un error de dominio.
// Extraerlo a un solo lugar significa que el principio de
// "ningún dato desacoplado" (05-metodologia-devsecops-pipeline.md §3.1) se
// aplica una vez, no dos veces que puedan divergir con el tiempo.
//
// Simplicidad sin perder seguridad: esto NO oculta la lógica de negocio
// (precio, tier, casillero) — cada servicio sigue siendo dueño de qué
// entidad crea y con qué datos. Lo único que se centraliza es el "cómo se
// cobra y se audita con seguridad", que es exactamente la parte que no
// debería reinventarse por módulo.

export interface MoneyMutationParams<TEntity> {
  userId: string;
  amount: number;
  method: PaymentMethod;
  ipAddress?: string;
  auditAction: string;
  auditEntityType: string;
  createEntity: (tx: Prisma.TransactionClient, paymentId: string) => Promise<TEntity>;
  entityId: (entity: TEntity) => string;
  auditMetadata?: (entity: TEntity) => Record<string, unknown>;
  onConflict: () => never;
}

export interface MoneyMutationDeps {
  prisma: PrismaService;
  audit: AuditService;
  payphone: PayphoneClient;
}

export async function executeMoneyMutation<TEntity>(
  deps: MoneyMutationDeps,
  params: MoneyMutationParams<TEntity>
): Promise<TEntity> {
  // PayPhone cobra ANTES de abrir la transacción — nunca queremos una
  // entidad "a medias" esperando un cobro que no se puede reintentar
  // limpiamente (ver locker.service.spec.ts, caso "PayPhone falla").
  const providerRef =
    params.method === "PAYPHONE"
      ? (await deps.payphone.charge(params.amount, params.userId)).providerRef
      : undefined;

  try {
    return await deps.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId: params.userId,
          method: params.method,
          amount: params.amount,
          status: params.method === "PAYPHONE" ? "CONFIRMED" : "PENDING",
          providerRef,
          confirmedAt: params.method === "PAYPHONE" ? new Date() : null,
        },
      });

      const entity = await params.createEntity(tx, payment.id);

      await deps.audit.record(
        {
          actorId: params.userId,
          action: params.auditAction,
          entityType: params.auditEntityType,
          entityId: params.entityId(entity),
          ipAddress: params.ipAddress,
          metadata: { method: params.method, amount: params.amount, ...params.auditMetadata?.(entity) },
        },
        tx
      );

      return entity;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      params.onConflict();
    }
    throw err;
  }
}
