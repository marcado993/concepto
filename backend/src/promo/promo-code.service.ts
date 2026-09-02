import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";

// Códigos promocionales de casillero — reemplazan al descuento automático
// por tier de aportación (ver el comentario del modelo en schema.prisma
// para el porqué de alcance).
//
// La directiva los genera desde el panel y los reparte por su cuenta. La
// app solo responde: "¿este código es válido y cuánto descuenta?".

/**
 * Alfabeto del código.
 *
 * Sin 0/O ni 1/I/L: estos códigos se dictan por WhatsApp y se copian a
 * mano de un correo, y esos pares son indistinguibles en la mayoría de
 * tipografías. Un código que no se puede leer sin equivocarse genera
 * "no me funciona" que en realidad son erratas.
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PREFIJO = "AEIS";
const GRUPOS = 2;
const LARGO_GRUPO = 4;

/** Tope por lote — evita que un cero de más genere 10 000 códigos. */
export const MAX_POR_LOTE = 200;

export interface PromoCodePublic {
  id: string;
  code: string;
  discountPercent: number;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
  redeemedAt: string | null;
  /** Quién lo canjeó — nombre real, para que la directiva reconozca a la persona. */
  redeemedBy: string | null;
  /** Estado ya resuelto: la UI no debería tener que derivarlo de tres campos. */
  status: "disponible" | "canjeado" | "vencido";
}

@Injectable()
export class PromoCodeService {
  private readonly logger = new Logger(PromoCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * Genera un código legible con `randomInt` del módulo crypto.
   *
   * NO `Math.random()`: estos códigos valen dinero (uno del 100% es un
   * casillero gratis) y `Math.random()` es predecible — conociendo unos
   * pocos códigos emitidos se puede derivar el estado del generador y
   * adivinar los siguientes. El espacio de 31^8 (~850 mil millones) hace
   * inviable adivinar a ciegas, pero solo si los valores son de verdad
   * impredecibles.
   */
  generarCodigo(): string {
    const grupos: string[] = [];
    for (let g = 0; g < GRUPOS; g += 1) {
      let grupo = "";
      for (let i = 0; i < LARGO_GRUPO; i += 1) {
        grupo += ALFABETO[randomInt(ALFABETO.length)];
      }
      grupos.push(grupo);
    }
    return [PREFIJO, ...grupos].join("-");
  }

  /**
   * Crea un lote de códigos.
   *
   * Devuelve los códigos en claro — es la única vez que se muestran juntos
   * y listos para copiar. No hay nada que ocultar después: el listado los
   * sigue mostrando, porque la directiva tiene que poder reenviarle su
   * código a quien lo perdió.
   */
  async crearLote(params: {
    cantidad: number;
    discountPercent: number;
    note?: string;
    expiresAt?: Date;
    adminActorId: string;
    ipAddress?: string;
  }): Promise<PromoCodePublic[]> {
    const { cantidad, discountPercent } = params;
    if (cantidad < 1 || cantidad > MAX_POR_LOTE) {
      throw new BadRequestException(`La cantidad debe estar entre 1 y ${MAX_POR_LOTE}`);
    }
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      throw new BadRequestException("El descuento debe ser un entero entre 1 y 100");
    }

    const creados: PromoCodePublic[] = [];
    for (let i = 0; i < cantidad; i += 1) {
      creados.push(toPublic(await this.crearUno(params)));
    }

    // Se audita el LOTE, no cada código: lo que interesa reconstruir después
    // es "quién autorizó regalar 20 casilleros al 100% y cuándo", no veinte
    // entradas idénticas.
    await this.audit.record({
      adminActorId: params.adminActorId,
      action: "admin.promo_code.batch_created",
      entityType: "PromoCode",
      entityId: "batch",
      ipAddress: params.ipAddress,
      metadata: {
        cantidad,
        discountPercent,
        note: params.note ?? null,
        codigos: creados.map((c) => c.code),
      },
    });

    this.logger.log(`Lote de ${cantidad} codigos al ${discountPercent}% creado por admin ${params.adminActorId}`);
    return creados;
  }

