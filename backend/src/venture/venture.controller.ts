import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Role } from "@prisma/client";
import { Public } from "../shared/auth/public.decorator";
import { Roles } from "../shared/auth/roles.decorator";
import { VentureService } from "./venture.service";
import { CreateVentureDto } from "./dto/create-venture.dto";

@Controller("ventures")
export class VentureController {
  constructor(private readonly ventures: VentureService) {}

  // Directorio público — sin PII, sin autenticación (coincide con
  // security.controller.ts: no hay motivo de negocio para exigir login
  // solo para ver la vitrina).
  //
  // Techo mucho más alto que el global — se pide en paralelo apenas la app
  // abre, así que el límite global por sí solo castigaba a varios
  // estudiantes reales compartiendo la misma IP de WiFi del campus (ver
  // rate-limit.module.ts).
  @Throttle({ short: { limit: 50, ttl: 1000 }, medium: { limit: 3000, ttl: 60_000 } })
  @Public()
  @Get()
  list() {
    return this.ventures.listApproved();
  }

  @Post()
  @Roles(Role.ESTUDIANTE)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateVentureDto, @Req() req: Request & { user: { id: string } }) {
    return this.ventures.create(req.user.id, dto, req.ip);
  }

  @Get("mine")
  @Roles(Role.ESTUDIANTE)
  mine(@Req() req: Request & { user: { id: string } }) {
    return this.ventures.listOwnedBy(req.user.id);
  }

  @Patch(":id/approve")
  @Roles(Role.PRESIDENTE)
  approve(@Param("id") id: string, @Req() req: Request & { user: { id: string } }) {
    return this.ventures.approve(id, req.user.id, req.ip);
  }
}
