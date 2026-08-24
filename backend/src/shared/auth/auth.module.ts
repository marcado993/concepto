import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { APP_GUARD } from "@nestjs/core";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LogtoOidcClient } from "./logto-oidc.client";
import { LogtoExperienceClient } from "./logto-experience.client";
import { EmailDestinationLimiter } from "../rate-limit/email-destination-limiter.service";
import { EmailPendingTokenService } from "./email-pending-token.service";
import { OidcRedirectStrategy } from "./strategies/oidc-redirect.strategy";
import { SocialEmbeddedStrategy } from "./strategies/social-embedded.strategy";
import { EmailOtpStrategy } from "./strategies/email-otp.strategy";

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [
    // Estrategias de login — cada una encapsula un flujo completo.
    OidcRedirectStrategy,
    SocialEmbeddedStrategy,
    EmailOtpStrategy,
    // Infraestructura compartida entre estrategias.
    AuthService,
    JwtStrategy,
    LogtoOidcClient,
    LogtoExperienceClient,
    EmailDestinationLimiter,
    EmailPendingTokenService,
    // Autenticación global (JWT de Logto) + autorización global (jerarquía
    // de roles) — cada endpoint nuevo queda protegido por defecto; se abre
    // explícitamente con @Public() (auth/login, auth/callback, datos de
    // seguridad sin PII) donde de verdad se necesite, nunca al revés. Esto
    // es lo que las reglas de policy/semgrep-rules.yml esperan encontrar en
    // cada controller de dinero.
    //
    // JwtAuthGuard/RolesGuard se registran DOS veces a propósito: una vez
    // como provider propio (útil para poder resolver/override la clase
    // desde afuera del módulo — ver test/lockers.e2e-spec.ts, que
    // necesita reemplazar JwtAuthGuard por un guard falso en e2e sin JWT
    // real de Logto), y otra vía APP_GUARD con `useExisting` (no
    // `useClass`, que crearía una SEGUNDA instancia distinta) para que el
    // guard global sea la MISMA instancia que ese provider — así un
    // override del provider sí se refleja en el guard global real.
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [PassportModule],
})
export class AuthModule {}
