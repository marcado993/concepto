import { calculateLockerPrice } from "./rental-calculator";

describe("calculateLockerPrice", () => {
  it("Dado un precio base de $6.50, Cuando se calcula, Entonces el precio cobrado es $6.50 — un solo precio para todos, sin recargo por método (PayPhone es el único)", () => {
    const price = calculateLockerPrice(6.5);
    expect(price).toEqual({ method: "PAYPHONE", amount: 6.5, currency: "USD" });
  });

  it("Dado cualquier precio base semestral fijado por la directiva, Cuando se calcula sin descuento, Entonces el precio cobrado es exactamente ese precio base", () => {
    expect(calculateLockerPrice(7.0).amount).toBe(7.0);
    expect(calculateLockerPrice(9.0).amount).toBe(9.0);
  });

  it("Dado un precio base inválido, Cuando se intenta calcular, Entonces rechaza en vez de cobrar $0 o negativo", () => {
    expect(() => calculateLockerPrice(0)).toThrow();
    expect(() => calculateLockerPrice(-1)).toThrow();
  });

  it("Dado un precio base con más de 2 decimales tras aplicar el descuento, Cuando se calcula, Entonces redondea a centavos (nunca fracciones de centavo en un cobro real)", () => {
    const price = calculateLockerPrice(6.333, 0);
    expect(price.amount).toBe(6.33);
  });

  // Descuento por aportación (ver subscription/subscription-benefits.service.ts)
  it("Dado un descuento del 20% (tier de Aportaciones), Cuando se calcula, Entonces se aplica sobre el precio base", () => {
    const price = calculateLockerPrice(6.5, 20);
    expect(price.amount).toBe(5.2); // 6.50 × 0.8
  });

  it("Dado un descuento del 0% (sin aportación), Cuando se calcula, Entonces el precio es el de siempre", () => {
    expect(calculateLockerPrice(6.5, 0).amount).toBe(6.5);
  });

  it("Dado un descuento fuera de rango, Cuando se intenta calcular, Entonces rechaza en vez de cobrar de más o dar un casillero gratis por error", () => {
    expect(() => calculateLockerPrice(6.5, -1)).toThrow();
    expect(() => calculateLockerPrice(6.5, 101)).toThrow();
  });
});
