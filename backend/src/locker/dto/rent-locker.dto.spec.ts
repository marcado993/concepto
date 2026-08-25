import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { RentLockerDto, UNIQUE_CODE_PATTERN } from "./rent-locker.dto";

// Base válida — cada test solo pisa uniqueCode, para aislar justo lo que
// se está probando (mismo patrón BDD que el resto del backend).
function makeDto(uniqueCode: string): RentLockerDto {
  return plainToInstance(RentLockerDto, {
    lockerCode: "A07",
    uniqueCode,
    cedula: "1723456789",
    phone: "0991234567",
    acceptedTerms: true,
  });
}

describe("RentLockerDto.uniqueCode — formato real de la EPN", () => {
  // Ejemplos reales que mandó el cliente (planilla casillero → código
  // único), no inventados — confirman año+periodo+secuencial de 9 dígitos.
  it.each(["202120100", "201710909", "202221129", "201921256", "202020815"])(
    "Dado el código real %s, Cuando se valida, Entonces lo acepta",
    async (uniqueCode) => {
      const errors = await validate(makeDto(uniqueCode));
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
    const errors = await validate(makeDto(uniqueCode));
    expect(errors.some((e) => e.property === "uniqueCode")).toBe(true);
  });

  it("El secuencial (últimos 4 dígitos) acepta cualquier valor — no tiene patrón propio", () => {
    expect(UNIQUE_CODE_PATTERN.test("202120000")).toBe(true);
    expect(UNIQUE_CODE_PATTERN.test("202129999")).toBe(true);
  });
});
