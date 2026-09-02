import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { Public } from "../shared/auth/public.decorator";
import { AdminJwtAuthGuard } from "./admin-auth/admin-jwt-auth.guard";
import { AdminService } from "./admin.service";
import { DangerZoneService } from "./danger-zone.service";
import { JobIngestService } from "../jobs/job-ingest.service";
import { ListUsersQueryDto } from "./dto/list-users.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs.dto";
import { UpdateSubscriptionTierDto } from "./dto/update-subscription-tier.dto";
import { UpdateLockerPricingDto } from "./dto/update-locker-pricing.dto";
import { UpdateUiVariantDto } from "./dto/update-ui-variant.dto";
import { ConfirmWipeTestDataDto, ConfirmFreeLockersDto } from "./dto/confirm-danger-action.dto";

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
  constructor(
    private readonly admin: AdminService,
    private readonly dangerZone: DangerZoneService,
    private readonly jobIngest: JobIngestService
  ) {}

  @Get("overview")
  getOverview() {
    return this.admin.getOverview();
  }

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

  // Zona de riesgo — ver danger-zone.service.ts para el alcance exacto y
  // por qué cada tabla está incluida/excluida. Cada acción mutante exige
  // una frase de confirmación literal en el body (ConfirmWipeTestDataDto/
  // ConfirmFreeLockersDto) — un simple POST sin cuerpo no alcanza.
  @Get("danger-zone/preview")
  previewDangerZone() {
    return this.dangerZone.previewWipe();
  }

  @Post("danger-zone/wipe-test-data")
  wipeTestData(@Body() _dto: ConfirmWipeTestDataDto, @Req() req: AuthedRequest) {
    return this.dangerZone.wipeTestData({ adminActorId: req.user.id, ipAddress: req.ip });
  }

  @Post("danger-zone/free-lockers")
  freeLockers(@Body() _dto: ConfirmFreeLockersDto, @Req() req: AuthedRequest) {
    return this.dangerZone.freeLockers({ adminActorId: req.user.id, ipAddress: req.ip });
  }

  /**
   * Dispara una ingesta de la bolsa de empleo ahora mismo.
   *
   * Existe porque el cron corre cada 3 horas (ver JobIngestService): sin
   * esto, publicar el módulo o cambiar un peso del motor significaba
   * esperar hasta 3 h para ver el efecto. Es idempotente — el propio
   * servicio tiene un guard de reentrada, así que dispararlo dos veces
   * seguidas no duplica trabajo ni consumo de cuota contra las bolsas.
   *
   * NO lleva frase de confirmación como las acciones de la zona de riesgo:
   * esto no borra nada, solo refresca una caché de datos externos. Lo
   * protege el mismo AdminJwtAuthGuard de toda la clase.
   */
  @Post("jobs/ingest")
  ingestJobs() {
    return this.jobIngest.ingest();
  }
}
