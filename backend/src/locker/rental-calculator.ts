// Precio de casillero — PayPhone es el único método de pago (transferencia
// + comprobante por OCR se retiró: decisión real del cliente, ver git log
// de este archivo si hace falta el contexto histórico de cuando existían
// dos métodos).
//
// Fuente de la regla: docs/dominio/03-analisis-financiero-costos.md §4 y
// docs/dominio/04-alternativas-tecnologicas-y-costos.md §4 — precio único
// por semestre, NO tramos por disponibilidad (esa idea se descartó
// explícitamente).
//
// El recargo de +$0.40 que cubría el fee real de PayPhone (existía para
// que quien pagara por transferencia, más barata para AEIS, no subsidiara
// a quien pagaba por PayPhone) se retiró junto con transferencia: decisión
// real del cliente — con un solo método, ya no hay nada que diferenciar, y
// el precio vuelve a ser el mismo $6.50 de siempre para todos.
//
// El precio base ($6.50) es configurable porque el sponsor puede fijar
// cualquier valor entre $5.50 y $9.00 según la utilidad objetivo (PDF
// Sección 8.7).

export type PaymentMethod = "PAYPHONE";

export interface RentalPrice {
  method: PaymentMethod;
  amount: number;
  currency: "USD";
}

// discountPercent (0-100) viene del dominio de Aportaciones — ver
// SubscriptionBenefitsService.getLockerDiscountPercent().
export function calculateLockerPrice(basePrice: number, discountPercent = 0): RentalPrice {
  if (basePrice <= 0) {
    throw new Error("basePrice debe ser positivo");
  }
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error("discountPercent debe estar entre 0 y 100");
  }
  const discountedBase = basePrice * (1 - discountPercent / 100);
  return { method: "PAYPHONE", amount: round2(discountedBase), currency: "USD" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
