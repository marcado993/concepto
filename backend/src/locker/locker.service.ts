import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LockerRental, Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { PeriodService } from "../shared/period/period.service";
import { SubscriptionBenefitsService } from "../subscription/subscription-benefits.service";
import { executeMoneyMutation } from "../shared/payment/money-mutation.helper";
import { calculateLockerPrice } from "./rental-calculator";
import { MailService } from "../shared/mail/mail.service";
import { lockerContractHtml, lockerContractSubject } from "./locker-contract";

export class LockerUnavailableError extends ConflictException {
  constructor(lockerCode: string) {
    super(`El casillero ${lockerCode} ya no está disponible para este periodo`);
  }
}

// Versión del texto de términos que se le muestra al estudiante — si el
// texto cambia de un semestre a otro, un AuditLog viejo con
// termsVersion:"2026-A-v1" sigue siendo prueba de qué versión ACEPTÓ en su
// momento, no de la que esté vigente hoy.
//
// Se DERIVA del periodo real, ya no es una constante escrita a mano:
// hallazgo de auditoría — la constante decía "2026-A-v1" mientras el
// periodo activo en producción ya era 2026-B, así que cada aceptación se
// archivaba con la etiqueta del semestre equivocado (y el modal, que
// también lo tenía a mano, le mostraba al estudiante ese mismo semestre
// incorrecto). El texto que se firma y la etiqueta con que se archiva
// salen ahora del mismo dato que decide a qué periodo va el alquiler.
export function lockerTermsVersion(periodLabel: string): string {
  return `${periodLabel}-v1`;
}

export interface RentLockerParams {
  userId: string;
  lockerCode: string;
  uniqueCode: string;
  cedula: string;
  phone: string;
  acceptedTerms: boolean;
  ipAddress?: string;
}

