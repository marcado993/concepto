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

// Clasifica el errorCode de submitIdentification SIN depender de una lista
// cerrada de strings exactos — hallazgo real: "identity_already_in_use" no
// estaba en la lista original (solo "identity_already_exist"), así que el
// login fallaba en silencio con cualquier código que Logto mandara y no
// estuviera ahí, palabra por palabra. Logto no documenta el set completo de
// códigos posibles con este detalle, así que una lista fija SIEMPRE va a
// quedar corta tarde o temprano.
//
// En vez de eso: cualquier código que contenga "not_exist" es "no existe
// todavía" (hay que registrar); cualquier código que contenga "already" o
// "_in_use" es "ya existe" (hay que iniciar sesión). Cubre no solo los 5
// códigos ya vistos en producción, sino cualquier variación futura con el
// mismo patrón de nombres que Logto use — sin tener que volver a tocar este
// archivo cada vez que aparezca una palabra nueva.
export function clasificarErrorIdentificacion(errorCode: string | undefined): "ya_existe" | "no_existe" | "desconocido" {
  if (!errorCode) return "desconocido";
  const code = errorCode.toLowerCase();
  // "not_exist" primero y con return propio — si no, "identity_not_exist"
  // también haría match con el "_exist" de abajo y se clasificaría al revés.
  if (code.includes("not_exist")) return "no_existe";
  if (code.includes("already") || code.includes("_in_use") || code.includes("_exist")) return "ya_existe";
  return "desconocido";
}

// Estado en vuelo entre los dos endpoints del flujo social. Viaja en una
// cookie firmada de 5 minutos.
export interface SocialPending {
  connectorId: string;
  // Nombre humano ("github"/"google") — a diferencia de connectorId (el ID
  // interno de Logto), esto es lo que /auth/social/start recibe como
  // ?connector=. Se guarda para poder RE-arrancar el flujo completo desde
  // el callback si la corazonada del evento inicial falló (ver
  // attempt/reiniciarConEvento abajo) sin que el navegador tenga que
  // volver a mandarlo.
  connectorName: string;
  redirectUri: string;
  interactionCookie: string;
  verificationId: string;
  // El evento con que arrancó la interacción — necesario en el callback
  // para saber si el reintento debe ir hacia Register o hacia SignIn.
  interactionEvent: "SignIn" | "Register";
  // 1 = primer intento (arrancó adivinando Register). 2 = ya se reinició
  // una vez con el evento correcto — si ESTE también falla, no hay tercer
  // intento (evita un loop si Logto sigue rechazando por otro motivo).
  attempt: 1 | 2;
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
  // forcedEvent/attempt: SOLO los usa el reinicio interno desde callback()
  // (ver más abajo) cuando la corazonada inicial de Register falló — nunca
  // vienen de un link/botón real, así que un valor inválido simplemente
  // cae al comportamiento normal (adivinar Register, intento 1).
  async start(connector: string | undefined, res: Response, forcedEvent?: string, attemptRaw?: string): Promise<void> {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const envKey = connector ? SOCIAL_CONNECTOR_ENV[connector] : undefined;
    const connectorId = envKey ? this.config.get<string>(envKey) : undefined;
    if (!connectorId || !connector) {
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
      // Se arranca adivinando "Register" — el caso masivo son estudiantes
      // entrando por primera vez (mismo razonamiento que EmailOtpStrategy).
      // Si el usuario ya tiene cuenta, submitIdentification lo va a decir
      // (identity_already_in_use / ya_exist) y el callback REINICIA todo
      // este flujo con forcedEvent="SignIn" — no se puede "seguir" con la
      // misma verificación cambiando el evento (Logto la invalida, mismo
      // comportamiento documentado para correo en logto-experience.client.ts,
      // confirmado también acá con logs reales de producción).
      const interactionEvent: "SignIn" | "Register" = forcedEvent === "SignIn" ? "SignIn" : "Register";
      const attempt: 1 | 2 = attemptRaw === "2" ? 2 : 1;
      cookie = await this.logtoExperience.setInteractionEvent(cookie, interactionEvent);
      const {
        cookie: cookieWithUri,
        authorizationUri,
        verificationId,
      } = await this.logtoExperience.getSocialAuthorizationUri(cookie, connectorId, oauthState, redirectUri);

      const pending: SocialPending = {
        connectorId,
        connectorName: connector,
        redirectUri,
        interactionCookie: cookieWithUri,
        verificationId,
        interactionEvent,
        attempt,
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

      const identification = await this.logtoExperience.submitIdentification(verifiedCookie, pending.verificationId);
      const identificado = (status: number) => status === 204 || status === 201; // 201 = cuenta recién creada

      if (!identificado(identification.status)) {
        // La corazonada del evento inicial falló. A diferencia de lo que
        // este código asumía antes, la verificación de GitHub/Google NO
        // sobrevive a un cambio de evento — Logto la invalida igual que con
        // correo (confirmado con logs reales de producción: intentar
        // setInteractionEvent + submitIdentification de nuevo acá mismo
        // devolvía session.verification_session_not_found). No hay forma de
        // "seguir" con esta verificación — hay que reiniciar TODO el flujo
        // con el evento correcto, el equivalente social de "te mandamos un
        // código nuevo" en el login por correo. Como el navegador suele
        // seguir logueado en GitHub/Google, este segundo salto normalmente
        // es instantáneo (sin volver a pedir usuario/contraseña).
        //
        // Register inicial → identity ya existe (clasificarErrorIdentificacion
        // arriba) → reiniciar como SignIn. SignIn inicial → identidad nueva
        // → reiniciar como Register. Clasificación por PATRÓN, no por lista
        // cerrada de códigos — ver el comentario grande junto a la función.
        const clasificacion = clasificarErrorIdentificacion(identification.errorCode);
        const eventoOpuesto: "SignIn" | "Register" | null =
          pending.interactionEvent === "Register" && clasificacion === "ya_existe"
            ? "SignIn"
            : pending.interactionEvent === "SignIn" && clasificacion === "no_existe"
              ? "Register"
              : null;

        // attempt < 2: nunca un tercer intento — si el reinicio con el
        // evento correcto TAMBIÉN falla, algo más está mal y hay que
        // mostrar el error en vez de mandar al estudiante a GitHub/Google
        // en un loop.
        if (eventoOpuesto && pending.attempt < 2) {
          this.logger.warn(
            `callback(${pending.connectorId}) — evento ${pending.interactionEvent} no aplicaba (${identification.errorCode}); reiniciando el flujo completo como ${eventoOpuesto}`
          );
          const apiOrigin = pending.redirectUri.replace(/\/auth\/social\/callback\/?$/, "");
          res.redirect(`${apiOrigin}/auth/social/start?connector=${encodeURIComponent(pending.connectorName)}&event=${eventoOpuesto}&attempt=2`);
          return;
        }

        this.logger.error(
          `callback(${pending.connectorId}) — identification falló: status=${identification.status} code=${identification.errorCode ?? "sin código"} evento=${pending.interactionEvent} attempt=${pending.attempt}`
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
