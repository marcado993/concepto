import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { Public } from "./public.decorator";
import { LogtoOidcClient } from "./logto-oidc.client";
import { ExperienceApiError, LogtoExperienceClient } from "./logto-experience.client";
import { PrismaService } from "../prisma/prisma.service";

// Flujo de login — 2 saltos de red (navegador → Logto → GitHub → Logto →
// backend), el mínimo posible para OIDC con un proveedor externo (mismo
// razonamiento que aeis-app documentó para OAuth2Login: un IdP intermedio
// SIN duplicar handshakes).
//
// El código_verifier y el `state` de PKCE viajan en una cookie firmada de
// corta vida — nunca en el propio parámetro `state` visible en la URL, que
// solo sirve para anti-CSRF, no para guardar el secreto de PKCE.
const OIDC_COOKIE = "aeis_oidc_pending";

// Login por correo institucional embebido — a diferencia de OIDC_COOKIE
// (que solo guarda codeVerifier/state mientras el navegador está AFUERA,
// en Logto), esta cookie vive durante TODO el intercambio con la
// Experience API: el estudiante nunca navega a Logto, así que el estado
// de la interacción (sus cookies internas, el verificationId pendiente)
// tiene que sobrevivir entre el POST /auth/email/start y el POST
// /auth/email/verify de este mismo backend. Ver logto-experience.client.ts
// para el detalle de qué es cada campo.
const EMAIL_COOKIE = "aeis_email_pending";

interface EmailPending {
  email: string;
  codeVerifier: string;
  state: string;
  interactionEvent: "SignIn" | "Register";
  interactionCookie: string;
  verificationId: string;
}

// Restricción de dominio institucional — aplicada AQUÍ, en el backend, no
// intentando configurarla del lado de Logto: Logto no tiene una forma
// nativa y confiable de "solo permitir este dominio de correo" que cubra
// A LA VEZ el conector de correo institucional Y GitHub (un conector
// social no sabe nada de dominios EPN). Chequear claims.email acá cubre
// los dos casos con una sola regla, sin importar qué conector se usó.
//
// Con GitHub esto tiene una limitación real que hay que comunicar a los
// estudiantes: si su cuenta de GitHub no tiene el correo público/verificado
// habilitado en su perfil, Logto no puede entregarnos ese claim aunque el
// estudiante SÍ sea de la EPN — el login se rechaza igual, porque no hay
// forma de verificar el dominio sin ese dato. La alternativa (confiar en
// el login sin verificar dominio) es peor: cualquiera con cuenta de GitHub
// entraría como si fuera estudiante de Sistemas.
const ALLOWED_EMAIL_DOMAIN = "epn.edu.ec";

