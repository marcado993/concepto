import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { randomUUID } from "node:crypto";
import { Request, Response } from "express";
import { Public } from "./public.decorator";
import { LogtoOidcClient } from "./logto-oidc.client";
import { ExperienceApiError, LogtoExperienceClient } from "./logto-experience.client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailDestinationLimiter } from "../rate-limit/email-destination-limiter.service";
import { EmailPendingTokenService } from "./email-pending-token.service";
import { AuthService, isValidEmail } from "./auth.service";

// Flujo de login — 2 saltos de red (navegador → Logto → GitHub → Logto →
// backend), el mínimo posible para OIDC con un proveedor externo (mismo
// razonamiento que aeis-app documentó para OAuth2Login: un IdP intermedio
// SIN duplicar handshakes).
//
// El código_verifier y el `state` de PKCE viajan en una cookie firmada de
// corta vida — nunca en el propio parámetro `state` visible en la URL, que
// solo sirve para anti-CSRF, no para guardar el secreto de PKCE.
const OIDC_COOKIE = "aeis_oidc_pending";

// Login social embebido (GitHub/Google) — a diferencia del correo (que
// viaja explícito en el cuerpo JSON porque Login.svelte lo llama por
// fetch() desde otro dominio), acá SÍ sirve una cookie: /auth/social/start
// y /auth/social/callback son los dos extremos de una NAVEGACIÓN completa
// del navegador (nunca un fetch cross-site) — exactamente el mismo caso ya
// resuelto por OIDC_COOKIE arriba para el GitHub "de toda la vida". El
// salto a github.com/accounts.google.com en medio no cambia nada: esta
// cookie la pone y la lee siempre el mismo dominio (api.aeis-app.online),
// nunca aeis.app.
const SOCIAL_COOKIE = "aeis_social_pending";

// google/github → ID interno del conector en Logto (ver el comentario
// grande en logto-experience.client.ts sobre por qué no basta el nombre
// humano). Viven en variables de entorno, no hardcodeados: son un dato de
// configuración del tenant, no del código — si el conector se recrea en
// Logto, el ID cambia sin que el código deba cambiar con él.
const SOCIAL_CONNECTOR_ENV: Record<string, string> = {
  github: "LOGTO_GITHUB_CONNECTOR_ID",
  google: "LOGTO_GOOGLE_CONNECTOR_ID",
};

// Login por correo institucional embebido — el estado de la interacción
// (sus cookies internas, el verificationId pendiente) tiene que sobrevivir
// entre el POST /auth/email/start y el POST /auth/email/verify de este
// mismo backend, mientras el estudiante nunca navega fuera de Login.svelte.
//
// Este estado viaja EXPLÍCITO en el cuerpo JSON (signPending/verifyPending
// más abajo), no en una cookie — mismo patrón que ya usa el access_token
// final (fragmento de URL → localStorage → header Authorization, nunca
// cookie). Se intentó primero con una cookie SameSite=None+Secure (aeis.app
// y api.aeis-app.online son dominios distintos) y en el papel debía
// funcionar, pero en producción real seguía fallando para usuarios reales:
// varios navegadores (Safari con ITP, Chrome con el apagado gradual de
// cookies de terceros) bloquean cookies entre sitios distintos SIN
// IMPORTAR el valor de SameSite — no hay combinación de atributos de
// cookie que lo arregle de forma confiable. Pasar el estado como dato
// explícito evita depender de una política de cookies que cada navegador
// decide distinto y sigue cambiando con el tiempo. Ver
// logto-experience.client.ts para el detalle de qué es cada campo.

interface EmailPending {
  email: string;
  codeVerifier: string;
  state: string;
  interactionEvent: "SignIn" | "Register";
  interactionCookie: string;
  verificationId: string;
}

