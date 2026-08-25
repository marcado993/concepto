import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { RentLockerDto, UNIQUE_CODE_PATTERN } from "./rent-locker.dto";

// Base válida — cada test solo pisa el campo que le interesa, para aislar
// justo lo que se está probando (mismo patrón BDD que el resto del backend).
function makeDto(overrides: Partial<Record<string, unknown>> = {}): RentLockerDto {
  return plainToInstance(RentLockerDto, {
    lockerCode: "A07",
    fullName: "Luis Andres Guerrero",
    uniqueCode: "202120100",
    cedula: "1723456789",
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
  ])("Dado %s (%s), Cuando se valida, Entonces lo rechaza", async (fullName) => {
    const errors = await validate(makeDto({ fullName }));
    expect(errors.some((e) => e.property === "fullName")).toBe(true);
  });
});