  /**
   * Inserta un código reintentando ante colisión.
   *
   * Una colisión en 31^8 es improbabilísima, pero "improbable" no es
   * "imposible" y el modo de falla sería un 500 opaco justo cuando la
   * directiva está generando códigos para repartir. Tres intentos y se
   * rinde con un mensaje claro.
   */
  private async crearUno(params: {
    discountPercent: number;
    note?: string;
    expiresAt?: Date;
    adminActorId: string;
  }) {
    for (let intento = 0; intento < 3; intento += 1) {
      try {
        return await this.prisma.promoCode.create({
          data: {
            code: this.generarCodigo(),
            discountPercent: params.discountPercent,
            note: params.note ?? null,
            expiresAt: params.expiresAt ?? null,
            createdByAdminId: params.adminActorId,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          this.logger.warn("Colision de codigo promocional — reintentando");
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException("No se pudo generar un código único — intenta de nuevo");
  }

  async listar(): Promise<PromoCodePublic[]> {
    const filas = await this.prisma.promoCode.findMany({
      orderBy: { createdAt: "desc" },
      include: { redeemedByUser: { select: { fullName: true } } },
      take: 500,
    });
    return filas.map(toPublic);
  }

  async resumen(): Promise<{ total: number; disponibles: number; canjeados: number }> {
    const [total, canjeados] = await Promise.all([
      this.prisma.promoCode.count(),
      this.prisma.promoCode.count({ where: { redeemedAt: { not: null } } }),
    ]);
    return { total, canjeados, disponibles: total - canjeados };
  }

  /**
   * Consulta si un código sirve, SIN canjearlo.
   *
   * Existe para que el estudiante vea el precio con descuento antes de
   * pagar. Devuelve un motivo legible en vez de lanzar: acá "no sirve" es
   * una respuesta esperada del formulario, no un error del sistema.
   */
  async verificar(code: string): Promise<{ valido: boolean; discountPercent: number; motivo?: string }> {
    const promo = await this.prisma.promoCode.findUnique({ where: { code: normalizar(code) } });
    if (!promo) return { valido: false, discountPercent: 0, motivo: "Ese código no existe" };
    if (promo.redeemedAt) return { valido: false, discountPercent: 0, motivo: "Ese código ya fue usado" };
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      return { valido: false, discountPercent: 0, motivo: "Ese código ya venció" };
    }
    return { valido: true, discountPercent: promo.discountPercent };
  }

  /**
   * Canjea el código de forma ATÓMICA y devuelve su descuento.
   *
   * El `updateMany` con `redeemedAt: null` en el WHERE es la pieza clave, y
   * no es una preferencia de estilo: leer-y-después-escribir permite que dos
   * alquileres simultáneos con el mismo código pasen ambos la comprobación
   * y lo usen los dos. Acá Postgres decide — solo una de las dos
   * transacciones ve `count === 1`, la otra ve 0 y recibe "ya fue usado".
   *
   * Corre DENTRO de la transacción del alquiler (`tx`): si la creación del
   * alquiler falla después, el canje se revierte con ella y el código queda
   * libre. Canjear fuera de la transacción habría quemado códigos en cada
   * alquiler fallido.
   */
  async canjear(
    tx: Prisma.TransactionClient,
    params: { code: string; userId: string; rentalId: string }
  ): Promise<number> {
    const code = normalizar(params.code);
    const promo = await tx.promoCode.findUnique({ where: { code } });
    if (!promo) throw new BadRequestException("Ese código no existe");
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new BadRequestException("Ese código ya venció");
    }

    const { count } = await tx.promoCode.updateMany({
      where: { code, redeemedAt: null },
      data: { redeemedAt: new Date(), redeemedByUserId: params.userId, redeemedRentalId: params.rentalId },
    });
    if (count === 0) throw new BadRequestException("Ese código ya fue usado");

    return promo.discountPercent;
  }
}

/**
 * Normaliza lo que escribe el estudiante.
 *
 * Los códigos se dictan y se copian a mano, así que llegan en minúsculas,
 * con espacios pegados del portapapeles, o con los guiones omitidos. Nada
 * de eso debería ser un "código inválido" — el alfabeto no incluye guiones
 * ni minúsculas, así que se puede reconstruir sin ambigüedad.
 */
export function normalizar(code: string): string {
  const limpio = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const sinPrefijo = limpio.startsWith(PREFIJO) ? limpio.slice(PREFIJO.length) : limpio;
  const grupos = sinPrefijo.match(/.{1,4}/g) ?? [];
  return [PREFIJO, ...grupos].join("-");
}

function toPublic(p: {
  id: string;
  code: string;
  discountPercent: number;
  note: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  redeemedAt: Date | null;
  redeemedByUser?: { fullName: string } | null;
}): PromoCodePublic {
  const vencido = !p.redeemedAt && p.expiresAt !== null && p.expiresAt < new Date();
  return {
    id: p.id,
    code: p.code,
    discountPercent: p.discountPercent,
    note: p.note,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    redeemedAt: p.redeemedAt?.toISOString() ?? null,
    redeemedBy: p.redeemedByUser?.fullName ?? null,
    status: p.redeemedAt ? "canjeado" : vencido ? "vencido" : "disponible",
  };
}
