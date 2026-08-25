import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { Public } from "../shared/auth/public.decorator";
import { AdminJwtAuthGuard } from "./admin-auth/admin-jwt-auth.guard";
import { AdminService } from "./admin.service";
import { ListUsersQueryDto } from "./dto/list-users.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs.dto";
import { UpdateSubscriptionTierDto } from "./dto/update-subscription-tier.dto";
import { UpdateLockerPricingDto } from "./dto/update-locker-pricing.dto";
import { UpdateUiVariantDto } from "./dto/update-ui-variant.dto";

type AuthedRequest = Request & { user: { id: string } };

// @Public() aquí NO significa "sin autenticación" — significa "sáltate el
// JwtAuthGuard GLOBAL (que valida contra Logto), esto usa su propio guard"
// (ver admin-jwt-auth.guard.ts / admin-auth.service.ts: login propio
// correo+contraseña, completamente aparte de User/Logto). Sin @Roles():
// llegar hasta acá YA exige un AdminAccount válido — no existe el concepto
// de "AdminAccount sin privilegios" que RolesGuard tendría que filtrar,
// a diferencia de User (donde ESTUDIANTE/PRESIDENTE/DIRECTOR conviven).
@Controller("admin")
@Public()
@UseGuards(AdminJwtAuthGuard)
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
    return this.admin.updateSubscriptionTier(id, dto, { adminActorId: req.user.id, ipAddress: req.ip });
  }

  @Get("locker-pricing")
  getLockerPricing() {
    return this.admin.getLockerPricing();
  }

  @Patch("locker-pricing")
  updateLockerPricing(@Body() dto: UpdateLockerPricingDto, @Req() req: AuthedRequest) {
    return this.admin.updateLockerPricing(dto, { adminActorId: req.user.id, ipAddress: req.ip });
  }

  @Get("audit-logs")
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.admin.listAuditLogs(query);
  }

  @Get("ui-variant")
  getUiVariant() {
    return this.admin.getUiVariant();
  }

  @Patch("ui-variant")
  updateUiVariant(@Body() dto: UpdateUiVariantDto, @Req() req: AuthedRequest) {
    return this.admin.updateUiVariant(dto, { adminActorId: req.user.id, ipAddress: req.ip });
  }
}
