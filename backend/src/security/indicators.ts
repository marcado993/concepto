// Auditoría (2026-08-10): mismo contenido que vivía embebido en
// src/lib/data.ts del frontend (categoría "security"), movido aquí sin
// alterar las cifras — solo cambia DÓNDE vive el dato, no qué dice.
//
// Fuente original (preservada tal cual del comentario del frontend): cifras
// publicadas para el Distrito Metropolitano de Quito, cierre de 2025, del
// Observatorio Metropolitano de Seguridad Ciudadana (Policía Nacional +
// Fiscalía), según reportó Primicias en enero de 2026. Son totales
// anuales, no un feed en vivo — el DataHub mensual del DMQ está detrás de
// un login, así que cualquier actualización automática sería una
// suposición. Por eso cada valor lleva su periodo en la unidad.

export type RiskLevel = "low" | "moderate" | "high";

export interface SecurityIndicator {
  id: string;
  label: string;
  value: string;
  unit: string;
  risk: RiskLevel;
  note: string;
  trend?: "up" | "down" | "flat";
}

export const SECURITY_INDICATORS: SecurityIndicator[] = [
  { id: "s1", label: "Tasa de homicidios", value: "9", unit: "por 100.000 hab. · 2025", risk: "moderate", note: "8 en 2024", trend: "up" },
  { id: "s2", label: "Homicidios intencionales", value: "264", unit: "casos · 2025", risk: "moderate", note: "248 en 2024", trend: "up" },
  { id: "s3", label: "Violencia criminal", value: "204", unit: "casos · 2025", risk: "high", note: "179 en 2024", trend: "up" },
  { id: "s4", label: "Riñas interpersonales", value: "60", unit: "casos · 2025", risk: "low", note: "69 en 2024", trend: "down" },
  { id: "s5", label: "Con arma de fuego", value: "163", unit: "casos · 2025", risk: "high", note: "143 en 2024", trend: "up" },
  { id: "s6", label: "Incidentes Centro Histórico", value: "14.842", unit: "convivencia · 2025", risk: "moderate", note: "17.449 en 2024", trend: "down" },
];
