import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LockerRental } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { OcrService } from "../shared/ocr/ocr.service";
import { PeriodService } from "../shared/period/period.service";
import { SubscriptionBenefitsService } from "../subscription/subscription-benefits.service";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { calculateLockerPrice, PaymentMethod } from "./rental-calculator";
import { receiptMentionsAmount } from "../shared/payment/receipt-validator";

// Precio base semestral — configurable porque el sponsor puede fijarlo
// entre $5.50 y $9.00 según utilidad objetivo (ver rental-calculator.ts).
// $6.50 es el valor de partida ya usado hoy por AEIS, no un techo.
export const DEFAULT_LOCKER_BASE_PRICE = 6.5;

export class LockerUnavailableError extends ConflictException {
  constructor(lockerCode: string) {
    super(`El casillero ${lockerCode} ya no está disponible para este periodo`);
  }
}

// Versión del texto de términos que se le muestra al estudiante — si el
// texto cambia de un semestre a otro, un AuditLog viejo con
// termsVersion:"2026-A-v1" sigue siendo prueba de qué versión ACEPTÓ en su
// momento, no de la que esté vigente hoy.
export const LOCKER_TERMS_VERSION = "2026-A-v1";

export interface RentLockerParams {
  userId: string;
  lockerCode: string;
  method: PaymentMethod;
  cedula: string;
  phone: string;
  acceptedTerms: boolean;
  ipAddress?: string;
}

