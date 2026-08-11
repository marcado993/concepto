// Lógica pura, separada del cron y de `os.*`, para que sea testeable sin
// mockear el sistema operativo — mismo principio de "inyectar en vez de
// llamar directo" que ya se usó en map-data.ts (rng inyectable) y en
// executeMoneyMutation (dependencias inyectadas, no importadas).

export interface ResourceSnapshot {
  cpuLoadRatio: number; // 0..1+ — loadavg(1min) / núcleos, puede pasar de 1
  memoryUsedRatio: number; // 0..1
}

export interface ThresholdConfig {
  cpuWarning: number;
  cpuCritical: number;
  memoryWarning: number;
  memoryCritical: number;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  cpuWarning: 0.75,
  cpuCritical: 0.9,
  memoryWarning: 0.8,
  memoryCritical: 0.92,
};

export type AlertLevel = "ok" | "warning" | "critical";

export function evaluate(snapshot: ResourceSnapshot, thresholds: ThresholdConfig = DEFAULT_THRESHOLDS): AlertLevel {
  if (snapshot.cpuLoadRatio >= thresholds.cpuCritical || snapshot.memoryUsedRatio >= thresholds.memoryCritical) {
    return "critical";
  }
  if (snapshot.cpuLoadRatio >= thresholds.cpuWarning || snapshot.memoryUsedRatio >= thresholds.memoryWarning) {
    return "warning";
  }
  return "ok";
}

export function describe(snapshot: ResourceSnapshot, level: AlertLevel): string {
  const cpuPct = (snapshot.cpuLoadRatio * 100).toFixed(0);
  const memPct = (snapshot.memoryUsedRatio * 100).toFixed(0);
  return `[${level.toUpperCase()}] CPU ${cpuPct}% · Memoria ${memPct}% — Droplet 2 vCPU/2 GB ($27.60/mes)`;
}
