import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Request, Response } from "express";
import { AuthStrategy } from "./auth-strategy.interface";
import { LogtoOidcClient } from "../logto-oidc.client";
import { ExperienceApiError, LogtoExperienceClient } from "../logto-experience.client";
import { AuthService } from "../auth.service";

// La cookie de session de este flujo — igual que antes, viaja solo entre
// /auth/social/start y /auth/social/callback (dos extremos de una NAVEGACIÓN
// completa del navegador, nunca un fetch cross-site), así que una cookie
// SameSite=Lax+Secure funciona sin problema entre estos dos endpoints del
// MISMO dominio (api.aeis-app.online).
const SOCIAL_COOKIE = "aeis_social_pending";

// google/github → variable de entorno que guarda el ID interno del conector
// en Logto (ver comentario grande en logto-experience.client.ts sobre por qué
// no basta el nombre humano).
const SOCIAL_CONNECTOR_ENV: Record<string, string> = {
  github: "LOGTO_GITHUB_CONNECTOR_ID",
  google: "LOGTO_GOOGLE_CONNECTOR_ID",
};

// Estado en vuelo entre los dos endpoints del flujo social. Viaja en una
// cookie firmada de 5 minutos.
export interface SocialPending {
  connectorId: string;
  redirectUri: string;
  interactionCookie: string;
  verificationId: string;
  // El evento con que arrancó la interacción — necesario en el callback
  // para saber si el reintento debe ir hacia Register o hacia SignIn.
  interactionEvent: "SignIn" | "Register";
  // codeVerifier/logtoState son de la interacción OIDC PROPIA con Logto
  // (para el intercambio final vía finishTokenExchange) — oauthState es un
  // valor DISTINTO, el anti-CSRF que viaja de ida y vuelta con GitHub/
  // Google mismos. No es el mismo dato aunque ambos se llamen "state": uno
  // lo valida Logto, el otro lo validamos nosotros al recibir el callback.
  codeVerifier: string;
  logtoState: string;
  oauthState: string;
}

// Login social embebido (GitHub/Google) — a diferencia del correo (que
// viaja explícito en el cuerpo JSON porque Login.svelte lo llama por
// fetch() desde otro dominio), acá SÍ sirve una cookie: /auth/social/start
// y /auth/social/callback son los dos extremos de una NAVEGACIÓN completa
// del navegador (nunca un fetch cross-site) — exactamente el mismo caso ya
// resuelto por OIDC_COOKIE en OidcRedirectStrategy para el GitHub "de toda la
// vida". El salto a github.com/accounts.google.com en medio no cambia nada:
// esta cookie la pone y la lee siempre el mismo dominio (api.aeis-app.online),
// nunca aeis.app.
@Injectable()
export class SocialEmbeddedStrategy implements AuthStrategy {
  readonly name = "social-embedded";
  private readonly logger = new Logger(SocialEmbeddedStrategy.name);

  constructor(
    private readonly logto: LogtoOidcClient,
    private readonly logtoExperience: LogtoExperienceClient,
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  // Paso 1 de 2. Reemplaza a /auth/login?connector=... para estos dos
  // botones: en vez de saltar al selector genérico de Logto vía
  // direct_sign_in (que a veces cae de vuelta al /sign-in genérico si el
  // conector no está listado ahí, bug real reportado en producción), habla
  // con la Experience API server-side y redirige AL NAVEGADOR directo a la
  // pantalla real de GitHub/Google — la UI de Logto nunca se llega a mostrar.
  async start(connector: string | undefined, res: Response): Promise<void> {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const envKey = connector ? SOCIAL_CONNECTOR_ENV[connector] : undefined;
    const connectorId = envKey ? this.config.get<string>(envKey) : undefined;
    if (!connectorId) {
      res.redirect(`${frontendOrigin}/?auth_error=connector_invalido`);
      return;
    }

    const { codeVerifier, codeChallenge, state: logtoState } = this.logto.generatePkce();
    let authUrl: string;
    try {
      authUrl = this.logto.authorizationUrl({ codeChallenge, state: logtoState });
    } catch {
      // Mismo caso que OidcRedirectStrategy.start: Logto sigue con
      // credenciales placeholder — ver el comentario ahí.
      res.redirect(`${frontendOrigin}/?auth_error=logto_not_configured`);
      return;
    }

    const redirectUri = this.config.getOrThrow<string>("SOCIAL_REDIRECT_URI");
    const oauthState = randomUUID();

    try {
      let cookie = await this.logtoExperience.startInteraction(authUrl);
      // Se arranca como "Register" — el caso masivo son estudiantes
      // entrando por primera vez (mismo razonamiento que EmailOtpStrategy).
      // Si el usuario ya tiene cuenta, submitIdentification devolverá
      // "user.identity_already_exist" y el callback reintentará como SignIn.
      const interactionEvent: "SignIn" | "Register" = "Register";
      cookie = await this.logtoExperience.setInteractionEvent(cookie, interactionEvent);
      const {
        cookie: cookieWithUri,
        authorizationUri,
        verificationId,
      } = await this.logtoExperience.getSocialAuthorizationUri(cookie, connectorId, oauthState, redirectUri);

      const pending: SocialPending = {
        connectorId,
        redirectUri,
        interactionCookie: cookieWithUri,
        verificationId,
        interactionEvent,
        codeVerifier,
        logtoState,
        oauthState,
      };
      res.cookie(SOCIAL_COOKIE, JSON.stringify(pending), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        signed: true,
        maxAge: 5 * 60 * 1000,
      });
      res.redirect(authorizationUri);
    } catch (err) {
      this.logger.error(
        `start(${connector}) — Logto Experience API rechazó el inicio del login social: ${(err as Error).message}`
      );
      res.redirect(`${frontendOrigin}/?auth_error=social_login_failed`);
    }
  }