// Cuánto tiempo se le da al ganador de un casillero por TRANSFERENCIA para
// subir el comprobante antes de que otro estudiante pueda tomarlo — pedido
// real del cliente: "solo se reservan 1 día... si no sube evidencias se
// libera". PayPhone no aplica: ahí no hay comprobante que subir, la
// confirmación pasa por confirmPayphonePayment() contra la API real.
const TRANSFER_RECEIPT_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class LockerService {
  private readonly logger = new Logger(LockerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payphone: PayphoneClient,
    private readonly ocr: OcrService,
    private readonly period: PeriodService,
    private readonly subscriptionBenefits: SubscriptionBenefitsService
  ) {}

  list() {
    return this.prisma.locker.findMany({
      select: { id: true, code: true, zone: true, status: true },
      orderBy: [{ zone: "asc" }, { code: "asc" }],
    });
  }

  // La lista pública (list(), arriba) es @Public() y nunca dice de QUIÉN es
  // un casillero RESERVED — con buena razón, exponer eso a cualquiera
  // filtraría quién está tramitando qué. Pero un estudiante cuyo comprobante
  // falló (red caída, foto ilegible) necesita poder volver a su PROPIA
  // reserva para resubir la foto sin quedar bloqueado — este método (detrás
  // de @Roles(ESTUDIANTE), filtrado por userId real del JWT, nunca por algo
  // que mande el cliente) es la única forma de saber "esto es mío" sin
  // filtrar nada de nadie más.
  async getMyPendingReceipt(userId: string) {
    const rental = await this.prisma.lockerRental.findFirst({
      where: { userId, payment: { method: "TRANSFER", status: "PENDING" } },
      include: { locker: true },
      orderBy: { createdAt: "desc" },
    });
    if (!rental) return null;
    return { rentalId: rental.id, lockerCode: rental.locker.code };
  }

  // Mismo criterio que getMyPendingReceipt (arriba) pero para el caso
  // "ya tiene un casillero" — pedido real: en vez de obligar al estudiante
  // a buscar el suyo entre hasta 108, la grilla lo distingue y deja tocarlo
  // para ver su estado directamente. status:"CONFIRMED" (no PENDING) porque
  // acá el pago YA se validó — a diferencia de la reserva pendiente, esto
  // no depende del método de pago (TRANSFER o PAYPHONE, cualquiera vale).
  async getMyRentedLocker(userId: string) {
    // Filtrado por periodo actual — un casillero confirmado en un semestre
    // anterior no debe seguir apareciendo como "tu casillero" para siempre.
    const periodId = await this.period.getCurrentPeriodId();
    const rental = await this.prisma.lockerRental.findFirst({
      where: { userId, periodId, payment: { status: "CONFIRMED" } },
      include: { locker: true },
      orderBy: { createdAt: "desc" },
    });
    if (!rental) return null;
    return { lockerCode: rental.locker.code, zone: rental.locker.zone };
  }

  // Preview del precio ANTES de alquilar — el frontend lo usa para mostrar
  // el monto real (con descuento de aportante ya aplicado) en el paso de
  // identidad, sin que el estudiante tenga que declarar si es aportante ni
  // de qué plan (eso ya lo resuelve subscriptionBenefits a partir de su
  // propia sesión — ver comentario en rent()).
  async getPricePreview(userId: string) {
    const { discountPercent, tierName } = await this.subscriptionBenefits.getLockerDiscountInfo(userId);
    return {
      basePrice: DEFAULT_LOCKER_BASE_PRICE,
      discountPercent,
      tierName,
      price: {
        TRANSFER: calculateLockerPrice(DEFAULT_LOCKER_BASE_PRICE, "TRANSFER", discountPercent).amount,
        PAYPHONE: calculateLockerPrice(DEFAULT_LOCKER_BASE_PRICE, "PAYPHONE", discountPercent).amount,
      },
    };
  }

  async rent(params: RentLockerParams) {
    // Defensa en profundidad — el DTO ya rechaza acceptedTerms:false con
    // @IsIn([true]), pero rent() puede llamarse desde otro lado (tests,
    // futuros jobs) sin pasar por esa validación. Nunca se crea un alquiler
    // sin la aceptación explícita.
    if (!params.acceptedTerms) {
      throw new BadRequestException("Debes aceptar los términos y condiciones para alquilar");
    }

    const locker = await this.prisma.locker.findUnique({ where: { code: params.lockerCode } });
    if (!locker) throw new NotFoundException(`Casillero ${params.lockerCode} no existe`);

    const periodId = await this.period.getCurrentPeriodId();
    // Cruce de dominio real, no una lectura directa a la tabla de
    // Subscription: le preguntamos al dominio de Aportaciones "¿cuánto
    // descuento tiene este estudiante?" y confiamos en su respuesta (0 si
    // no aporta o su tier no trae ese beneficio) — ver
    // subscription/subscription-benefits.service.ts.
    const discountPercent = await this.subscriptionBenefits.getLockerDiscountPercent(params.userId);
    const price = calculateLockerPrice(DEFAULT_LOCKER_BASE_PRICE, params.method, discountPercent);

    // Cédula/celular se piden una sola vez — se guardan en User acá mismo
    // (no en un endpoint de perfil aparte) para no agregar un paso extra al
    // flujo; el siguiente alquiler/aportación los reutiliza sin volver a
    // preguntarlos (ver GET /auth/me).
    await this.prisma.user.update({
      where: { id: params.userId },
      data: { cedula: params.cedula, phone: params.phone },
    });

    return executeMoneyMutation<LockerRental>(
      { prisma: this.prisma, audit: this.audit },
      {
        userId: params.userId,
        amount: price.amount,
        method: params.method,
        ipAddress: params.ipAddress,
        auditAction: "locker.rental.created",
        auditEntityType: "LockerRental",
        entityId: (rental) => rental.id,
        // La "firma digital" del checkbox de términos vive acá: QUIÉN
        // (actorId, ya viene del JWT verificado, no de un campo del
        // formulario) + CUÁNDO (AuditLog.createdAt, reloj del servidor) +
        // desde QUÉ IP (params.ipAddress, de la request real) — ninguno de
        // los tres lo puede falsificar el cliente. termsVersion deja
        // registrado qué texto exacto aceptó, por si cambia más adelante.
        auditMetadata: () => ({
          lockerCode: params.lockerCode,
          discountPercent,
          termsAccepted: true,
          termsVersion: LOCKER_TERMS_VERSION,
        }),
        // La restricción @@unique([lockerId, periodId]) en el esquema es la
        // que de verdad impide la doble-reserva bajo concurrencia real —
        // el chequeo de `locker.status` de arriba es solo el camino feliz,
        // no la garantía (ver escenario BDD "condición de carrera",
        // docs/dominio/05-metodologia-devsecops-pipeline.md §2).
        createEntity: async (tx, paymentId) => {
          const rental = await tx.lockerRental.create({
            data: { lockerId: locker.id, userId: params.userId, periodId, paymentId },
          });
          // RESERVED para los dos métodos ahora — PAYPHONE ya no cobra de
          // forma síncrona aquí (ver money-mutation.helper.ts), así que no
          // hay forma de saber en este punto si el estudiante de verdad va
          // a completar el pago en el widget. RENTED solo llega después,
          // vía confirmPayphonePayment() o confirmReceipt().
          await tx.locker.update({
            where: { id: locker.id },
            data: { status: "RESERVED" },
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
      // ocrTextPreview: sin esto, un rechazo por "el OCR se cayó bajo
      // presión" y uno por "el OCR leyó bien pero el comprobante de verdad
      // no coincide" se veían idénticos en el AuditLog — hallazgo real
      // (comprobante genuino rechazado durante un redeploy). Con el texto
      // extraído ahí, un vistazo al log basta para saber cuál fue sin
      // tener que volver a subir la imagen a mano para probarla.
      await this.audit.record({
        actorId: userId,
        action: "locker.receipt.rejected",
        entityType: "LockerRental",
        entityId: rental.id,
        ipAddress,
        metadata: { reason: "monto_no_coincide", expectedAmount: amount, ocrTextPreview: ocrText.slice(0, 500) },
      });
      throw new BadRequestException(
        "No pudimos confirmar el monto en el comprobante — verifica que la foto sea legible e intenta de nuevo"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // updateMany + where status:"PENDING", no update() simple — el chequeo
      // de `rental.payment.status !== "PENDING"` de arriba NO es atómico con
      // esta escritura (condición de carrera real: dos peticiones para el
      // MISMO comprobante — doble click, o el navegador reintentando una
      // petición que ya llegó — pueden pasar ambas ese chequeo antes de que
      // cualquiera confirme). El WHERE status:"PENDING" aquí es lo que
      // garantiza que como máximo una gana; la otra ve count=0 y se entera
      // de que ya no hay nada que confirmar, en vez de confirmar dos veces.
      const { count } = await tx.payment.updateMany({
        where: { id: rental.paymentId, status: "PENDING" },
        data: { status: "CONFIRMED", confirmedAt: new Date(), providerRef: `receipt-${rental.id}` },
      });
      if (count === 0) {
        throw new ConflictException("Este comprobante ya fue procesado por otra petición");
      }
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

  // Config pública del widget de PayPhone (token + storeId) — se sirve
  // desde el backend, no se hardcodea en el bundle del frontend, para
  // poder rotar credenciales o cambiar de comercio sin un redeploy del
  // frontend. No es un secreto en el sentido clásico (ver comentario en
  // payphone.client.ts) — PayPhone mismo lo pone en JS del navegador.
  getPayphoneConfig() {
    return this.payphone.getPublicConfig();
  }

  // Confirmación de pago con PayPhone (Cajita de Pagos) — el paso
  // equivalente a confirmReceipt() pero para el otro método de pago. El
  // widget corre en el navegador del estudiante; cuando termina, PayPhone
  // redirige la página completa con ?id=&clientTransactionId= en la URL
  // (App.svelte los captura). clientTransactionId es el id de ESTE
  // LockerRental — lo usamos como tal desde que se creó en rent().
  //
  // Nunca se confía en que el navegador "diga" que el pago fue aprobado:
  // siempre se re-confirma contra la API real de PayPhone antes de marcar
  // nada como pagado — un query param se puede fabricar a mano.
  async confirmPayphonePayment(
    rentalId: string,
    payphoneTransactionId: number,
    userId: string,
    ipAddress?: string
  ) {
    const rental = await this.prisma.lockerRental.findUnique({
      where: { id: rentalId },
      include: { payment: true, locker: true },
    });
    if (!rental) throw new NotFoundException("Alquiler no encontrado");
    if (rental.userId !== userId) throw new ForbiddenException("Este alquiler no te pertenece");
    if (rental.payment.method !== "PAYPHONE") {
      throw new BadRequestException("Este alquiler no se paga con PayPhone");
    }
    if (rental.payment.status !== "PENDING") {
      throw new BadRequestException("Este pago ya fue procesado");
    }

    const amount = Number(rental.payment.amount);
    const expectedCents = Math.round(amount * 100);

    let result;
    try {
      result = await this.payphone.confirm(payphoneTransactionId, rentalId);
    } catch (err) {
      await this.audit.record({
        actorId: userId,
        action: "locker.payphone.rejected",
        entityType: "LockerRental",
        entityId: rental.id,
        ipAddress,
        metadata: { reason: "confirm_api_error", message: (err as Error).message },
      });
      throw new BadRequestException("No se pudo confirmar el pago con PayPhone — intenta de nuevo");
    }

    if (!result.approved || result.amountCents !== expectedCents) {
      await this.audit.record({
        actorId: userId,
        action: "locker.payphone.rejected",
        entityType: "LockerRental",
        entityId: rental.id,
        ipAddress,
        metadata: { reason: "no_aprobado_o_monto_no_coincide", expectedCents, got: result },
      });
      throw new BadRequestException("PayPhone no aprobó esta transacción");
    }

    return this.prisma.$transaction(async (tx) => {
      // Mismo patrón atómico que confirmReceipt() — updateMany + WHERE
      // status:"PENDING" en vez de update() simple, para que un doble
      // callback de PayPhone (o el usuario recargando la página de
      // respuesta) no pueda confirmar el mismo pago dos veces.
      const { count } = await tx.payment.updateMany({
        where: { id: rental.paymentId, status: "PENDING" },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          providerRef: String(result.transactionId),
        },
      });
      if (count === 0) {
        throw new ConflictException("Este pago ya fue procesado por otra petición");
      }
      const updatedLocker = await tx.locker.update({
        where: { id: rental.lockerId },
        data: { status: "RENTED" },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: "locker.payphone.confirmed",
          entityType: "LockerRental",
          entityId: rental.id,
          ipAddress,
          metadata: { amount, providerRef: String(result.transactionId) },
        },
        tx
      );
      return { rental, locker: updatedLocker };
    });
  }

  // Corre cada hora, mismo patrón que ResourceMonitorService (@Cron en el
  // mismo proceso que sirve la API — ver ese archivo para por qué no un
  // job/daemon aparte). Libera casilleros RESERVED por transferencia cuyo
  // ganador nunca subió el comprobante dentro de las 24h de gracia — sin
  // esto, un estudiante que se arrepiente o simplemente no vuelve deja el
  // casillero bloqueado para todos el resto del semestre (@@unique
  // [lockerId, periodId] impide que otro lo intente mientras el
  // LockerRental "fantasma" siga ahí).
  @Cron(CronExpression.EVERY_HOUR)
  async releaseExpiredTransferReservations(): Promise<number> {
    const cutoff = new Date(Date.now() - TRANSFER_RECEIPT_GRACE_MS);
    const expired = await this.prisma.lockerRental.findMany({
      where: { payment: { method: "TRANSFER", status: "PENDING" }, createdAt: { lte: cutoff } },
      include: { locker: true },
    });

    let released = 0;
    for (const rental of expired) {
      const freed = await this.prisma.$transaction(async (tx) => {
        // updateMany + WHERE status:"PENDING", no update() simple — mismo
        // motivo que confirmReceipt()/confirmPayphonePayment(): si el
        // estudiante sube el comprobante justo en este instante, esto evita
        // liberar un casillero que ya se confirmó por debajo.
        const { count } = await tx.payment.updateMany({
          where: { id: rental.paymentId, status: "PENDING" },
          data: { status: "REJECTED" },
        });
        if (count === 0) return false;

        // Se borra el LockerRental (no el Payment, que queda como historial
        // marcado REJECTED) — es la fila que bloquea @@unique[lockerId,
        // periodId], así que borrarla es lo que de verdad libera el cupo
        // para que otro estudiante pueda alquilar el mismo casillero.
        await tx.lockerRental.delete({ where: { id: rental.id } });
        await tx.locker.update({ where: { id: rental.lockerId }, data: { status: "AVAILABLE" } });
        await this.audit.record(
          {
            // No hay un usuario "actuando" acá (esto lo dispara el reloj,
            // no un click) — se usa el dueño de la reserva vencida como
            // actor porque AuditLog.actorId es NOT NULL a propósito (ver
            // audit.service.ts); metadata.reason deja claro que fue
            // automático, no algo que el estudiante pidió.
            actorId: rental.userId,
            action: "locker.rental.expired",
            entityType: "LockerRental",
            entityId: rental.id,
            metadata: { lockerCode: rental.locker.code, reason: "sin_comprobante_24h" },
          },
          tx
        );
        return true;
      });
      if (freed) released++;
    }

    if (released > 0) {
      this.logger.log(`Liberados ${released} casillero(s) reservados por transferencia sin comprobante en 24h`);
    }
    return released;
  }
}
