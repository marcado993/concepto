import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Controller,
  Get,
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

@Controller("auth")
export class AuthController {
  constructor(
    private readonly logto: LogtoOidcClient,
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
  login(@Query("connector") connector: string | undefined, @Res() res: Response) {
    const { codeVerifier, codeChallenge, state } = this.logto.generatePkce();

    // ?connector=github viene del botón "Continuar con GitHub" de
    // Login.svelte — salta directo al conector social de GitHub en vez de
    // mostrar el selector genérico de Logto (ver comentario en
    // logto-oidc.client.ts). Solo se reconoce "github" a propósito: un
    // valor arbitrario del query string no debería poder inyectar
    // cualquier direct_sign_in sin que este backend lo valide primero.
    const directSignIn = connector === "github" ? "social:github" : undefined;

    let authUrl: string;
    try {
      authUrl = this.logto.authorizationUrl({ codeChallenge, state, directSignIn });
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
    @Req() req: Request,
    @Res() res: Response
  ) {
    const pendingRaw = req.signedCookies?.[OIDC_COOKIE];
    if (!pendingRaw) {
      throw new BadRequestException("Sesión de login expirada o inválida — intenta de nuevo");
    }
    const pending = JSON.parse(pendingRaw) as { codeVerifier: string; state: string };
    res.clearCookie(OIDC_COOKIE);

    const tokenSet = await this.logto.exchangeCode({
      code,
      state,
      expectedState: pending.state,
      codeVerifier: pending.codeVerifier,
    });

    const claims = tokenSet.claims();
    await this.provisionUser(claims.sub, claims.email as string | undefined, claims.name as string | undefined);

    // El token nunca pasa por un log de servidor: viaja en el fragmento de
    // la URL, que el navegador NO envía en la petición HTTP — solo
    // JavaScript en el frontend puede leerlo (window.location.hash).
    //
    // Se redirige a la RAÍZ del frontend, no a "/auth/callback" — el
    // frontend es un SPA de una sola página sin router (Vite + Svelte
    // plano, sin rutas registradas), así que una ruta aparte 404earía en
    // Vercel sin agregar una regla de rewrite solo para esto. Más simple:
    // el frontend revisa `location.hash` en cada carga (src/lib/auth.ts).
    const frontendOrigin = this.config.getOrThrow<string>("FRONTEND_ORIGIN").split(",")[0];
    return res.redirect(`${frontendOrigin}/#access_token=${tokenSet.access_token}`);
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