function isInstitutionalEmail(email: string | undefined): email is string {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly logto: LogtoOidcClient,
    private readonly logtoExperience: LogtoExperienceClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

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

    // ?connector=github viene del botón "Continuar con GitHub" de
    // Login.svelte — salta directo al conector social de GitHub en vez de
    // mostrar el selector genérico de Logto (ver comentario en
    // logto-oidc.client.ts). Solo se reconoce "github" a propósito: un
    // valor arbitrario del query string no debería poder inyectar
    // cualquier direct_sign_in sin que este backend lo valide primero.
    const directSignIn = connector === "github" ? "social:github" : undefined;

    // ?email=... viene del campo de correo institucional en Login.svelte
    // — precarga el campo en la pantalla de Logto (login_hint), nunca
    // salta el paso del código de verificación. Un chequeo de forma
    // mínimo (no una validación de dominio real — eso ya lo hace
    // isInstitutionalEmail() en el callback) antes de reenviarlo, para no
    // meter cualquier string arbitrario del query string a la URL de
    // autorización sin pasar por este backend primero.
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

    const result = await this.finishTokenExchange({
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

  // Compartido entre /auth/callback (GitHub, redirige) y /auth/email/verify
  // (correo institucional embebido, responde JSON) — el intercambio de
  // código + validación de dominio + aprovisionamiento es EXACTAMENTE el
  // mismo trabajo sin importar qué conector produjo el `code`; solo cambia
  // cómo cada endpoint le informa el resultado al frontend.
  private async finishTokenExchange(params: {
    code: string;
    state: string;
    iss?: string;
    expectedState: string;
    codeVerifier: string;
  }): Promise<{ ok: true; accessToken: string } | { ok: false; reason: "dominio_no_institucional" }> {
    const tokenSet = await this.logto.exchangeCode(params);
    const claims = tokenSet.claims();
    const email = claims.email as string | undefined;

    // Se rechaza ANTES de tocar la base de datos — nunca se crea un User
    // "a medias" para un correo no institucional que después haya que
    // limpiar a mano. Ni siquiera se emite el access_token: sin esto, el
    // frontend igual habría recibido un token válido de Logto (la
    // AUTENTICACIÓN sí fue real) para alguien que este backend nunca
    // debió tratar como estudiante de la EPN.
    if (!isInstitutionalEmail(email)) {
      return { ok: false, reason: "dominio_no_institucional" };
    }

    await this.provisionUser(claims.sub, email, claims.name as string | undefined);
    if (!tokenSet.access_token) throw new Error("Logto no devolvió access_token");
    return { ok: true, accessToken: tokenSet.access_token };
  }

  // Login por correo institucional embebido en Login.svelte — habla con la
  // Experience API de Logto (ver logto-experience.client.ts) en vez de
  // redirigir el navegador a la pantalla hospedada de Logto. Paso 1 de 2:
  // arranca la interacción y dispara el correo con el código.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Post("email/start")
  async emailStart(@Body("email") email: string | undefined, @Res() res: Response) {
    if (!isInstitutionalEmail(email)) {
      throw new BadRequestException("Usa tu correo institucional @epn.edu.ec");
    }

    const { codeVerifier, codeChallenge, state } = this.logto.generatePkce();
    const authUrl = this.logto.authorizationUrl({ codeChallenge, state });

    try {
      let cookie = await this.logtoExperience.startInteraction(authUrl);
      cookie = await this.logtoExperience.setInteractionEvent(cookie, "SignIn");
      const { cookie: cookieWithCode, verificationId } = await this.logtoExperience.requestEmailCode(
        cookie,
        email,
        "SignIn"
      );

      const pending: EmailPending = {
        email,
        codeVerifier,
        state,
        interactionEvent: "SignIn",
        interactionCookie: cookieWithCode,
        verificationId,
      };
      res.cookie(EMAIL_COOKIE, JSON.stringify(pending), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        signed: true,
        maxAge: 10 * 60 * 1000, // el código de Logto vence a los 10 minutos
      });
      return res.json({});
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        throw new BadRequestException(err.message);
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
  async emailVerify(@Body("code") code: string | undefined, @Req() req: Request, @Res() res: Response) {
    const pendingRaw = req.signedCookies?.[EMAIL_COOKIE];
    if (!pendingRaw || !code) {
      throw new BadRequestException("Sesión de verificación expirada o inválida — solicita un nuevo código");
    }
    const pending = JSON.parse(pendingRaw) as EmailPending;

    let cookie: string;
    try {
      cookie = await this.logtoExperience.verifyEmailCode(
        pending.interactionCookie,
        pending.email,
        code,
        pending.verificationId
      );
    } catch (err) {
      if (err instanceof ExperienceApiError) throw new BadRequestException(err.message);
      throw err;
    }

    const identification = await this.logtoExperience.submitIdentification(cookie, pending.verificationId);

    if (identification.status !== 204) {
      if (identification.errorCode === "user.user_not_exist" && pending.interactionEvent === "SignIn") {
        const registerCookie = await this.logtoExperience.setInteractionEvent(identification.cookie, "Register");
        const { cookie: cookieWithCode, verificationId } = await this.logtoExperience.requestEmailCode(
          registerCookie,
          pending.email,
          "Register"
        );
        const nextPending: EmailPending = {
          ...pending,
          interactionEvent: "Register",
          interactionCookie: cookieWithCode,
          verificationId,
        };
        res.cookie(EMAIL_COOKIE, JSON.stringify(nextPending), {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          signed: true,
          maxAge: 10 * 60 * 1000,
        });
        return res.status(202).json({
          needsNewCode: true,
          message: "Es tu primera vez con este correo — te mandamos un código nuevo para crear tu cuenta",
        });
      }
      throw new BadRequestException("No se pudo verificar el código — intenta de nuevo");
    }

    const submitted = await this.logtoExperience.submitInteraction(identification.cookie);
    const {
      code: authCode,
      state: authState,
      iss: authIss,
    } = await this.logtoExperience.completeAuthorization(submitted.cookie, submitted.redirectTo);

    const result = await this.finishTokenExchange({
      code: authCode,
      state: authState,
      iss: authIss,
      expectedState: pending.state,
      codeVerifier: pending.codeVerifier,
    });
    res.clearCookie(EMAIL_COOKIE);

    if (!result.ok) {
      return res.status(403).json({ error: result.reason });
    }
    return res.json({ accessToken: result.accessToken });
  }

  // Provisiona el User en el primer login — mismo principio que aeis-app
  // documentó para OAuth social: el login identifica "quién eres en
  // internet", NO "eres estudiante de la EPN". Se crea con rol ESTUDIANTE
  // y SIN código único todavía; completar el código único/verificación
  // institucional es un flujo aparte (pendiente — ver
  // docs/dominio/02-necesidades-stakeholders.md).
  private async provisionUser(logtoSub: string, email?: string, name?: string) {
    return this.prisma.user.upsert({
      where: { logtoSub },
      update: {},
      create: {
        logtoSub,
        // randomUUID(), no un slice de logtoSub — un slice truncado puede
        // colisionar entre dos `sub` distintos y romper la restricción
        // @unique de uniqueCode con un 500 no controlado (hallazgo de la
        // auditoría de seguridad, 07-iso27001-sgsi-politica.md).
        uniqueCode: `PENDIENTE-${randomUUID()}`,
        fullName: name ?? email ?? "Estudiante pendiente de completar registro",
      },
    });
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
      select: { fullName: true, uniqueCode: true, role: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @Public()
  @Get("logout")
  logout(@Res() res: Response) {
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    const issuer = this.config.getOrThrow<string>("LOGTO_ISSUER");
    return res.redirect(
      `${issuer}/session/end?post_logout_redirect_uri=${encodeURIComponent(frontendOrigin)}`
    );
  }
}
