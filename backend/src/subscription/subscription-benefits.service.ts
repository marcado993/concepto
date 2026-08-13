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
// Puerto de solo lectura (findUnique), no muta ninguna tabla; no hay nada
// que auditar.
@Injectable() // nosemgrep: policy.money-mutation-must-call-audit-service
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
    return (await this.getLockerDiscountInfo(userId)).discountPercent;
  }

  // Misma resolución que getLockerDiscountPercent(), pero con el nombre del
  // tier — para que el frontend pueda mostrar "Aplicamos tu descuento de
  // Plan Platino" en vez de solo un número, sin tener que preguntarle al
  // estudiante si es aportante (ver RentLockerModal.svelte). tierName es
  // null si no hay aportación confirmada este periodo.
  async getLockerDiscountInfo(userId: string): Promise<{ discountPercent: number; tierName: string | null }> {
    const periodId = await this.period.getCurrentPeriodId();
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId_periodId: { userId, periodId } },
      include: { tier: true, payment: true },
    });
    if (!subscription || subscription.payment.status !== "CONFIRMED") {
      return { discountPercent: 0, tierName: null };
    }

    const benefits = (subscription.tier.benefits as unknown as Array<Record<string, unknown>>) ?? [];
    const lockerBenefit = benefits.find((b) => b.type === "descuento_casillero");
    const percent = typeof lockerBenefit?.percent === "number" ? lockerBenefit.percent : 0;

    // Nunca confiar ciegamente en el JSON libre de benefits (schema.prisma
    // lo deja sin tipar a propósito) — un valor fuera de rango ahí no debe
    // poder convertirse en un casillero gratis o en un precio negativo.
    return { discountPercent: Math.max(0, Math.min(100, percent)), tierName: subscription.tier.name };
  }
}
