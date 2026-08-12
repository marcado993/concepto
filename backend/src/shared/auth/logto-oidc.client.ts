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

  // El frontend ahora tiene su PROPIA pantalla de login (Login.svelte, en
  // el estilo visual de AEIS-APP) en vez de mandar al estudiante derecho a
  // la pantalla genérica hospedada por Logto — esa pantalla de Logto sigue
  // existiendo (Logto la necesita para el handshake OAuth real), pero deja
  // de ser lo primero que ve el estudiante. `directSignIn` (opcional) es
  // justamente el mecanismo de Logto para saltarse su propio selector de
  // conectores cuando el frontend YA sabe qué botón tocó el estudiante —
  // ej. "social:github" cuando toca "Continuar con GitHub", en vez de
  // aterrizar en una pantalla de Logto que vuelve a preguntar el método.
  //
  // Sin directSignIn (undefined), cae al comportamiento anterior: Logto
  // muestra su propio selector con todos los conectores del tenant — sigue
  // sirviendo como fallback genérico si el frontend no especifica método.
  //
  // Requiere que el tenant de Logto tenga configurado, además del
  // conector social de GitHub, un conector de correo/contraseña o enlace
  // mágico para el dominio institucional (@epn.edu.ec) — configuración
  // del lado de Logto, no de este código (ver docs/dominio/
  // 10-despliegue-vps-vercel.md, pendiente de credenciales reales).
  authorizationUrl(params: { codeChallenge: string; state: string; directSignIn?: string }) {
    this.assertReady();
    return this.client.authorizationUrl({
      scope: "openid profile email",
      // resource: sin esto, Logto emite un access_token genérico cuyo
      // "aud" NO es LOGTO_AUDIENCE — y jwt.strategy.ts valida audience de
      // forma estricta a propósito (evitar el "confused deputy" de un
      // token válido para OTRA app del mismo tenant, ver el comentario ahí).
      // Sin este parámetro, el login se "veía" exitoso (Logto redirige con
      // un token) pero CUALQUIER endpoint protegido (/auth/me, alquilar un
      // casillero, etc.) habría respondido 401 por audiencia inválida —
      // requiere que el API Resource con este identifier YA exista en
      // Logto (Console → API Resources), si no existe Logto rechaza la
      // petición de autorización.
      resource: this.config.getOrThrow<string>("LOGTO_AUDIENCE"),
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      state: params.state,
      ...(params.directSignIn ? { direct_sign_in: params.directSignIn } : {}),
    });
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