// Transferencia + comprobante por OCR se retiró (PayPhone es el único
// método de pago desde acá en adelante) — esta constante y el Cron job
// de abajo se quedan SOLO para drenar reservas RESERVED por transferencia
// que hayan quedado de ANTES de este cambio (dato real de producción:
// había una reserva pendiente exacta el día del retiro). No se puede
// borrar esa fila a mano sin perder la evidencia de auditoría — el mismo
// camino ya probado (marcar el pago REJECTED, liberar el casillero,
// dejar el registro en AuditLog) es más seguro que un DELETE manual.
// Una vez confirmado que no queda ningún LockerRental con
// payment.method="TRANSFER" y status="PENDING", este job y todo lo que
// referencia TRANSFER en este archivo puede borrarse sin más.
const TRANSFER_RECEIPT_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class LockerService {
  private readonly logger = new Logger(LockerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payphone: PayphoneClient,
    private readonly period: PeriodService,
    private readonly subscriptionBenefits: SubscriptionBenefitsService,
    private readonly mail: MailService
  ) {}

  // Los casilleros reales se identifican SOLO por número (sin letra de
  // zona, ver prisma/seed.ts) — un orden alfabético de `code` pondría
  // "100" antes que "2" (comparación de texto, no numérica). Con solo ~110
  // filas, ordenar en memoria es más simple que un ORDER BY con cast a
  // entero en SQL crudo.
  async list() {
    const lockers = await this.prisma.locker.findMany({
      select: { id: true, code: true, zone: true, status: true },
    });
    return lockers.sort((a, b) => {
      if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
      const numA = Number(a.code);
      const numB = Number(b.code);
      if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
      return a.code.localeCompare(b.code);
    });
  }

  // "¿Ya tengo un casillero confirmado este periodo?" — pedido real: en vez
  // de obligar al estudiante a buscar el suyo entre hasta 108, la grilla lo
  // distingue y lo deja tocar para ver su estado directamente.
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
    // El periodo viaja con el precio a propósito: "$6.50" sin decir por
    // cuánto tiempo es un precio que no se puede evaluar, y el texto de
    // términos que el estudiante firma tiene que nombrar el MISMO
    // semestre al que el backend va a asignar el alquiler (ver
    // PeriodService.getCurrentPeriod — antes el modal lo tenía escrito a
    // mano y nombraba un semestre que ya no era el vigente).
    const period = await this.period.getCurrentPeriod();
    const basePrice = Number(period.lockerBasePrice);
    return {
      basePrice,
      discountPercent,
      tierName,
      price: { PAYPHONE: calculateLockerPrice(basePrice, discountPercent).amount },
      period: { label: period.label, endsAt: period.endsAt.toISOString() },
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

    const period = await this.period.getCurrentPeriod();
    const periodId = period.id;

    // Un casillero por estudiante por semestre. Hallazgo de pentesting
    // (auditoría de seguridad, lógica de negocio — ningún escáner lo ve):
    // sin esto, un mismo estudiante autenticado podía crear RESERVED sobre
    // casillero tras casillero (el @@unique es [lockerId, periodId], no por
    // usuario), y como una reserva PayPhone sin pagar no la liberaba ningún
    // cron, cada una quedaba retenida indefinidamente. Un solo alumno podía
    // así reservar los 108 casilleros en ~1 min y negárselos a los ~1700
    // restantes, sin pagar un centavo. Se cuentan solo las reservas ACTIVAS
    // (pago PENDING = esperando pago, o CONFIRMED = ya pagado); una vencida/
    // liberada queda REJECTED y no bloquea un intento nuevo. El frontend ya
    // asumía "un casillero por estudiante" (myRentedLocker es singular) —
    // esto solo hace cumplir del lado servidor lo que la UI daba por hecho.
    const activeRental = await this.prisma.lockerRental.findFirst({
      where: { userId: params.userId, periodId, payment: { status: { in: ["PENDING", "CONFIRMED"] } } },
      include: { locker: true, payment: true },
    });
    if (activeRental) {
      const yaPagado = activeRental.payment.status === "CONFIRMED";
      throw new ConflictException(
        yaPagado
          ? `Ya tienes el casillero ${activeRental.locker.code} este semestre.`
          : `Ya tienes una reserva pendiente del casillero ${activeRental.locker.code} — termina o cancela ese pago antes de reservar otro.`
      );
    }

    // Cruce de dominio real, no una lectura directa a la tabla de
    // Subscription: le preguntamos al dominio de Aportaciones "¿cuánto
    // descuento tiene este estudiante?" y confiamos en su respuesta (0 si
    // no aporta o su tier no trae ese beneficio) — ver
    // subscription/subscription-benefits.service.ts.
    const discountPercent = await this.subscriptionBenefits.getLockerDiscountPercent(params.userId);
    const price = calculateLockerPrice(Number(period.lockerBasePrice), discountPercent);

    // Cédula/celular/código único se piden una sola vez — se guardan en
    // User acá mismo (no en un endpoint de perfil aparte) para no agregar
    // un paso extra al flujo; el siguiente alquiler/aportación los reutiliza
    // sin volver a preguntarlos (ver GET /auth/me). uniqueCode reemplaza el
    // placeholder "PENDIENTE-<uuid>" con el dato real — ver el comentario en
    // rent-locker.dto.ts.
    try {
      await this.prisma.user.update({
        where: { id: params.userId },
        data: { cedula: params.cedula, phone: params.phone, uniqueCode: params.uniqueCode },
      });
    } catch (err) {
      // P2002 = choque contra la restricción @unique de uniqueCode — dos
      // estudiantes distintos escribiendo el MISMO código real. Nunca
      // debería pasar con datos reales, pero un error genérico de base de
      // datos ("500 crudo") no le dice al estudiante qué hacer; esto sí.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BadRequestException("Ese código único ya está registrado con otra cuenta — revísalo e intenta de nuevo");
      }
      throw err;
    }

    return executeMoneyMutation<LockerRental>(
      { prisma: this.prisma, audit: this.audit },
      {
        userId: params.userId,
        amount: price.amount,
        method: "PAYPHONE",
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
          termsVersion: lockerTermsVersion(period.label),
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
          // RESERVED, no RENTED de una vez — PAYPHONE no cobra de forma
          // síncrona aquí (ver money-mutation.helper.ts), así que no hay
          // forma de saber en este punto si el estudiante de verdad va a
          // completar el pago en el widget. RENTED solo llega después, vía
          // confirmPayphonePayment().
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

  // Config pública del widget de PayPhone (token + storeId) — se sirve
  // desde el backend, no se hardcodea en el bundle del frontend, para
  // poder rotar credenciales o cambiar de comercio sin un redeploy del
  // frontend. No es un secreto en el sentido clásico (ver comentario en
  // payphone.client.ts) — PayPhone mismo lo pone en JS del navegador.
  getPayphoneConfig() {
    return this.payphone.getPublicConfig();
  }

  // Confirmación de pago con PayPhone (Cajita de Pagos) — el widget corre
  // en el navegador del estudiante; cuando termina, PayPhone
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

    // clientTransactionId es el ancla real contra reutilizar UN pago
    // aprobado para confirmar OTRO alquiler distinto — sin esto, dos
    // alquileres con el mismo precio base bastan para que el mismo
    // transactionId real "apruebe" ambos (auditoría de seguridad real:
    // el monto solo no basta, hay que anclar la transacción al alquiler
    // exacto que dice confirmar).
    if (!result.approved || result.amountCents !== expectedCents || result.clientTransactionId !== rentalId) {
      await this.audit.record({
        actorId: userId,
        action: "locker.payphone.rejected",
        entityType: "LockerRental",
        entityId: rental.id,
        ipAddress,
        metadata: { reason: "no_aprobado_monto_no_coincide_o_clientTransactionId_no_coincide", expectedCents, got: result },
      });
      throw new BadRequestException("PayPhone no aprobó esta transacción");
    }

    const confirmed = await this.prisma.$transaction(async (tx) => {
      // updateMany + WHERE status:"PENDING" en vez de update() simple,
      // para que un doble callback de PayPhone (o el usuario recargando la
      // página de respuesta) no pueda confirmar el mismo pago dos veces.
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

    // Fuera de la transacción, a propósito: un correo que falla en enviarse
    // no debe revertir un pago que YA se confirmó de verdad contra
    // PayPhone. Igual que AlertService, el fallo se audita y se loguea,
    // nunca tumba la petición — el estudiante ya tiene su casillero aunque
    // el contrato tarde en llegar o haya que reenviarlo a mano.
    await this.sendContractEmail(rental.id, rental.userId, rental.lockerId, rental.periodId, amount, ipAddress);

    return confirmed;
  }

  // Correo de "Contrato de Uso de Locker" — se manda justo después de
  // confirmar el pago (ver comentario arriba). Nunca bloquea ni revierte el
  // alquiler si falla: solo audita y loguea.
  private async sendContractEmail(
    rentalId: string,
    userId: string,
    lockerId: string,
    periodId: string,
    amount: number,
    ipAddress?: string
  ): Promise<void> {
    const [user, locker, period] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.locker.findUnique({ where: { id: lockerId } }),
      this.prisma.period.findUnique({ where: { id: periodId } }),
    ]);
    if (!user || !locker || !period) {
      this.logger.error(`sendContractEmail(${userId}) — faltan datos (user/locker/period) para armar el contrato`);
      return;
    }
    if (!user.email) {
      // No debería pasar — el correo se rellena en cada login (ver
      // provisionUser) — pero un usuario muy viejo sin ningún login desde
      // que existe la columna es posible en teoría. Sin destino no hay
      // correo que mandar; se deja constancia y se sigue.
      this.logger.warn(`sendContractEmail(${userId}) — el usuario no tiene correo guardado, no se manda el contrato`);
      return;
    }

    const contractData = {
      fullName: user.fullName,
      cedula: user.cedula ?? "—",
      uniqueCode: user.uniqueCode,
      lockerCode: locker.code,
      periodLabel: period.label,
      periodEndsAt: period.endsAt,
      amount,
      signedAt: new Date(),
    };

    try {
      await this.mail.send({
        to: user.email,
        subject: lockerContractSubject(contractData),
        html: lockerContractHtml(contractData),
      });
      await this.audit.record({
        actorId: userId,
        action: "locker.contract.sent",
        entityType: "LockerRental",
        entityId: rentalId,
        ipAddress,
        metadata: { to: user.email, lockerCode: locker.code },
      });
    } catch (err) {
      this.logger.error(`sendContractEmail(${userId}) — no se pudo enviar el contrato: ${(err as Error).message}`);
      await this.audit.record({
        actorId: userId,
        action: "locker.contract.send_failed",
        entityType: "LockerRental",
        entityId: rentalId,
        ipAddress,
        metadata: { to: user.email, reason: (err as Error).message },
      });
    }
  }

  // Reserva PayPhone sin completar el pago: el widget de la Cajita de Pagos
  // se resuelve en minutos (tarjeta → aprobación → callback), no en horas.
  // Pasada esta ventana, una reserva todavía PENDING es una abandonada, no
  // un pago en curso — liberarla rápido es justo lo que evita que un
  // estudiante (o un script) retenga casilleros sin pagar y se los niegue
  // al resto (ver el guard "un casillero por estudiante" en rent(); esto es
  // la otra mitad de esa misma defensa: aunque solo pueda tener UNA reserva
  // activa, sin este cron esa reserva sin pagar duraría para siempre).
  private static readonly PAYPHONE_RESERVATION_GRACE_MS = 30 * 60 * 1000; // 30 min

  // Corre cada hora, mismo patrón que ResourceMonitorService (@Cron en el
  // mismo proceso que sirve la API — ver ese archivo para por qué no un
  // job/daemon aparte). Libera casilleros RESERVED por transferencia cuyo
  // ganador nunca subió el comprobante dentro de las 24h de gracia. Es
  // LEGACY: transferencia + OCR se retiró, este cron se queda solo para
  // drenar la reserva TRANSFER pendiente que aún exista en producción.
  @Cron(CronExpression.EVERY_HOUR)
  async releaseExpiredTransferReservations(): Promise<number> {
    return this.releaseStaleReservations("TRANSFER", TRANSFER_RECEIPT_GRACE_MS, "sin_comprobante_24h");
  }

  // Corre cada 10 min (no cada hora): la ventana de gracia de PayPhone es
  // corta (30 min), así que revisar solo una vez por hora dejaría un
  // casillero abandonado bloqueado hasta ~90 min en el peor caso. Diez
  // minutos acota eso a ~40 min sin cargar la base (es un SELECT indexado).
  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseExpiredPayphoneReservations(): Promise<number> {
    return this.releaseStaleReservations("PAYPHONE", LockerService.PAYPHONE_RESERVATION_GRACE_MS, "pago_no_completado");
  }

  // Núcleo compartido entre los dos cron de arriba — misma mecánica segura
  // que confirmPayphonePayment: updateMany con WHERE status:"PENDING" para
  // no pisar un pago que se confirmó por debajo justo en este instante, y
  // borrado del LockerRental (la fila que bloquea @@unique[lockerId,
  // periodId]) para liberar el cupo de verdad.
  private async releaseStaleReservations(
    method: "PAYPHONE" | "TRANSFER",
    graceMs: number,
    reason: string
  ): Promise<number> {
    const cutoff = new Date(Date.now() - graceMs);
    const expired = await this.prisma.lockerRental.findMany({
      where: { payment: { method, status: "PENDING" }, createdAt: { lte: cutoff } },
      include: { locker: true },
    });

    let released = 0;
    for (const rental of expired) {
      const freed = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: rental.paymentId, status: "PENDING" },
          data: { status: "REJECTED" },
        });
        if (count === 0) return false;

        await tx.lockerRental.delete({ where: { id: rental.id } });
        await tx.locker.update({ where: { id: rental.lockerId }, data: { status: "AVAILABLE" } });
        await this.audit.record(
          {
            // No hay un usuario "actuando" acá (lo dispara el reloj, no un
            // click) — se usa el dueño de la reserva vencida como actor
            // porque AuditLog.actorId es NOT NULL a propósito (ver
            // audit.service.ts); metadata.reason deja claro que fue
            // automático, no algo que el estudiante pidió.
            actorId: rental.userId,
            action: "locker.rental.expired",
            entityType: "LockerRental",
            entityId: rental.id,
            metadata: { lockerCode: rental.locker.code, reason },
          },
          tx
        );
        return true;
      });
      if (freed) released++;
    }

    if (released > 0) {
      this.logger.log(`Liberados ${released} casillero(s) con reserva ${method} vencida (${reason})`);
    }
    return released;
  }
}
