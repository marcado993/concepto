import pdfParse from "pdf-parse";
import { lockerContractPdf } from "./locker-contract-pdf";
import type { LockerContractData } from "./locker-contract";

const data: LockerContractData = {
  fullName: "luis andres guerrero",
  cedula: "1710034065",
  uniqueCode: "AEIS-2026-001",
  lockerCode: "A07",
  periodLabel: "2026-B",
  periodEndsAt: new Date("2027-02-28T00:00:00Z"),
  amount: 6.5,
  signedAt: new Date("2026-08-25T10:00:00Z"),
};

describe("lockerContractPdf — versión descargable del mismo contrato que ya va en el HTML del correo", () => {
  it("genera un PDF real (empieza con el magic header %PDF-)", async () => {
    const pdf = await lockerContractPdf(data);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  // Mismos datos que lockerContractHtml (ver locker-contract.spec.ts) — el
  // PDF nunca debe divergir del correo: es el mismo contrato en otro
  // formato, no un texto aparte que alguien pueda desactualizar sin querer.
  it("el texto extraído incluye el nombre en Title Case, cédula, código único, casillero y monto reales", async () => {
    const pdf = await lockerContractPdf(data);
    const { text } = await pdfParse(pdf);
    expect(text).toContain("Luis Andres Guerrero");
    expect(text).not.toContain("luis andres guerrero");
    expect(text).toContain("1710034065");
    expect(text).toContain("AEIS-2026-001");
    expect(text).toContain("A07");
    expect(text).toContain("$6.50");
  });

  it("usa la fecha REAL de fin de periodo (28 de febrero), igual que el HTML del correo", async () => {
    const pdf = await lockerContractPdf(data);
    const { text } = await pdfParse(pdf);
    expect(text).toContain("28 de febrero de 2027");
    expect(text).not.toContain("18 de febrero");
  });

  it("incluye las 7 cláusulas y la firma de la presidenta", async () => {
    const pdf = await lockerContractPdf(data);
    const { text } = await pdfParse(pdf);
    expect(text).toContain("PRIMERA: Objeto del Contrato.");
    expect(text).toContain("SÉPTIMA: Aceptación.");
    expect(text).toContain("SARA LIZBETH GUAYASAMÍN NACIMBA");
  });
});
