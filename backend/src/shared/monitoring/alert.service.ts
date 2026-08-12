import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Un solo mecanismo de alerta — webhook genérico — en vez de un cliente
// distinto por canal (email, SMS, push). Cualquier servicio que acepte un
// POST con JSON sirve como destino; ALERT_WEBHOOK_URLS admite varios,
// separados por coma, así que "a mi correo o celular" son dos URLs en la
// misma variable de entorno, no dos integraciones de código distintas.
//
// Recomendado en .env.example: https://ntfy.sh/<tu-topic-privado> — push
// directo al celular (app o navegador), gratis, sin registro, un solo POST.
// Para correo, cualquier automatización (ntfy → email, Zapier, Make,
// Discord con notificaciones por correo) que reciba ese mismo POST sirve
// igual, sin tocar este servicio.
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: string, severity: "warning" | "critical" = "warning") {
    const urls = (this.config.get<string>("ALERT_WEBHOOK_URLS") ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      this.logger.warn(`[sin ALERT_WEBHOOK_URLS configurado] ${severity.toUpperCase()}: ${message}`);
      return;
    }

    await Promise.allSettled(
      urls.map((url) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Title: `AEIS-APP · ${severity}` } as Record<string, string>,
          body: JSON.stringify({ text: message, severity, source: "aeis-app-backend", at: new Date().toISOString() }),
        }).catch((err) => this.logger.error(`Fallo enviando alerta a ${url}: ${err.message}`))
      )
    );
  }
}
