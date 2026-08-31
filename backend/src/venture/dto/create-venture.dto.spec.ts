import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateVentureDto } from "./create-venture.dto";

function makeDto(overrides: Partial<Record<string, unknown>> = {}): CreateVentureDto {
  return plainToInstance(CreateVentureDto, {
    name: "Café del Politécnico",
    description: "Café de especialidad tostado por estudiantes de Sistemas.",
    category: "Alimentos",
    whatsappNumber: "593987654321",
    ...overrides,
  });
}

describe("CreateVentureDto — name/description/category rechazan payloads de texto", () => {
  it.each(["name", "description", "category"] as const)(
    "Dado texto de negocio real en %s, Cuando se valida, Entonces lo acepta",
    async (field) => {
      const errors = await validate(makeDto());
      expect(errors.some((e) => e.property === field)).toBe(false);
    }
  );

  it.each([
    ["<script>alert(1)</script>", "tag script"],
    ['<img src=x onerror="alert(1)">', "tag img con handler inline"],
    ["Café ${7*7} del Poli", "template injection JS"],
    ["Café {{constructor.constructor('alert(1)')()}} del Poli", "SSTI estilo Handlebars"],
  ])("Dado %s (%s) en cualquiera de los tres campos, Cuando se valida, Entonces lo rechaza", async (payload) => {
    const errorsName = await validate(makeDto({ name: payload }));
    const errorsDescription = await validate(makeDto({ description: `${payload} — descripción real de relleno` }));
    const errorsCategory = await validate(makeDto({ category: payload }));

    expect(errorsName.some((e) => e.property === "name")).toBe(true);
    expect(errorsDescription.some((e) => e.property === "description")).toBe(true);
    expect(errorsCategory.some((e) => e.property === "category")).toBe(true);
  });

  it("Dado un payload escondido en la SEGUNDA línea de una descripción multilínea, Cuando se valida, Entonces lo rechaza igual (el regex cruza saltos de línea a propósito)", async () => {
    const errors = await validate(
      makeDto({ description: "Primera línea normal y larga de verdad.\n<script>alert(1)</script>" })
    );

    expect(errors.some((e) => e.property === "description")).toBe(true);
  });
});
