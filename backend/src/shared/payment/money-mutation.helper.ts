import { Prisma, PaymentMethod } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

// PaymentMethod viene del enum REAL de Prisma (PAYPHONE | TRANSFER |
// INFORMATIVE), no del type acotado de rental-calculator.ts (ese es
// específico de "cómo se le calcula el precio a un casillero", más
// angosto a propósito — un casillero siempre es PAYPHONE, nunca
// INFORMATIVE). Este helper es compartido por cualquier flujo de dinero
// (o "flujo informativo" como aportaciones), así que necesita el enum
// completo.

// DRY: LockerService.rent y SubscriptionService.subscribe repetían, palabra
// por palabra, el mismo esqueleto — abrir una transacción, crear el
// Payment, crear la entidad de dominio, auditar dentro de la misma
// transacción, y traducir la violación de la restricción única (P2002) a
// un error de dominio. Extraerlo a un solo lugar significa que el
// principio de "ningún dato desacoplado"
// (05-metodologia-devsecops-pipeline.md §3.1) se aplica una vez, no dos
// veces que puedan divergir con el tiempo.
//
// Simplicidad sin perder seguridad: esto NO oculta la lógica de negocio
// (precio, tier, casillero) — cada servicio sigue siendo dueño de qué
// entidad crea y con qué datos. Lo único que se centraliza es el "cómo se
// audita con seguridad", que es exactamente la parte que no debería
// reinventarse por módulo.
//
// PAYPHONE ya no cobra aquí de forma síncrona: la Cajita de Pagos real de
// PayPhone es un widget client-side que el estudiante completa en el
// navegador — el backend no puede "cobrar" nada por su cuenta en ese
// momento. Por eso PAYPHONE entra a este helper exactamente igual que
// TRANSFER (Payment PENDING, sin providerRef): la confirmación real llega
// después, vía LockerService.confirmPayphonePayment(), que sí llama a
// PayphoneClient.confirm() contra la API de PayPhone antes de marcar nada
// como pagado (ver payphone.client.ts).

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
  // Solo para flujos que NUNCA pasan por una pasarela real (ver
  // SubscriptionService.subscribe() — aportaciones son informativas, sin
  // cobro real en la app) — crea el Payment YA CONFIRMED, sin el paso
  // intermedio PENDING que existe justo para esperar la confirmación de
  // PayPhone. Nunca usar esto en un flujo que sí cobra de verdad (lockers):
  // ahí el PENDING es lo que le da sentido a confirmPayphonePayment().
  autoConfirm?: boolean;
}

export interface MoneyMutationDeps {
  prisma: PrismaService;
  audit: AuditService;
}

export async function executeMoneyMutation<TEntity>(
  deps: MoneyMutationDeps,
  params: MoneyMutationParams<TEntity>
): Promise<TEntity> {
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId: params.userId,
          method: params.method,
          amount: params.amount,
          status: params.autoConfirm ? "CONFIRMED" : "PENDING",
          confirmedAt: params.autoConfirm ? new Date() : null,
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
