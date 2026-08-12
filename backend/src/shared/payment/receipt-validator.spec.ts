import { receiptMentionsAmount } from "./receipt-validator";

describe("receiptMentionsAmount", () => {
  it("Dado un texto OCR con el monto exacto con punto decimal, Cuando se valida, Entonces retorna true", () => {
    const text = "Comprobante de transferencia\nMonto: $6.50\nBanco Pichincha";
    expect(receiptMentionsAmount(text, 6.5)).toBe(true);
  });

  it("Dado un texto OCR con el monto usando coma decimal, Cuando se valida, Entonces retorna true", () => {
    const text = "Valor transferido: 6,50 USD";
    expect(receiptMentionsAmount(text, 6.5)).toBe(true);
  });

  it("Dado un texto OCR con el monto sin el cero final, Cuando se valida, Entonces retorna true", () => {
    const text = "Total: $6.5";
    expect(receiptMentionsAmount(text, 6.5)).toBe(true);
  });

  it("Dado un texto OCR con un monto distinto al esperado, Cuando se valida, Entonces retorna false", () => {
    const text = "Monto: $10.00";
    expect(receiptMentionsAmount(text, 6.5)).toBe(false);
  });

  it("Dado un texto OCR vacío (falló el reconocimiento), Cuando se valida, Entonces retorna false", () => {
    expect(receiptMentionsAmount("", 6.5)).toBe(false);
  });
});
