import { Controller, Get, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../shared/auth/public.decorator";
import { SECURITY_INDICATORS } from "./indicators";
import { pointsGeoJSON, labelsGeoJSON, ZONES } from "./map-data";

// Público a propósito: cifras de seguridad ciudadana (OMSC Quito), sin
// PII — no hay razón de negocio para exigir login solo para ver esto, y
// exigirlo sin motivo sería fricción sin beneficio de seguridad real.
//
// Techo mucho más alto que el global en las dos rutas — mismo motivo que
// locker.controller.ts GET /lockers: se piden en paralelo apenas la app
// abre, así que el límite global por sí solo castigaba a varios
// estudiantes reales compartiendo la misma IP de WiFi del campus (ver
// rate-limit.module.ts).
@Controller("security")
export class SecurityController {
  @Throttle({ short: { limit: 50, ttl: 1000 }, medium: { limit: 3000, ttl: 60_000 } })
  @Public()
  @Get("indicators")
  indicators() {
    return SECURITY_INDICATORS;
  }

  @Throttle({ short: { limit: 50, ttl: 1000 }, medium: { limit: 3000, ttl: 60_000 } })
  @Public()
  @Get("map-data")
  mapData(@Query("risk") riskParam?: string) {
    const risk = clampRisk(Number(riskParam ?? 0.5));
    return {
      zones: ZONES,
      points: pointsGeoJSON(risk),
      labels: labelsGeoJSON(risk),
    };
  }
}

function clampRisk(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
