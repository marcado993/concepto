import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma/prisma.service";
import { PeriodService } from "../shared/period/period.service";

// El PUERTO del dominio de Aportaciones hacia el resto de la app — lo único
// que SubscriptionModule exporta (ver subscription.module.ts). Un aportante
// con tier confirmado puede traer beneficios que afectan OTROS dominios
// (ej. "descuento_casillero" en el tier — ver prisma/seed.ts). Resolver eso
// AQUÍ, detrás de un método con nombre de caso de uso, es lo que separa un
// dominio real de solo una carpeta llamada "subscription": LockerService
// nunca lee la tabla Subscription directamente ni conoce la forma del JSON
// de beneficios — solo pregunta "¿cuánto descuento tiene este estudiante en
// casilleros?" y no le importa cómo se resuelve esa respuesta.
@Injectable()
export class SubscriptionBenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly period: PeriodService
  ) {}

  // 0 si no hay aportación CONFIRMADA este periodo (una PENDING sin pagar
  // todavía no da beneficios reales), o si el tier no trae ese beneficio.
  // Nunca lanza — un fallo resolviendo el descuento no debe tumbar el
  // flujo de alquiler de casilleros, en el peor caso el estudiante paga
  // el precio de lista.
  async getLockerDiscountPercent(userId: string): Promise<number> {
    const periodId = await this.period.getCurrentPeriodId();
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId_periodId: { userId, periodId } },
      include: { tier: true, payment: true },
    });
    if (!subscription || subscription.payment.status !== "CONFIRMED") return 0;

    const benefits = (subscription.tier.benefits as unknown as Array<Record<string, unknown>>) ?? [];
    const lockerBenefit = benefits.find((b) => b.type === "descuento_casillero");
    const percent = typeof lockerBenefit?.percent === "number" ? lockerBenefit.percent : 0;

    // Nunca confiar ciegamente en el JSON libre de benefits (schema.prisma
    // lo deja sin tipar a propósito) — un valor fuera de rango ahí no debe
    // poder convertirse en un casillero gratis o en un precio negativo.
    return Math.max(0, Math.min(100, percent));
  }
}
