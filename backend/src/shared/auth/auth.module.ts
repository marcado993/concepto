import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { APP_GUARD } from "@nestjs/core";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { AuthController } from "./auth.controller";
import { LogtoOidcClient } from "./logto-oidc.client";

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    LogtoOidcClient,
    // Autenticación global (JWT de Logto) + autorización global (jerarquía
    // de roles) — cada endpoint nuevo queda protegido por defecto; se abre
    // explícitamente con @Public() (auth/login, auth/callback, datos de
    // seguridad sin PII) donde de verdad se necesite, nunca al revés. Esto
    // es lo que las reglas de policy/semgrep-rules.yml esperan encontrar en
    // cada controller de dinero.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PassportModule],
})
export class AuthModule {}
