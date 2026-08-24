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

  // Un webhook válido es http(s) y NO trae los signos < > del placeholder
  // del .env.example (https://ntfy.sh/<tu-topic-secreto>). Hallazgo de
  // pentesting: si el .env se despliega con el placeholder tal cual, este
  // servicio posteaba las alertas de CPU/memoria a esa URL literal — ntfy
  // crea un topic público llamado "<tu-topic-secreto>", así que las alertas
  // (que insinúan carga/ataques) quedaban en un topic adivinable Y nunca le
  // llegaban a nadie real. Ahora una URL con placeholder se descarta con un
  // aviso claro en el log, en vez de filtrar en silencio.
  private isRealWebhook(url: string): boolean {
    if (!/^https?:\/\//i.test(url)) return false;
    if (/[<>]/.test(url)) return false; // placeholder sin reemplazar
    return true;
  }

  async send(message: string, severity: "warning" | "critical" = "warning") {
    const configured = (this.config.get<string>("ALERT_WEBHOOK_URLS") ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    const invalid = configured.filter((u) => !this.isRealWebhook(u));
    if (invalid.length > 0) {
      this.logger.warn(
        `ALERT_WEBHOOK_URLS trae ${invalid.length} URL(s) inválida(s) o sin reemplazar (¿placeholder del .env?) — se ignoran, revisa la config`
      );
    }
    const urls = configured.filter((u) => this.isRealWebhook(u));

    if (urls.length === 0) {
      this.logger.warn(`[sin ALERT_WEBHOOK_URLS válido configurado] ${severity.toUpperCase()}: ${message}`);
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
