import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

// Único cliente de correo TRANSACCIONAL del backend (contratos, recibos —
// no confundir con AlertService, que son notificaciones de infra por
// webhook, ni con el correo de login por OTP, que vive DENTRO de Logto y no
// pasa por acá). Resend porque ya sabemos que funciona bien en esta
// infraestructura: es el mismo proveedor que Logto usa para los códigos de
// login, solo que ahí es interno a Logto y no lo puede reutilizar este
// backend — este es un cliente/cuenta de Resend aparte, solo para AEIS-APP.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private client: Resend | null = null;

  constructor(private readonly config: ConfigService) {}

  // Perezoso, no en el constructor — mismo motivo que LogtoOidcClient no
  // valida su config al arrancar: si RESEND_API_KEY falta (desarrollo local
  // sin correo configurado), el backend entero no debe caerse por un
  // proveedor opcional. Recién falla, y con un mensaje claro, cuando algo
  // de verdad intenta mandar un correo.
  private getClient(): Resend {
    if (!this.client) {
      this.client = new Resend(this.config.getOrThrow<string>("RESEND_API_KEY"));
    }
    return this.client;
  }

  async send(params: { to: string; subject: string; html: string; cc?: string | string[] }): Promise<void> {
    const from = this.config.getOrThrow<string>("MAIL_FROM");
    const { error } = await this.getClient().emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.cc ? { cc: params.cc } : {}),
    });
    if (error) {
      // Nunca se propaga el detalle crudo de Resend más allá de este log —
      // mismo principio que sanitizedEmailError en auth.controller.ts: el
      // detalle es útil acá, server-side, no para quien llamó a este método.
      this.logger.error(`No se pudo enviar "${params.subject}" a ${params.to}: ${error.name} — ${error.message}`);
      throw new Error(`Resend rechazó el envío: ${error.name}`);
    }
  }
}
