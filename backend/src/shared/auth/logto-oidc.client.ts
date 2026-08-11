import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Issuer, generators, type Client } from "openid-client";

// Envuelve el descubrimiento OIDC de Logto (un solo lugar que conoce el
// issuer/client — DRY) para el flujo Authorization Code + PKCE.
//
// Por qué backend-orquestado y no el SDK de Logto en el frontend: el
// sponsor pidió explícitamente que el backend "se conecte con Logto por
// GitHub" — y mantener un único proveedor de identidad como fuente de
// verdad (Logto emite el token, este backend solo lo valida, nunca lo
// reemite firmado con un secreto propio) es la opción más simple sin
// perder seguridad: no hay una segunda autoridad de tokens que mantener
// sincronizada ni rotar por separado.
//
// PKCE (RFC 7636) protege el intercambio de código incluso en un flujo
// server-to-server — no es opcional "porque es SPA", es la práctica
// recomendada para cualquier cliente OIDC hoy.
@Injectable()
export class LogtoOidcClient implements OnModuleInit {
  private readonly logger = new Logger(LogtoOidcClient.name);
  private client!: Client;

  constructor(private readonly config: ConfigService) {}

  // No lanza si Logto no responde — un problema encontrado al levantar el
  // backend por primera vez en desarrollo: el descubrimiento OIDC es una
  // llamada de red en el arranque, y Nest instancia todos los módulos
  // (incluidos security/ventures/health, que son @Public() y no necesitan
  // Logto para nada) en el mismo proceso de bootstrap. Si esto lanzaba,
  // TODO el backend se caía por un problema de un solo proveedor externo.
  // Falla en caliente en su lugar: login() lanza recién cuando alguien de
  // verdad intenta autenticarse sin que Logto esté configurado.
  async onModuleInit() {
    try {
      const issuer = await Issuer.discover(this.config.getOrThrow<string>("LOGTO_ISSUER"));
      this.client = new issuer.Client({
        client_id: this.config.getOrThrow<string>("LOGTO_APP_ID"),
        client_secret: this.config.get<string>("LOGTO_APP_SECRET"),
        redirect_uris: [this.config.getOrThrow<string>("LOGTO_REDIRECT_URI")],
        response_types: ["code"],
      });
      this.logger.log(`Logto OIDC client inicializado contra ${issuer.issuer}`);
    } catch (err) {
      this.logger.warn(
        `No se pudo inicializar el cliente OIDC de Logto — /auth/login fallará hasta que se resuelva. ${(err as Error).message}`
      );
    }
  }

  private assertReady() {
    if (!this.client) {
      throw new Error("Logto no está configurado o no respondió al arrancar el backend — revisa LOGTO_ISSUER");
    }
  }

  generatePkce() {
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    return { codeVerifier, codeChallenge, state };
  }

  // direct_sign_in=social:github salta la pantalla de selección de Logto y
  // va directo al conector de GitHub — es la parte que el sponsor pidió
  // ("conecta con logto por github"), no un login genérico con opciones.
  authorizationUrl(params: { codeChallenge: string; state: string }) {
    this.assertReady();
    return this.client.authorizationUrl({
      scope: "openid profile email",
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      state: params.state,
      direct_sign_in: "social:github",
    } as Record<string, string>);
  }

  async exchangeCode(params: { code: string; state: string; expectedState: string; codeVerifier: string }) {
    this.assertReady();
    const redirectUri = this.config.getOrThrow<string>("LOGTO_REDIRECT_URI");
    const tokenSet = await this.client.callback(
      redirectUri,
      { code: params.code, state: params.state },
      { code_verifier: params.codeVerifier, state: params.expectedState }
    );
    if (!tokenSet.access_token || !tokenSet.claims().sub) {
      throw new Error("Logto no devolvió un token válido");
    }
    return tokenSet;
  }
}
