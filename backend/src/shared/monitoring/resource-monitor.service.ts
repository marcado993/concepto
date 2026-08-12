import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as os from "node:os";
import { AlertService } from "./alert.service";
import { evaluate, describe, AlertLevel, ResourceSnapshot } from "./resource-thresholds";

// Corre cada minuto, en el mismo proceso que sirve la API — nada de un
// agente/daemon aparte, ni Prometheus+Alertmanager (docs/dominio/
// 08-observabilidad-resiliencia.md §4 explica por qué esa es la opción
// "correcta a otra escala" pero no la que cabe hoy en un Droplet de 2GB
// compartido con NestJS + Postgres). Esto SÍ responde directamente a lo
// que se pidió: si el CPU se está muriendo, alguien se entera por
// correo/celular sin tener que estar viendo un dashboard.
@Injectable()
export class ResourceMonitorService {
  private readonly logger = new Logger(ResourceMonitorService.name);
  // Cooldown: alertar UNA vez al cruzar el umbral, no cada minuto mientras
  // se mantenga arriba — spamear la alerta la vuelve ruido que se ignora.
  private lastAlertedLevel: AlertLevel = "ok";

  constructor(private readonly alerts: AlertService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async check() {
    const snapshot = this.readSnapshot();
    const level = evaluate(snapshot);
    const message = describe(snapshot, level);

    if (level === "ok") {
      if (this.lastAlertedLevel !== "ok") {
        await this.alerts.send(`Recuperado — ${message}`, "warning");
      }
      this.lastAlertedLevel = "ok";
      return;
    }

    if (level !== this.lastAlertedLevel) {
      this.logger.warn(message);
      await this.alerts.send(message, level);
    }
    this.lastAlertedLevel = level;
  }

  private readSnapshot(): ResourceSnapshot {
    const cores = os.cpus().length || 1;
    const cpuLoadRatio = os.loadavg()[0] / cores;
    const memoryUsedRatio = 1 - os.freemem() / os.totalmem();
    return { cpuLoadRatio, memoryUsedRatio };
  }
}
