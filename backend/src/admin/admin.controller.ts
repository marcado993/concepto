import { Body, Controller, Get, Param, Patch, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Role } from "@prisma/client";
import { Roles } from "../shared/auth/roles.decorator";
import { AdminService } from "./admin.service";
import { ListUsersQueryDto } from "./dto/list-users.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs.dto";
import { UpdateSubscriptionTierDto } from "./dto/update-subscription-tier.dto";
import { UpdateLockerPricingDto } from "./dto/update-locker-pricing.dto";

type AuthedRequest = Request & { user: { id: string } };

// Todo lo de acá exige PRESIDENTE — RolesGuard resuelve la jerarquía, así
// que DIRECTOR (que hereda todo lo de PRESIDENTE, ver roles.guard.ts)
// también entra. Un ESTUDIANTE nunca llega ni siquiera a los GET: JwtAuthGuard
// ya exige sesión, y RolesGuard corta antes del controller.
@Controller("admin")
@Roles(Role.PRESIDENTE)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("users")
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get("subscription-tiers")
  listSubscriptionTiers() {
    return this.admin.listSubscriptionTiers();
  }

  @Patch("subscription-tiers/:id")
  updateSubscriptionTier(
    @Param("id") id: string,
    @Body() dto: UpdateSubscriptionTierDto,
    @Req() req: AuthedRequest
  ) {
    return this.admin.updateSubscriptionTier(id, dto, { actorId: req.user.id, ipAddress: req.ip });
  }

  @Get("locker-pricing")
  getLockerPricing() {
    return this.admin.getLockerPricing();
  }

  @Patch("locker-pricing")
  updateLockerPricing(@Body() dto: UpdateLockerPricingDto, @Req() req: AuthedRequest) {
    return this.admin.updateLockerPricing(dto, { actorId: req.user.id, ipAddress: req.ip });
  }

  @Get("audit-logs")
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.admin.listAuditLogs(query);
  }
}
