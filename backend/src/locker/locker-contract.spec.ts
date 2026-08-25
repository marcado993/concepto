import { titleCase, lockerContractHtml, lockerContractSubject } from "./locker-contract";

describe("titleCase", () => {
  // Pedido real del cliente: "luis" -> "Luis", "andres" -> "Andres" — una
  // mayúscula por palabra, sin importar cómo lo haya escrito el estudiante
  // (Logto/GitHub/Google a veces entregan el nombre todo en minúscula).
  it.each([
    ["luis andres", "Luis Andres"],
    ["LUIS ANDRES", "Luis Andres"],
    ["Luis Andres", "Luis Andres"],
    ["maría josé", "María José"],
    ["  luis   andres  ", "Luis Andres"], // espacios extra colapsan
    ["luis", "Luis"],
    ["", ""],
  ])("titleCase(%j) -> %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });
});

describe("lockerContractHtml / lockerContractSubject", () => {
  const data = {
    fullName: "luis andres guerrero",
    cedula: "1723456789",
    uniqueCode: "AEIS-2026-001",
    lockerCode: "A07",
    periodLabel: "2026-B",
    periodEndsAt: new Date("2027-02-28T00:00:00Z"),
    amount: 6.5,
    signedAt: new Date("2026-08-25T10:00:00Z"),
  };

  it("el asunto incluye el código del casillero", () => {
    expect(lockerContractSubject(data)).toContain("A07");
  });

  it("el cuerpo tiene el nombre en Title Case, no como lo escribió el estudiante", () => {
    const html = lockerContractHtml(data);
    expect(html).toContain("Luis Andres Guerrero");
    expect(html).not.toContain("luis andres guerrero");
  });

  it("el cuerpo incluye cédula, código único, casillero y monto reales — no placeholders", () => {
    const html = lockerContractHtml(data);
    expect(html).toContain("1723456789");
    expect(html).toContain("AEIS-2026-001");
    expect(html).toContain("A07");
    expect(html).toContain("$6.50");
  });

  // Hallazgo real al portar el texto del .docx: la fecha de fin de
  // semestre ahí está escrita a mano ("18 de febrero del 2027") pero el
  // periodo REAL en la base de datos termina el 28 de febrero del 2027.
  // El contrato tiene que usar la fecha real, no la del documento fuente.
  it("usa la fecha REAL de fin de periodo (28 de febrero), no la que trae escrita a mano el .docx original (18 de febrero)", () => {
    const html = lockerContractHtml(data);
    expect(html).toContain("28 de febrero de 2027");
    expect(html).not.toContain("18 de febrero");
  });

  it("incluye la línea de firma electrónica con el nombre del estudiante", () => {
    const html = lockerContractHtml(data);
    expect(html).toContain("Firmado electrónicamente por");
    expect(html).toContain("LUIS ANDRES GUERRERO");
  });
});
