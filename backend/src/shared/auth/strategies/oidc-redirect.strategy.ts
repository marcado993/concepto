import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AuthStrategy } from "./auth-strategy.interface";
import { LogtoOidcClient } from "../logto-oidc.client";
import { AuthService } from "../auth.service";

// La cookie de sesión de este flujo — viaja solo entre /auth/login y
// /auth/callback, que son los dos extremos de una NAVEGACIÓN completa del
// navegador (nunca un fetch cross-site). El código_verifier y el `state` de
// PKCE viajan acá — nunca en el propio parámetro `state` visible en la URL,
// que solo sirve para anti-CSRF, no para guardar el secreto de PKCE.
const OIDC_COOKIE = "aeis_oidc_pending";

// Flujo OIDC estándar con redirect a la pantalla hospedada de Logto — 2
// saltos de red (navegador → Logto → proveedor → Logto → backend), el mínimo
// posible para OIDC con un IdP intermedio SIN duplicar handshakes. Se usa
// como fallback cuando el login social embebido no aplica o como acceso
// directo al correo institucional en la pantalla de Logto.
@Injectable()
export class OidcRedirectStrategy implements AuthStrategy {
  readonly name = "oidc-redirect";
  private readonly logger = new Logger(OidcRedirectStrategy.name);

  constructor(
    private readonly logto: LogtoOidcClient,
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  // Más estricto que el global (5/s, 100/min) a propósito: cada hit real
  // dispara un round-trip contra el authorization endpoint de Logto — un
  // flood aquí no solo carga este backend, también gasta la cuota/anfitrión
  // de un tercero que no controlamos. Un estudiante real nunca necesita
  // reintentar login 5 veces en 10s.
  start(connector: string | undefined, email: string | undefined, res: Response): void {
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
      res.redirect(`${frontendOrigin}/?auth_error=logto_not_configured`);
      return;
    }

    res.cookie(OIDC_COOKIE, JSON.stringify({ codeVerifier, state }), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      signed: true,
      maxAge: 5 * 60 * 1000, // 5 minutos — el login real no debería tardar más
    });
    res.redirect(authUrl);
  }

  // Mismo motivo que start(): exchangeCode() hace un round-trip real contra
  // el token endpoint de Logto (además de un upsert en la base de datos) —
  // no es una lectura barata que el rate limit global (100/min) esté pensado
  // para absorber en volumen.
  async callback(code: string, state: string, iss: string | undefined, req: Request, res: Response): Promise<void> {
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
      res.redirect(`${frontendOrigin}/?auth_error=${result.reason}`);
      return;
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
    res.redirect(`${frontendOrigin}/#access_token=${result.accessToken}`);
  }
}
