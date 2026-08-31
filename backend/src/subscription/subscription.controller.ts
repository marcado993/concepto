import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Public } from "../shared/auth/public.decorator";
import { Roles } from "../shared/auth/roles.decorator";
import { Role } from "@prisma/client";
import { SubscriptionService } from "./subscription.service";
import { SubscribeDto } from "./dto/subscribe.dto";

@Controller("subscriptions")
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  // Público — ver los tiers y sus precios no expone nada sensible, mismo
  // criterio que /lockers.
  //
  // Techo mucho más alto que el global — se pide en paralelo apenas la app
  // abre, así que el límite global por sí solo castigaba a varios
  // estudiantes reales compartiendo la misma IP de WiFi del campus (ver
  // rate-limit.module.ts).
  @Throttle({ short: { limit: 50, ttl: 1000 }, medium: { limit: 3000, ttl: 60_000 } })
  @Public()
  @Get("tiers")
  tiers() {
    return this.subscriptionService.listTiers();
  }

  @Get("mine")
  @Roles(Role.ESTUDIANTE)
  mine(@Req() req: Request & { user: { id: string } }) {
    return this.subscriptionService.getMine(req.user.id);
  }

  @Post()
  @Roles(Role.ESTUDIANTE)
  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  subscribe(@Body() dto: SubscribeDto, @Req() req: Request & { user: { id: string } }) {
    return this.subscriptionService.subscribe({
      userId: req.user.id,
      tierName: dto.tierName,
      fullName: dto.fullName,
      ipAddress: req.ip,
    });
  }
}
