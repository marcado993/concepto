import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { RentLockerDto, UNIQUE_CODE_PATTERN } from "./rent-locker.dto";

// Base válida — cada test solo pisa el campo que le interesa, para aislar
// justo lo que se está probando (mismo patrón BDD que el resto del backend).
// "1710034065" es una cédula real (pasa el checksum del Registro Civil) —
// "1723456789" (usada antes) tiene los 10 dígitos correctos pero NO pasa el
// checksum, así que dejó de servir como fixture en cuanto se añadió la
// validación real (ver rent-locker.dto.ts).
function makeDto(overrides: Partial<Record<string, unknown>> = {}): RentLockerDto {
  return plainToInstance(RentLockerDto, {
    lockerCode: "A07",
    fullName: "Luis Andres Guerrero",
    uniqueCode: "202120100",
    cedula: "1710034065",
    phone: "0991234567",
    acceptedTerms: true,
    ...overrides,
  });
}

describe("RentLockerDto.uniqueCode — formato real de la EPN", () => {
  // Ejemplos reales que mandó el cliente (planilla casillero → código
  // único), no inventados — confirman año+periodo+secuencial de 9 dígitos.
  it.each(["202120100", "201710909", "202221129", "201921256", "202020815"])(
    "Dado el código real %s, Cuando se valida, Entonces lo acepta",
    async (uniqueCode) => {
      const errors = await validate(makeDto({ uniqueCode }));
      expect(errors).toHaveLength(0);
    }
  );

  it.each([
    ["102120100", "no empieza en 2 (año inválido)"],
    ["202130100", "periodo 3 — solo existen 1 y 2"],
    ["20212010", "8 dígitos, falta uno"],
    ["2021201000", "10 dígitos, uno de más"],
    ["AEIS-2026-001", "formato viejo (con letras y guiones)"],
    ["", "vacío"],
  ])("Dado %s (%s), Cuando se valida, Entonces lo rechaza", async (uniqueCode) => {
    const errors = await validate(makeDto({ uniqueCode }));
    expect(errors.some((e) => e.property === "uniqueCode")).toBe(true);
  });

  it("El secuencial (últimos 4 dígitos) acepta cualquier valor — no tiene patrón propio", () => {
    expect(UNIQUE_CODE_PATTERN.test("202120000")).toBe(true);
    expect(UNIQUE_CODE_PATTERN.test("202129999")).toBe(true);
  });
});

describe("RentLockerDto.cedula — validación real ecuatoriana (checksum, no solo 10 dígitos)", () => {
  // Cédulas reales que sí pasan el checksum del Registro Civil (verificadas
  // a mano con el algoritmo, no inventadas al azar).
  it.each(["1710034065", "1723456784"])(
    "Dada la cédula real %s, Cuando se valida, Entonces la acepta",
    async (cedula) => {
      const errors = await validate(makeDto({ cedula }));
      expect(errors.some((e) => e.property === "cedula")).toBe(false);
    }
  );

  it.each([
    ["1723456789", "10 dígitos correctos pero el dígito verificador no cuadra"],
    ["9999999999", "provincia 99 — no existe (máximo 24)"],
    ["1793456789", "tercer dígito 9 — formato de RUC (persona jurídica), no de cédula"],
    ["172345678", "9 dígitos, falta uno"],
    ["17234567890", "11 dígitos, uno de más"],
    ["172345678A", "con una letra"],
    ["", "vacío"],
  ])("Dada %s (%s), Cuando se valida, Entonces la rechaza", async (cedula) => {
    const errors = await validate(makeDto({ cedula }));
    expect(errors.some((e) => e.property === "cedula")).toBe(true);
  });
});

describe("RentLockerDto.fullName", () => {
  // Pedido real: lo que trae Logto/GitHub/Google puede venir incompleto o
  // ser un username — el alquiler exige el nombre completo de verdad,
  // porque es literalmente el que sale firmado en el contrato.
  it.each(["Luis Andres Guerrero", "María José Andrade Torres", "Ana Paz"])(
    "Dado el nombre completo %s, Cuando se valida, Entonces lo acepta",
    async (fullName) => {
      const errors = await validate(makeDto({ fullName }));
      expect(errors.some((e) => e.property === "fullName")).toBe(false);
    }
  );

  it.each([
    ["luis", "una sola palabra — no es un nombre completo"],
    ["", "vacío"],
    ["   ", "solo espacios"],
    ["<script>alert(1)</script> Guerrero", "payload HTML/script — este nombre termina en el HTML crudo del correo del contrato"],
    ["Luis ${process.env} Guerrero", "template injection — placeholder de JS"],
    ["Luis {{7*7}} Guerrero", "template injection — placeholder estilo Handlebars/SSTI"],
  ])("Dado %s (%s), Cuando se valida, Entonces lo rechaza", async (fullName) => {
    const errors = await validate(makeDto({ fullName }));
    expect(errors.some((e) => e.property === "fullName")).toBe(true);
  });
});
