import { calculateLockerPrice, PAYPHONE_SURCHARGE } from "./rental-calculator";

describe("calculateLockerPrice", () => {
  it("Dado un precio base de $6.50, Cuando el estudiante paga por transferencia, Entonces el precio cobrado es $6.50", () => {
    const price = calculateLockerPrice(6.5, "TRANSFER");
    expect(price).toEqual({ method: "TRANSFER", amount: 6.5, currency: "USD" });
  });

  it("Dado un precio base de $6.50, Cuando el estudiante paga por PayPhone, Entonces el precio cobrado es $6.90 (traslada el fee de la pasarela)", () => {
    const price = calculateLockerPrice(6.5, "PAYPHONE");
    expect(price.amount).toBe(6.9);
  });

  it("Dado cualquier precio base semestral fijado por la directiva, Cuando se paga por PayPhone, Entonces siempre se suma el mismo recargo fijo", () => {
    const seven = calculateLockerPrice(7.0, "PAYPHONE");
    const nine = calculateLockerPrice(9.0, "PAYPHONE");
    expect(seven.amount).toBeCloseTo(7.0 + PAYPHONE_SURCHARGE, 2);
    expect(nine.amount).toBeCloseTo(9.0 + PAYPHONE_SURCHARGE, 2);
  });

  it("Dado un precio base inválido, Cuando se intenta calcular, Entonces rechaza en vez de cobrar $0 o negativo", () => {
    expect(() => calculateLockerPrice(0, "TRANSFER")).toThrow();
    expect(() => calculateLockerPrice(-1, "PAYPHONE")).toThrow();
  });

  it("Dado un precio base con más de 2 decimales tras sumar el recargo, Cuando se calcula, Entonces redondea a centavos (nunca fracciones de centavo en un cobro real)", () => {
    const price = calculateLockerPrice(6.33, "PAYPHONE");
    expect(price.amount).toBe(6.73);
  });

  // Descuento por aportación (ver subscription/subscription-benefits.service.ts)
  it("Dado un descuento del 20% (tier de Aportaciones), Cuando se paga por transferencia, Entonces se aplica sobre el precio base ANTES de cualquier recargo", () => {
    const price = calculateLockerPrice(6.5, "TRANSFER", 20);
    expect(price.amount).toBe(5.2); // 6.50 × 0.8
  });

  it("Dado un descuento del 20%, Cuando se paga por PayPhone, Entonces el recargo fijo se suma DESPUÉS del descuento (el fee de la pasarela no cambia por el beneficio)", () => {
    const price = calculateLockerPrice(6.5, "PAYPHONE", 20);
    expect(price.amount).toBe(5.6); // (6.50 × 0.8) + 0.40
  });

  it("Dado un descuento del 0% (sin aportación), Cuando se calcula, Entonces el precio es idéntico al de siempre", () => {
    expect(calculateLockerPrice(6.5, "TRANSFER", 0).amount).toBe(6.5);
  });

  it("Dado un descuento fuera de rango, Cuando se intenta calcular, Entonces rechaza en vez de cobrar de más o dar un casillero gratis por error", () => {
    expect(() => calculateLockerPrice(6.5, "TRANSFER", -1)).toThrow();
    expect(() => calculateLockerPrice(6.5, "TRANSFER", 101)).toThrow();
  });
});
