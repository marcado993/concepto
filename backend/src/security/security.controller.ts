import { Controller, Get, Query } from "@nestjs/common";
import { Public } from "../shared/auth/public.decorator";
import { SECURITY_INDICATORS } from "./indicators";
import { pointsGeoJSON, labelsGeoJSON, ZONES } from "./map-data";

// Público a propósito: cifras de seguridad ciudadana (OMSC Quito), sin
// PII — no hay razón de negocio para exigir login solo para ver esto, y
// exigirlo sin motivo sería fricción sin beneficio de seguridad real.
@Controller("security")
export class SecurityController {
  @Public()
  @Get("indicators")
  indicators() {
    return SECURITY_INDICATORS;
  }

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
