import { validate } from "class-validator";
import { esCedulaEcuatorianaValida, IsCedulaEcuatoriana } from "./cedula-ecuatoriana.pattern";

// Casos borde del ALGORITMO en sí — rent-locker.dto.spec.ts ya prueba esto
// a través del DTO completo, este archivo prueba la función pura,
// aislando cada frontera exacta (provincia 0/1/24/25, tercer dígito 5/6,
// el caso suma%10===0 del checksum) que un test end-to-end no deja ver con
// claridad cuál regla específica falló.
describe("esCedulaEcuatorianaValida — fronteras exactas del algoritmo", () => {
  it("Dada la provincia 00, Cuando se valida, Entonces la rechaza (mínimo real es 01)", () => {
    expect(esCedulaEcuatorianaValida("0010000009")).toBe(false);
  });

  it("Dada la provincia 24 (frontera superior real), Cuando se valida, Entonces SÍ la acepta si el resto cuadra", () => {
    // 24 + tercer dígito 0 + checksum calculado a mano para este caso
    // (suma ponderada = 8, dígito verificador = 10 - 8 = 2).
    expect(esCedulaEcuatorianaValida("2400000002")).toBe(true);
  });

  it("Dada la provincia 25 (una más que la frontera superior real), Cuando se valida, Entonces la rechaza", () => {
    expect(esCedulaEcuatorianaValida("2510000003")).toBe(false);
  });

  it("Dado el tercer dígito exactamente 5 (frontera superior de persona natural), Cuando el resto cuadra, Entonces la acepta", () => {
    // Suma ponderada = 10 -> dígito verificador = 0 (rama especial, ver
    // el siguiente test para esa misma regla aislada).
    expect(esCedulaEcuatorianaValida("1750000000")).toBe(true);
  });

  it("Dado el tercer dígito exactamente 6 (una más — ya es RUC de entidad pública, no cédula), Cuando se valida, Entonces la rechaza", () => {
    expect(esCedulaEcuatorianaValida("1760000009")).toBe(false);
  });

  it("Dado un caso donde la suma del checksum es múltiplo exacto de 10, Cuando se valida, Entonces el dígito verificador es 0 (rama especial del algoritmo, no 10-0=10)", () => {
    // Provincia 19, tercer dígito 0, suma ponderada = 20 -> dígito 0.
    expect(esCedulaEcuatorianaValida("1909000000")).toBe(true);
  });

  it.each([
    ["", "vacío"],
    ["123456789", "9 dígitos"],
    ["12345678901", "11 dígitos"],
    ["17104650a5", "con una letra"],
    ["17-1003406", "con guión"],
    [" 1710034065", "con espacio al inicio"],
    ["1710034065 ", "con espacio al final"],
  ])("Dado %s (%s), Cuando se valida, Entonces la rechaza sin lanzar excepción", (cedula) => {
    expect(esCedulaEcuatorianaValida(cedula)).toBe(false);
  });

  it("Dado un dígito verificador correcto EXCEPTO por el último dígito (off-by-one), Cuando se valida, Entonces la rechaza — no basta con 'parecerse'", () => {
    // "1710034065" es válida (ver rent-locker.dto.spec.ts); cambiar solo el
    // último dígito por el siguiente no debe colar por redondeo/tolerancia.
    expect(esCedulaEcuatorianaValida("1710034066")).toBe(false);
  });
});

describe("IsCedulaEcuatoriana — decorador de class-validator, tipos no-string", () => {
  class Fixture {
    @IsCedulaEcuatoriana()
    cedula!: unknown;
  }

  const nonStringValues: [unknown, string][] = [
    [1710034065, "número, no string — el JSON del cliente podría mandar esto sin comillas"],
    [null, "null"],
    [undefined, "undefined"],
    [{}, "objeto"],
    [["1710034065"], "array"],
  ];

  it.each(nonStringValues)("Dado %j (%s) en vez de un string, Cuando se valida, Entonces lo rechaza sin lanzar (nunca un 500 crudo)", async (value) => {
    const instance = new Fixture();
    instance.cedula = value;
    const errors = await validate(instance);
    expect(errors.some((e) => e.property === "cedula")).toBe(true);
  });
});
