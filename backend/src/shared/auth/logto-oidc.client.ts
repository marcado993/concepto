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
  //
  // 3 intentos con backoff (1s/3s/6s) antes de rendirse — encontrado en
  // producción: un `docker compose up --force-recreate` que reinicia
  // backend Y Logto a la vez puede arrancar el backend una fracción de
  // segundo antes de que Logto esté listo para responder discovery. Sin
  // reintentos, ese primer intento fallido dejaba el backend pensando
  // "Logto no configurado" hasta el SIGUIENTE restart, aunque Logto ya
  // estuviera sano un par de segundos después.
  async onModuleInit() {
    const attempts = [1_000, 3_000, 6_000];
    for (let i = 0; i <= attempts.length; i++) {
      try {
        const issuer = await Issuer.discover(this.config.getOrThrow<string>("LOGTO_ISSUER"));
        this.client = new issuer.Client({
          client_id: this.config.getOrThrow<string>("LOGTO_APP_ID"),
          client_secret: this.config.get<string>("LOGTO_APP_SECRET"),
          redirect_uris: [this.config.getOrThrow<string>("LOGTO_REDIRECT_URI")],
          response_types: ["code"],
          // openid-client asume RS256 por defecto para el id_token si no se le
          // dice lo contrario — pero este tenant de Logto firma con ES384 (se
          // confirmó en producción vía el header real del JWT). Sin esto,
          // openid-client rechazaba TODO login con "unexpected JWT alg
          // received, expected RS256, got: ES384" aunque el token fuera
          // legítimo. Se toma del propio discovery doc del issuer en vez de
          // hardcodear "ES384" a mano, para no romper de nuevo si Logto
          // rota el algoritmo de firma más adelante.
          id_token_signed_response_alg:
            (issuer.metadata as Record<string, unknown>).id_token_signing_alg_values_supported instanceof Array
              ? ((issuer.metadata as Record<string, unknown>).id_token_signing_alg_values_supported as string[])[0]
              : "RS256",
        });
        this.logger.log(`Logto OIDC client inicializado contra ${issuer.issuer}`);
        return;
      } catch (err) {
        if (i === attempts.length) {
          this.logger.warn(
            `No se pudo inicializar el cliente OIDC de Logto tras ${attempts.length + 1} intentos — /auth/login fallará hasta que se resuelva. ${(err as Error).message}`
          );
          return;
        }
        this.logger.warn(`Descubrimiento OIDC de Logto falló, reintentando en ${attempts[i]}ms — ${(err as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, attempts[i]));
      }
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
  authorizationUrl(params: { codeChallenge: string; state: string; directSignIn?: string; loginHint?: string }) {
    this.assertReady();
    return this.client.authorizationUrl({
      scope: "openid profile email",
      ...(params.loginHint ? { login_hint: params.loginHint } : {}),
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

  async exchangeCode(params: {
    code: string;
    state: string;
    iss?: string;
    expectedState: string;
    codeVerifier: string;
  }) {
    this.assertReady();
    const redirectUri = this.config.getOrThrow<string>("LOGTO_REDIRECT_URI");
    // openid-client valida el parámetro `iss` del callback (RFC 9207,
    // protección anti mix-up) cuando el issuer lo soporta — Logto SIEMPRE lo
    // manda en la URL real de vuelta, pero si no se lo reenviamos acá
    // explícitamente, openid-client lo trata como "faltante" y lanza RPError
    // aunque el login haya sido legítimo (hallazgo en producción: rompía
    // TODO login, GitHub y correo, no solo uno de los dos conectores).
    const tokenSet = await this.client.callback(
      redirectUri,
      { code: params.code, state: params.state, iss: params.iss },
      { code_verifier: params.codeVerifier, state: params.expectedState },
      {
        // El `resource` de authorizationUrl() solo viaja en la petición de
        // AUTORIZACIÓN — Logto no lo recuerda por sí solo para la petición
        // de TOKEN que viene después con el `code`. Sin repetirlo acá, el
        // login "se veía" exitoso (código real, tokenSet con claims
        // válidos) pero el access_token venía OPACO (un string corto sin
        // firmar, no un JWT) en vez del JWT que jwt.strategy.ts necesita
        // para validar cada request protegida — 401 silencioso en
        // /auth/me, /lockers/my-price, todo. Confirmado a mano contra el
        // token endpoint real de Logto: mismo `code`, sin este parámetro
        // → opaco; con este parámetro → JWT con aud correcto.
        exchangeBody: { resource: this.config.getOrThrow<string>("LOGTO_AUDIENCE") },
      }
    );
    if (!tokenSet.access_token || !tokenSet.claims().sub) {
      throw new Error("Logto no devolvió un token válido");
    }
    return tokenSet;
  }
}
