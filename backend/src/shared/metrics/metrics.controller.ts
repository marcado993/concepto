import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { MetricsService } from "./metrics.service";

// @Public() a propósito, PERO ver docs/dominio/08-observabilidad-resiliencia.md
// §3: en producción esto debe quedar detrás del firewall del Droplet
// (solo el scraper de Prometheus, nunca internet abierto) — un endpoint de
// métricas público expone topología y volumen de tráfico, información útil
// para un atacante. @Public() aquí es sobre AUTENTICACIÓN de la app (no
// hace falta ser un estudiante logueado para que Prometheus scrapee), no
// sobre exposición de red — esas son dos capas distintas.
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header("Content-Type", "text/plain")
  async get() {
    return this.metrics.metricsText();
  }
}