interface SocialPending {
  connectorId: string;
  redirectUri: string;
  interactionCookie: string;
  verificationId: string;
  // codeVerifier/logtoState son de la interacción OIDC PROPIA con Logto
  // (para el intercambio final vía finishTokenExchange) — oauthState es un
  // valor DISTINTO, el anti-CSRF que viaja de ida y vuelta con GitHub/
  // Google mismos. No es el mismo dato aunque ambos se llamen "state": uno
  // lo valida Logto, el otro lo validamos nosotros al recibir el callback.
  codeVerifier: string;
  logtoState: string;
  oauthState: string;
}

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly logto: LogtoOidcClient,
    private readonly logtoExperience: LogtoExperienceClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailDestinationLimiter: EmailDestinationLimiter,
    private readonly pendingTokens: EmailPendingTokenService,
    private readonly authService: AuthService
  ) {}

  // NUNCA reenviar ExperienceApiError.message tal cual al cliente — es el
  // mensaje crudo del conector de Logto, que a su vez puede traer el error
  // crudo del proveedor de correo por debajo (hallazgo real de producción:
  // Resend en modo sandbox devolvió su propio mensaje de error completo,
  // exponiendo qué proveedor se usa, que la cuenta no tiene dominio
  // verificado, Y el correo personal del desarrollador — a cualquier
  // visitante no autenticado, sin haber iniciado sesión siquiera). El
  // detalle real se audita acá, server-side; al cliente solo le llega un
  // mensaje genérico y seguro.
  private sanitizedEmailError(err: ExperienceApiError, context: string, safeMessage: string): BadRequestException {
    this.logger.error(`${context} — Logto Experience API rechazó la operación: [${err.code ?? "sin código"}] ${err.message}`);
    return new BadRequestException(safeMessage);
  }

  // Más estricto que el global (5/s, 100/min) a propósito: cada hit real
  // dispara un round-trip contra el authorization endpoint de Logto — un
  // flood aquí no solo carga este backend, también gasta la cuota/anfitrión
  // de un tercero que no controlamos. Un estudiante real nunca necesita
  // reintentar login 5 veces en 10s.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Get("login")
  login(
    @Query("connector") connector: string | undefined,
    @Query("email") email: string | undefined,
    @Res() res: Response
  ) {
    const { codeVerifier, codeChallenge, state } = this.logto.generatePkce();

    // ?connector=github|google viene del botón "Continuar con GitHub/
    // Google" de Login.svelte — salta directo al conector social
    // correspondiente en vez de mostrar el selector genérico de Logto
    // (ver comentario en logto-oidc.client.ts). Solo se reconocen estos
    // dos valores a propósito: un valor arbitrario del query string no
    // debería poder inyectar cualquier direct_sign_in sin que este
    // backend lo valide primero. "google" requiere que el conector social
    // de Google ya esté configurado en el tenant de Logto (Console →
    // Connectors) — sin eso, Logto rechaza el direct_sign_in aunque este
    // backend lo arme bien.
    const SOCIAL_CONNECTORS: Record<string, string> = { github: "social:github", google: "social:google" };
    const directSignIn = connector ? SOCIAL_CONNECTORS[connector] : undefined;

    // ?email=... viene del campo de correo en Login.svelte — precarga el
    // campo en la pantalla de Logto (login_hint), nunca salta el paso del
    // código de verificación. Un chequeo de forma mínimo antes de
    // reenviarlo, para no meter cualquier string arbitrario del query
    // string a la URL de autorización sin pasar por este backend primero.
    const loginHint = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;

    let authUrl: string;
    try {
      authUrl = this.logto.authorizationUrl({ codeChallenge, state, directSignIn, loginHint });
    } catch {
      // Logto sigue con credenciales placeholder (ver LogtoOidcClient) —
      // esto es un estado esperado en desarrollo, no un 500 crudo que
      // parezca un crash. Redirige al frontend con una señal clara en vez
      // de tirar un JSON de error sin contexto.
      const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
      return res.redirect(`${frontendOrigin}/?auth_error=logto_not_configured`);
    }

    res.cookie(OIDC_COOKIE, JSON.stringify({ codeVerifier, state }), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      signed: true,
      maxAge: 5 * 60 * 1000, // 5 minutos — el login real no debería tardar más
    });

    return res.redirect(authUrl);
  }

  // Mismo motivo que /auth/login: exchangeCode() hace un round-trip real
  // contra el token endpoint de Logto (además de un upsert en la base de
  // datos) — no es una lectura barata que el rate limit global (100/min)
  // esté pensado para absorber en volumen.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Get("callback")
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("iss") iss: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const pendingRaw = req.signedCookies?.[OIDC_COOKIE];
    if (!pendingRaw) {
      throw new BadRequestException("Sesión de login expirada o inválida — intenta de nuevo");
    }
    const pending = JSON.parse(pendingRaw) as { codeVerifier: string; state: string };
    res.clearCookie(OIDC_COOKIE);

    const result = await this.authService.finishTokenExchange({
      code,
      state,
      iss,
      expectedState: pending.state,
      codeVerifier: pending.codeVerifier,
    });

    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    if (!result.ok) {
      return res.redirect(`${frontendOrigin}/?auth_error=${result.reason}`);
    }

    // El token nunca pasa por un log de servidor: viaja en el fragmento de
    // la URL, que el navegador NO envía en la petición HTTP — solo
    // JavaScript en el frontend puede leerlo (window.location.hash).
    //
    // Se redirige a la RAÍZ del frontend, no a "/auth/callback" — el
    // frontend es un SPA de una sola página sin router (Vite + Svelte
    // plano, sin rutas registradas), así que una ruta aparte 404earía en
    // Vercel sin agregar una regla de rewrite solo para esto. Más simple:
    // el frontend revisa `location.hash` en cada carga (src/lib/auth.ts).
    return res.redirect(`${frontendOrigin}/#access_token=${result.accessToken}`);
  }

  // Login social embebido (GitHub/Google) — Paso 1 de 2. Reemplaza a
  // /auth/login?connector=... para estos dos botones: en vez de saltar al
  // selector genérico de Logto vía direct_sign_in (que a veces cae de
  // vuelta al /sign-in genérico si el conector no está listado ahí, bug
  // real reportado en producción), habla con la Experience API server-side
  // y redirige AL NAVEGADOR directo a la pantalla real de GitHub/Google —
  // la UI de Logto nunca se llega a mostrar.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Get("social/start")
  async socialStart(@Query("connector") connector: string | undefined, @Res() res: Response) {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const envKey = connector ? SOCIAL_CONNECTOR_ENV[connector] : undefined;
    const connectorId = envKey ? this.config.get<string>(envKey) : undefined;
    if (!connectorId) {
      return res.redirect(`${frontendOrigin}/?auth_error=connector_invalido`);
    }

    const { codeVerifier, codeChallenge, state: logtoState } = this.logto.generatePkce();
    let authUrl: string;
    try {
      authUrl = this.logto.authorizationUrl({ codeChallenge, state: logtoState });
    } catch {
      // Mismo caso que /auth/login: Logto sigue con credenciales
      // placeholder — ver el comentario ahí.
      return res.redirect(`${frontendOrigin}/?auth_error=logto_not_configured`);
    }

    const redirectUri = this.config.getOrThrow<string>("SOCIAL_REDIRECT_URI");
    const oauthState = randomUUID();

    try {
      let cookie = await this.logtoExperience.startInteraction(authUrl);
      cookie = await this.logtoExperience.setInteractionEvent(cookie, "SignIn");
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

      return res.redirect(authorizationUri);
    } catch (err) {
      this.logger.error(
        `socialStart(${connector}) — Logto Experience API rechazó el inicio del login social: ${(err as Error).message}`
      );
      return res.redirect(`${frontendOrigin}/?auth_error=social_login_failed`);
    }
  }

  // Login social embebido — Paso 2 de 2. `redirectUri` (SOCIAL_REDIRECT_URI)
  // apunta ACÁ, así que este endpoint tiene que estar agregado como
  // callback URL autorizado en el OAuth App de GitHub y en el cliente
  // OAuth de Google Cloud (además del callback propio de Logto que ya
  // tenían) — sin eso, GitHub/Google rechazan el intercambio con
  // redirect_uri_mismatch antes de llegar siquiera acá.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Get("social/callback")
  async socialCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const pendingRaw = req.signedCookies?.[SOCIAL_COOKIE];
    res.clearCookie(SOCIAL_COOKIE);

    if (!pendingRaw) {
      return res.redirect(`${frontendOrigin}/?auth_error=social_session_expired`);
    }
    const pending = JSON.parse(pendingRaw) as SocialPending;

    if (providerError || !code || !state || state !== pending.oauthState) {
      return res.redirect(`${frontendOrigin}/?auth_error=social_login_cancelled`);
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
      if (identification.status !== 204 && identification.errorCode === "user.user_not_exist") {
        // La identidad YA viene probada por GitHub/Google — a diferencia
        // del correo, no hace falta un código nuevo para "registrar":
        // reintenta la MISMA verificación ya hecha, solo cambiando el
        // evento a Register.
        const registerCookie = await this.logtoExperience.setInteractionEvent(identification.cookie, "Register");
        identification = await this.logtoExperience.submitIdentification(registerCookie, pending.verificationId);
      }
      if (identification.status !== 204) {
        this.logger.error(
          `socialCallback(${pending.connectorId}) — identification status ${identification.status} (${identification.errorCode ?? "sin código"})`
        );
        return res.redirect(`${frontendOrigin}/?auth_error=social_login_failed`);
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
        return res.redirect(`${frontendOrigin}/?auth_error=${result.reason}`);
      }
      return res.redirect(`${frontendOrigin}/#access_token=${result.accessToken}`);
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        this.logger.error(
          `socialCallback(${pending.connectorId}) — Logto Experience API rechazó la verificación: [${err.code ?? "sin código"}] ${err.message}`
        );
      } else {
        this.logger.error(`socialCallback(${pending.connectorId}) — error inesperado: ${(err as Error).message}`);
      }
      return res.redirect(`${frontendOrigin}/?auth_error=social_login_failed`);
    }
  }

  // Login por correo institucional embebido en Login.svelte — habla con la
  // Experience API de Logto (ver logto-experience.client.ts) en vez de
  // redirigir el navegador a la pantalla hospedada de Logto. Paso 1 de 2:
  // arranca la interacción y dispara el correo con el código.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Post("email/start")
  async emailStart(@Body("email") email: string | undefined, @Res() res: Response) {
    if (!isValidEmail(email)) {
      throw new BadRequestException("Escribe un correo válido");
    }
    // Límite por correo DESTINO, no por IP — ver EmailDestinationLimiter.
    // Sin dominio institucional exigido, cualquier correo es un blanco
    // válido para "email bombing" si solo se limitara por IP.
    if (!this.emailDestinationLimiter.tryConsume(email)) {
      throw new BadRequestException("Ya se mandaron varios códigos a este correo — espera unos minutos e intenta de nuevo");
    }

    const { codeVerifier, codeChallenge, state } = this.logto.generatePkce();
    const authUrl = this.logto.authorizationUrl({ codeChallenge, state });

    // Elegir el evento ANTES de mandar el código — esto es lo que arregla
    // el bug de los dos correos. Contrato real de Logto, comprobado contra
    // el tenant (agosto 2026):
    //   SignIn   → usuario existente: 204 · usuario nuevo: 404 user_not_exist
    //   Register → usuario nuevo: 201 · existente: 422 email_already_in_use
    // y cambiar el evento a mitad de la interacción DESTRUYE la
    // verificación ya aprobada (session.verification_session_not_found), o
    // sea que al fallar la corazonada hay que mandar un SEGUNDO código.
    // Como Logto no tiene un evento combinado, la única forma de acertar al
    // primer intento es saber de antemano si el correo ya existe: eso lo
    // responde nuestra propia tabla de usuarios (User.email, que se rellena
    // en cada login — ver provisionUser).
    //
    // Si el correo no está en nuestra base, se asume Register: el caso
    // masivo de aquí en adelante son estudiantes entrando por primera vez.
    // Un usuario que exista en Logto pero todavía no en nuestra base (o que
    // entró antes de que existiera esta columna) cae al fallback de
    // emailVerify y recibe dos correos ESA VEZ; a partir de la siguiente ya
    // queda registrado acá y le llega uno solo.
    const normalizedEmail = email.toLowerCase();
    const conocido = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const interactionEvent: "SignIn" | "Register" = conocido ? "SignIn" : "Register";

    try {
      let cookie = await this.logtoExperience.startInteraction(authUrl);
      cookie = await this.logtoExperience.setInteractionEvent(cookie, interactionEvent);
      const { cookie: cookieWithCode, verificationId } = await this.logtoExperience.requestEmailCode(
        cookie,
        email,
        interactionEvent
      );

      const pending: EmailPending = {
        email,
        codeVerifier,
        state,
        interactionEvent,
        interactionCookie: cookieWithCode,
        verificationId,
      };
      // pendingToken explícito en el cuerpo, no una cookie — ver el
      // comentario grande donde vivía EMAIL_COOKIE más arriba.
      // Login.svelte lo guarda en memoria y lo reenvía tal cual en
      // /auth/email/verify.
      return res.json({ pendingToken: this.pendingTokens.sign(pending) });
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        throw this.sanitizedEmailError(
          err,
          `emailStart(${email})`,
          "No se pudo enviar el código a tu correo — intenta de nuevo en unos minutos."
        );
      }
      throw err;
    }
  }

  // Paso 2 de 2: valida el código que el estudiante escribió en
  // Login.svelte. Si el correo no tiene cuenta todavía en Logto (primer
  // login), reinicia la interacción como registro y le pide al frontend
  // que muestre "te mandamos un código nuevo" — Logto no permite seguir
  // con la misma verificación al cambiar de SignIn a Register a mitad de
  // camino (ver comentario en submitIdentification()).
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Post("email/verify")
  async emailVerify(
    @Body("code") code: string | undefined,
    @Body("pendingToken") pendingToken: string | undefined,
    @Res() res: Response
  ) {
    const pending = this.pendingTokens.verify<EmailPending>(pendingToken);
    if (!pending || !code) {
      throw new BadRequestException("Sesión de verificación expirada o inválida — solicita un nuevo código");
    }

    let cookie: string;
    try {
      cookie = await this.logtoExperience.verifyEmailCode(
        pending.interactionCookie,
        pending.email,
        code,
        pending.verificationId
      );
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        // "not_found" (el código venció o ya se usó) y "code_mismatch"
        // (el código está mal escrito) son casos DISTINTOS que Logto ya
        // distingue — antes ambos caían en el mismo "intenta de nuevo"
        // genérico. Bug real reportado en producción: con ese mensaje
        // vago, quien recibía "not_found" reintentaba con EL MISMO código
        // ya vencido (el único que tenía a mano) y volvía a fallar exacto
        // igual — dos errores idénticos seguidos en los logs. El mensaje
        // ahora dice qué pasó de verdad y apunta al único camino que sí
        // funciona: "‹ Usar otro correo" deja el correo ya escrito y
        // dispara un código nuevo con un solo toque en "Continuar".
        const safeMessage =
          err.code === "verification_code.not_found"
            ? "Ese código ya venció o ya se usó — toca «Usar otro correo» abajo y pide uno nuevo (el correo se queda escrito, no hay que repetirlo)."
            : "Código incorrecto — revisa los 6 dígitos e intenta de nuevo.";
        throw this.sanitizedEmailError(err, `emailVerify.verifyEmailCode(${pending.email})`, safeMessage);
      }
      throw err;
    }

    const identification = await this.logtoExperience.submitIdentification(cookie, pending.verificationId);

    // La cookie con la que se continúa — cambia si hubo que reintentar con
    // el otro evento (ver abajo).
    let identifiedCookie = identification.cookie;

    // 204 = entró (usuario existente) · 201 = cuenta recién creada.
    const identificado = identification.status === 204 || identification.status === 201;

    if (!identificado) {
      // La corazonada de emailStart falló: creímos que el correo existía y
      // no existe (user_not_exist), o al revés (email_already_in_use). Pasa
      // solo cuando nuestra tabla está desincronizada con Logto — sobre
      // todo con cuentas creadas antes de que existiera User.email.
      //
      // Acá NO se puede reusar la verificación: cambiar el evento la
      // destruye (session.verification_session_not_found, comprobado contra
      // el tenant real). La única salida es reiniciar con el evento
      // correcto, lo que implica un segundo código. Por eso el arreglo de
      // verdad vive en emailStart (acertar a la primera) y esto es solo la
      // red de seguridad.
      const eventoCorrecto: "SignIn" | "Register" | null =
        identification.errorCode === "user.user_not_exist" && pending.interactionEvent === "SignIn"
          ? "Register"
          : identification.errorCode === "user.email_already_in_use" && pending.interactionEvent === "Register"
            ? "SignIn"
            : null;

      if (!eventoCorrecto) {
        this.logger.error(
          `emailVerify(${pending.email}) — identificación falló sin camino de recuperación: ${identification.errorCode ?? identification.status}`
        );
        throw new BadRequestException("No se pudo verificar el código — intenta de nuevo");
      }

      this.logger.warn(
        `emailVerify(${pending.email}) — el evento ${pending.interactionEvent} no aplicaba (${identification.errorCode}); se reinicia como ${eventoCorrecto} y se manda un código nuevo`
      );

      if (!this.emailDestinationLimiter.tryConsume(pending.email)) {
        throw new BadRequestException("Ya se mandaron varios códigos a este correo — espera unos minutos e intenta de nuevo");
      }

      const nuevaCookie = await this.logtoExperience.setInteractionEvent(identification.cookie, eventoCorrecto);
      let cookieWithCode: string;
      let verificationId: string;
      try {
        ({ cookie: cookieWithCode, verificationId } = await this.logtoExperience.requestEmailCode(
          nuevaCookie,
          pending.email,
          eventoCorrecto
        ));
      } catch (err) {
        if (err instanceof ExperienceApiError) {
          throw this.sanitizedEmailError(
            err,
            `emailVerify.retry-${eventoCorrecto}(${pending.email})`,
            "No se pudo enviar el código a tu correo — intenta de nuevo en unos minutos."
          );
        }
        throw err;
      }
      const nextPending: EmailPending = {
        ...pending,
        interactionEvent: eventoCorrecto,
        interactionCookie: cookieWithCode,
        verificationId,
      };
      // El código anterior ya no sirve — Login.svelte debe reemplazar el
      // pendingToken guardado por este.
      return res.status(202).json({
        needsNewCode: true,
        pendingToken: this.pendingTokens.sign(nextPending),
        message:
          eventoCorrecto === "Register"
            ? "Es tu primera vez con este correo — te mandamos un código nuevo para crear tu cuenta"
            : "Este correo ya tiene cuenta — te mandamos un código nuevo para entrar",
      });
    }

    const submitted = await this.logtoExperience.submitInteraction(identifiedCookie);
    const {
      code: authCode,
      state: authState,
      iss: authIss,
    } = await this.logtoExperience.completeAuthorization(submitted.cookie, submitted.redirectTo);

    const result = await this.authService.finishTokenExchange({
      code: authCode,
      state: authState,
      iss: authIss,
      expectedState: pending.state,
      codeVerifier: pending.codeVerifier,
    });

    if (!result.ok) {
      return res.status(403).json({ error: result.reason });
    }
    return res.json({ accessToken: result.accessToken });
  }

  // Identidad del estudiante logueado — el frontend la usa para mostrar
  // nombre/código en el formulario de alquiler en modo solo-lectura (nunca
  // se le pide al estudiante escribir su propio código a mano: lo que hay
  // en la base de datos es la fuente de verdad, aunque hoy sea un
  // placeholder "PENDIENTE-..." hasta que exista el flujo de verificación
  // institucional real).
  @Get("me")
  async me(@Req() req: Request & { user: { id: string } }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { fullName: true, uniqueCode: true, role: true, cedula: true, phone: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @Public()
  @Get("logout")
  logout(@Res() res: Response) {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const issuer = this.config.getOrThrow<string>("LOGTO_ISSUER");
    // Sin `client_id`, Logto no puede confirmar que `post_logout_redirect_uri`
    // esté en la lista blanca de ESTA app — sin esa validación, en vez de
    // redirigir de vuelta muestra su propia pantalla genérica "You have
    // successfully signed out" (hallazgo real en producción: el usuario
    // veía esa pantalla de Logto en vez de volver al login de AEIS-APP).
    const params = new URLSearchParams({
      post_logout_redirect_uri: frontendOrigin,
      client_id: this.config.getOrThrow<string>("LOGTO_APP_ID"),
    });
    return res.redirect(`${issuer}/session/end?${params.toString()}`);
  }
}
