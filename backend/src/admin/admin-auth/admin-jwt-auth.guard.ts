import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

// Pide específicamente la estrategia "admin-jwt" (ver admin-jwt.strategy.ts)
// — distinto del JwtAuthGuard global, que valida contra Logto.
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard("admin-jwt") {}
