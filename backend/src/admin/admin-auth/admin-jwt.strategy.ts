import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../shared/prisma/prisma.service";

interface AdminJwtPayload {
  sub: string;
  [claim: string]: unknown;
}

// Estrategia SEPARADA de JwtStrategy (jwt.strategy.ts) a propósito — esa
// valida contra el JWKS público de Logto (RS/ES asimétrico, firmado por
// Logto); esta valida contra ADMIN_JWT_SECRET (HS256, un secreto propio de
// este backend) porque el panel de administración tiene su login propio,
// completamente aparte de Logto (ver admin-auth.service.ts). Nombrada
// "admin-jwt" para que AdminJwtAuthGuard pueda pedir específicamente esta
// estrategia y no la de Logto.
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, "admin-jwt") {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>("ADMIN_JWT_SECRET"),
      algorithms: ["HS256"],
    });
  }

  async validate(payload: AdminJwtPayload) {
    // Se revalida contra la base en cada request en vez de confiar solo en
    // el payload firmado — así borrar una cuenta de administración corta
    // el acceso de inmediato, sin esperar a que su token (12h) expire solo.
    const account = await this.prisma.adminAccount.findUnique({ where: { id: payload.sub } });
    if (!account) throw new UnauthorizedException("Cuenta de administración no encontrada");
    return { id: account.id, email: account.email, role: account.role };
  }
}
