import { Body, Controller, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Roles } from "../shared/auth/roles.decorator";
import { Role } from "@prisma/client";
import { SubscriptionService } from "./subscription.service";
import { SubscribeDto } from "./dto/subscribe.dto";

@Controller("subscriptions")
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  @Roles(Role.ESTUDIANTE)
  @Throttle({ default: { limit: 3, ttl: 10_000 } })
  subscribe(@Body() dto: SubscribeDto, @Req() req: Request & { user: { id: string } }) {
    return this.subscriptionService.subscribe({
      userId: req.user.id,
      tierName: dto.tierName,
      method: dto.method,
      ipAddress: req.ip,
      // TODO: mismo pendiente que LockerController — resolver desde PeriodService.
      periodId: "TODO-period-not-yet-implemented",
    });
  }
}
