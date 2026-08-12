// Precio de casillero por método de pago.
//
// Fuente de la regla: docs/dominio/03-analisis-financiero-costos.md §4 y
// docs/dominio/04-alternativas-tecnologicas-y-costos.md §4 — precio único
// por semestre, NO tramos por disponibilidad (esa idea se descartó
// explícitamente). El +$0.40 en PayPhone traslada al usuario el fee real
// de la pasarela (5% + IVA sobre la comisión ≈ $0.374 sobre $6.50).
//
// El precio base ($6.50) es configurable porque el sponsor puede fijar
// cualquier valor entre $5.50 y $9.00 según la utilidad objetivo (PDF
// Sección 8.7) — lo que NO es configurable es que PayPhone siempre cueste
// $0.40 más que transferencia, porque ese delta cubre un costo real de
// terceros, no una decisión de negocio.

export type PaymentMethod = "TRANSFER" | "PAYPHONE";

export const PAYPHONE_SURCHARGE = 0.4;

export interface RentalPrice {
  method: PaymentMethod;
  amount: number;
  currency: "USD";
}

// discountPercent (0-100) viene del dominio de Aportaciones — ver
// SubscriptionBenefitsService.getLockerDiscountPercent(). Se aplica sobre
// el precio BASE, antes del recargo de PayPhone: el descuento es un
// beneficio sobre el alquiler en sí, el recargo es un costo de terceros
// que no cambia según quién paga.
export function calculateLockerPrice(
  basePrice: number,
  method: PaymentMethod,
  discountPercent = 0
): RentalPrice {
  if (basePrice <= 0) {
    throw new Error("basePrice debe ser positivo");
  }
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error("discountPercent debe estar entre 0 y 100");
  }
  const discountedBase = basePrice * (1 - discountPercent / 100);
  const amount =
    method === "PAYPHONE"
      ? round2(discountedBase + PAYPHONE_SURCHARGE)
      : round2(discountedBase);
  return { method, amount, currency: "USD" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
