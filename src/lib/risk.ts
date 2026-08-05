/**
 * Illustrative day-part risk curve for the "Seguridad" module — NOT live
 * data. It mirrors the general shape public safety observatories describe
 * (quieter mid-morning, rising through the evening, peaking overnight),
 * scaled 0 (calmest) to 1 (highest historical incidence), so the module's
 * tone shifts with the clock the way the real indicator would. For actual
 * current figures, see observatorioseguridad.quito.gob.ec.
 */
const HOURLY_RISK = [
  0.62, 0.68, 0.74, 0.8, 0.86, 0.78, // 00-05
  0.55, 0.35, 0.24, 0.2, 0.2, 0.24, // 06-11
  0.28, 0.3, 0.3, 0.34, 0.4, 0.5, // 12-17
  0.6, 0.7, 0.78, 0.84, 0.8, 0.7, // 18-23
];

export function riskForHour(hour: number): number {
  return HOURLY_RISK[((hour % 24) + 24) % 24];
}

interface RiskTheme {
  accent: string;
  accentDim: string;
  deep: string;
  glow: string;
  hue: number;
  label: string;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixHex(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(lerp(v, pb[i], t)));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const STOPS = [
  { at: 0, color: "#21e0a0", label: "Riesgo bajo" }, // AEIS green
  { at: 0.5, color: "#f5b942", label: "Riesgo moderado" }, // amber
  { at: 1, color: "#ef4444", label: "Riesgo alto" }, // red
];

/** Maps a 0..1 risk value to a themed color set consistent with the rest
 *  of the app's palette formula (accent / dim / deep / glow). */
export function themeForRisk(risk: number): RiskTheme {
  const r = Math.max(0, Math.min(1, risk));
  const [a, b] = r < 0.5 ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]];
  const t = r < 0.5 ? r / 0.5 : (r - 0.5) / 0.5;
  const accent = mixHex(a.color, b.color, t);
  const label = t < 0.5 ? a.label : b.label;

  const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  const dim = `#${[rr, gg, bb].map((v) => Math.round(v * 0.32).toString(16).padStart(2, "0")).join("")}`;
  const deep = `#${[rr, gg, bb].map((v) => Math.round(v * 0.14).toString(16).padStart(2, "0")).join("")}`;

  return {
    accent,
    accentDim: dim,
    deep,
    glow: `rgba(${rr}, ${gg}, ${bb}, 0.42)`,
    hue: 0,
    label,
  };
}