  // Paso 2 de 2. `redirectUri` (SOCIAL_REDIRECT_URI) apunta ACÁ, así que
  // este endpoint tiene que estar agregado como callback URL autorizado en el
  // OAuth App de GitHub y en el cliente OAuth de Google Cloud (además del
  // callback propio de Logto que ya tenían) — sin eso, GitHub/Google rechazan
  // el intercambio con redirect_uri_mismatch antes de llegar siquiera acá.
  async callback(
    code: string | undefined,
    state: string | undefined,
    providerError: string | undefined,
    req: Request,
    res: Response
  ): Promise<void> {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const pendingRaw = req.signedCookies?.[SOCIAL_COOKIE];
    res.clearCookie(SOCIAL_COOKIE);

    if (!pendingRaw) {
      res.redirect(`${frontendOrigin}/?auth_error=social_session_expired`);
      return;
    }
    const pending = JSON.parse(pendingRaw) as SocialPending;

    if (providerError || !code || !state || state !== pending.oauthState) {
      res.redirect(`${frontendOrigin}/?auth_error=social_login_cancelled`);
      return;
    }

    try {
      const verifiedCookie = await this.logtoExperience.verifySocial(
        pending.interactionCookie,
        pending.connectorId,
        pending.verificationId,
        code,
        pending.redirectUri
      );

      let identification = await this.logtoExperience.submitIdentification(verifiedCookie, pending.verificationId);
      const identificado = (status: number) => status === 204 || status === 201; // 201 = cuenta recién creada

      if (!identificado(identification.status)) {
        // La corazonada del evento inicial falló — reintentamos con el
        // opuesto. Para social la verificación NO se destruye al cambiar
        // el evento (a diferencia del correo): la identidad ya fue probada
        // por el proveedor y sigue ligada a la sesión.
        //
        // Register inicial → identity ya existe → reintentar como SignIn:
        //   "user.identity_already_exist" (cuenta vinculada a otro user)
        //   "user.identity_exist" (ya tiene cuenta, solo entrar)
        //   "user.identity_already_in_use" (el código REAL que manda Logto
        //   hoy — confirmado en logs de producción; faltaba acá y por eso
        //   el reintento nunca se disparaba, el login solo fallaba con
        //   "social_login_failed" sin decir por qué)
        // SignIn inicial → identidad nueva → reintentar como Register:
        //   "user.identity_not_exist" / "user.user_not_exist"
        const eventoOpuesto: "SignIn" | "Register" | null =
          pending.interactionEvent === "Register" &&
          (identification.errorCode === "user.identity_already_exist" ||
            identification.errorCode === "user.identity_exist" ||
            identification.errorCode === "user.identity_already_in_use" ||
            identification.errorCode === "user.email_already_in_use")
            ? "SignIn"
            : pending.interactionEvent === "SignIn" &&
                (identification.errorCode === "user.identity_not_exist" ||
                  identification.errorCode === "user.user_not_exist")
              ? "Register"
              : null;

        if (eventoOpuesto) {
          this.logger.warn(
            `callback(${pending.connectorId}) — evento ${pending.interactionEvent} no aplicaba (${identification.errorCode}); reintentando como ${eventoOpuesto}`
          );
          const retryCookie = await this.logtoExperience.setInteractionEvent(identification.cookie, eventoOpuesto);
          identification = await this.logtoExperience.submitIdentification(retryCookie, pending.verificationId);
        }
      }

      if (!identificado(identification.status)) {
        this.logger.error(
          `callback(${pending.connectorId}) — identification falló: status=${identification.status} code=${identification.errorCode ?? "sin código"} evento=${pending.interactionEvent}`
        );
        res.redirect(`${frontendOrigin}/?auth_error=social_login_failed`);
        return;
      }

      const submitted = await this.logtoExperience.submitInteraction(identification.cookie);
      const {
        code: authCode,
        state: authState,
        iss: authIss,
      } = await this.logtoExperience.completeAuthorization(submitted.cookie, submitted.redirectTo);

      const result = await this.authService.finishTokenExchange({
        code: authCode,
        state: authState,
        iss: authIss,
        expectedState: pending.logtoState,
        codeVerifier: pending.codeVerifier,
      });

      if (!result.ok) {
        res.redirect(`${frontendOrigin}/?auth_error=${result.reason}`);
        return;
      }
      res.redirect(`${frontendOrigin}/#access_token=${result.accessToken}`);
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        this.logger.error(
          `callback(${pending.connectorId}) — Logto Experience API rechazó la verificación: [${err.code ?? "sin código"}] ${err.message}`
        );
      } else {
        this.logger.error(`callback(${pending.connectorId}) — error inesperado: ${(err as Error).message}`);
      }
      res.redirect(`${frontendOrigin}/?auth_error=social_login_failed`);
    }
  }
}
