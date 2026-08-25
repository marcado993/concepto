import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../shared/auth/public.decorator";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginDto } from "./dto/admin-login.dto";

type AdminAuthedRequest = Request & { user: { id: string; email: string; role: string } };

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  // Endpoint adivinable por contraseña — más estricto que el login por
  // correo/OTP (ahí el "secreto" nunca sale del correo del estudiante),
  // acá si sale de aquí. Rate limit propio además del global.
  @Public()
  @Throttle({ short: { limit: 5, ttl: 10_000 }, medium: { limit: 8, ttl: 300_000 } })
  @Post("login")
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuth.login(dto.email, dto.password);
  }

  // Identidad de quien está en sesión en el panel — AdminApp.svelte lo usa
  // para mostrar el correo en el header, y como señal de "el token sigue
  // siendo válido" al montar (AdminJwtStrategy ya revalida contra la base).
  @Public()
  @UseGuards(AdminJwtAuthGuard)
  @Get("me")
  me(@Req() req: AdminAuthedRequest) {
    return { email: req.user.email, role: req.user.role };
  }
}
