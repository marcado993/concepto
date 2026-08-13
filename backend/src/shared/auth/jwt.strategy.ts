import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-jwt";
import * as jwksRsa from "jwks-rsa";
import { PrismaService } from "../prisma/prisma.service";

// Valida el JWT que Logto emite (RS256, verificado contra el JWKS público
// de Logto — nunca un secreto compartido). LOGTO_ISSUER y LOGTO_AUDIENCE se
// configuran por entorno; su modo de despliegue (cloud vs. self-hosted)
// sigue como pregunta abierta en docs/dominio/02-necesidades-stakeholders.md
// §4 #5 — este strategy funciona igual en ambos casos, solo cambia el
// LOGTO_ISSUER.
//
// Importante: solo se guardan `sub`, no el access/refresh token de Logto
// (mismo principio de minimización que aeis-app ya aplicó para OAuth social,
// ver docs/dominio/01-analisis-negocio-mision.md §0).

interface LogtoJwtPayload {
  sub: string;
  [claim: string]: unknown;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    super({
      jwtFromRequest: (req) => req.headers?.authorization?.replace("Bearer ", "") ?? null,
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksUri: `${config.getOrThrow<string>("LOGTO_ISSUER")}/jwks`,
      }),
      // getOrThrow, no get: sin `audience` obligatorio, un token de Logto
      // emitido para OTRA aplicación del mismo tenant también sería válido
      // aquí (confused deputy) — hallazgo de la auditoría de seguridad,
      // ver 07-iso27001-sgsi-politica.md.
      audience: config.getOrThrow<string>("LOGTO_AUDIENCE"),
      issuer: config.getOrThrow<string>("LOGTO_ISSUER"),
      // Este tenant de Logto firma con ES384, no RS256 (mismo hallazgo que
      // logto-oidc.client.ts — confirmado ahí vía el discovery doc real:
      // id_token_signing_alg_values_supported=["ES384"], y acá vía un
      // login real en producción: jsonwebtoken rechazaba SILENCIOSAMENTE
      // cualquier access_token real porque su alg no estaba en la lista
      // permitida — 401 sin ningún log, porque el rechazo pasa dentro de
      // passport-jwt/jsonwebtoken antes de que este código vea el error.
      // A diferencia de logto-oidc.client.ts, acá no hay forma simple de
      // tomarlo del discovery doc (PassportStrategy configura esto de
      // forma síncrona en el constructor) — si Logto rota el algoritmo de
      // firma, este valor hay que actualizarlo a mano.
      algorithms: ["ES384"],
    });
  }

  async validate(payload: LogtoJwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { logtoSub: payload.sub } });
    if (!user) {
      // El login social identifica "quién eres en internet", no "eres
      // estudiante de la EPN" — mismo principio que aeis-app documentó para
      // Google/GitHub. Sin un User provisionado (código único verificado),
      // el JWT es válido pero no autoriza nada en AEIS-APP.
      throw new UnauthorizedException("Cuenta no registrada en AEIS-APP");
    }
    return user;
  }
}
