// Valida (de forma heurística, no criptográfica) que el texto extraído por
// OCR de un comprobante de transferencia contenga el monto esperado.
//
// Esto NO es una verificación bancaria real — es un filtro de primera línea
// contra el error más común (subir la foto equivocada, o un comprobante de
// otro monto) para no saturar al PRESIDENTE con revisiones manuales
// triviales. La aprobación final del casillero como RENTED sigue siendo
// responsabilidad humana revisable (el comprobante queda archivado via
// AuditLog.metadata), no una autorización automática ciega.
export function receiptMentionsAmount(ocrText: string, expectedAmount: number): boolean {
  const normalized = ocrText.toLowerCase();

  // "6.50", "6,50", "6.5", "$6.50" — separador decimal . o , indistinto,
  // con o sin ceros de relleno, con o sin símbolo de moneda antes.
  const amountStr = expectedAmount.toFixed(2); // "6.50"
  const [whole, decimals] = amountStr.split(".");
  const patterns = [
    `${whole}.${decimals}`,
    `${whole},${decimals}`,
    `${whole}.${decimals[0]}`, // "6.5" (sin el cero final)
    `${whole},${decimals[0]}`,
  ];

  return patterns.some((p) => normalized.includes(p));
}
