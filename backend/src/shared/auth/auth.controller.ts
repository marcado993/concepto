import {
  Controller,
  Get,
  Logger,
  Post,
  Body,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { Public } from "./public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { PENDING_UNIQUE_CODE_PREFIX, PENDING_FULL_NAME } from "./auth.service";
import { OidcRedirectStrategy } from "./strategies/oidc-redirect.strategy";
import { SocialEmbeddedStrategy } from "./strategies/social-embedded.strategy";
import { EmailOtpStrategy } from "./strategies/email-otp.strategy";

// Enruta las peticiones HTTP a la estrategia de login correspondiente.
// La lógica real de cada flujo vive en strategies/:
//   OidcRedirectStrategy    → /auth/login, /auth/callback
//   SocialEmbeddedStrategy  → /auth/social/start, /auth/social/callback
//   EmailOtpStrategy        → /auth/email/start, /auth/email/verify
//
// Los endpoints no cambiaron — el frontend no necesita ningún ajuste.
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcRedirectStrategy,
    private readonly social: SocialEmbeddedStrategy,
    private readonly email: EmailOtpStrategy,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  // ── OIDC / redirect ────────────────────────────────────────────────────────

  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Get("login")
  login(
    @Query("connector") connector: string | undefined,
    @Query("email") email: string | undefined,
    @Res() res: Response
  ) {
    return this.oidc.start(connector, email, res);
  }

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
    return this.oidc.callback(code, state, iss, req, res);
  }

  // ── Social embebido (GitHub / Google) ──────────────────────────────────────

  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Get("social/start")
  async socialStart(@Query("connector") connector: string | undefined, @Res() res: Response) {
    return this.social.start(connector, res);
  }

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
    return this.social.callback(code, state, providerError, req, res);
  }

  // ── Correo institucional / OTP ─────────────────────────────────────────────

  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Post("email/start")
  async emailStart(@Body("email") email: string | undefined, @Res() res: Response) {
    return this.email.start(email, res);
  }

  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 } })
  @Post("email/verify")
  async emailVerify(
    @Body("code") code: string | undefined,
    @Body("pendingToken") pendingToken: string | undefined,
    @Res() res: Response
  ) {
    return this.email.verify(code, pendingToken, res);
  }

  // ── Identidad y sesión ─────────────────────────────────────────────────────

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
    // Mismo patrón que cedula/phone: el frontend nunca debe ver ningún
    // placeholder interno — null significa "todavía no lo completó", y el
    // paso de alquiler pide ambos como campo obligatorio (ver
    // rent-locker.dto.ts). fullName en particular: el placeholder JAMÁS
    // debe llegar a prellenar el formulario (bug real reportado — antes
    // el fallback ni siquiera era un placeholder reconocible, era
    // literalmente el correo del estudiante).
    return {
      ...user,
      fullName: user.fullName === PENDING_FULL_NAME ? null : user.fullName,
      uniqueCode: user.uniqueCode.startsWith(PENDING_UNIQUE_CODE_PREFIX) ? null : user.uniqueCode,
    };
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
