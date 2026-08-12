import { Injectable } from "@nestjs/common";
import * as client from "prom-client";

// Un solo registro (Registry) para todo el proceso — DRY: cualquier
// módulo que necesite exponer una métrica nueva la registra aquí, no crea
// su propio Registry paralelo. Incluye las métricas por defecto de Node
// (CPU, heap, event loop lag) sin configuración adicional — es lo que
// permite responder "el CPU se está muriendo" sin instrumentar nada más.
@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  readonly httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "Duración de requests HTTP en segundos",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total de requests HTTP",
    labelNames: ["method", "route", "status_code"],
    registers: [this.registry],
  });

  readonly rateLimitedTotal = new client.Counter({
    name: "http_rate_limited_total",
    help: "Requests rechazados por rate limiting (429) — útil para distinguir carga legítima de abuso",
    registers: [this.registry],
  });

  constructor() {
    client.collectDefaultMetrics({ register: this.registry });
  }

  async metricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
