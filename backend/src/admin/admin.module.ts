import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { DangerZoneService } from "./danger-zone.service";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { PeriodModule } from "../shared/period/period.module";
import { SettingsModule } from "../shared/settings/settings.module";
import { MonitoringModule } from "../shared/monitoring/monitoring.module";
import { JobsModule } from "../jobs/jobs.module";
import { PromoModule } from "../promo/promo.module";

@Module({
  // JobsModule entra solo por JobIngestService (lo unico que exporta), para
  // el boton de "actualizar ofertas ahora" del panel — sin el, publicar el
  // modulo o cambiar un peso del motor obligaba a esperar el cron de 3 h.
  imports: [AuditModule, PeriodModule, AdminAuthModule, SettingsModule, MonitoringModule, JobsModule, PromoModule],
  controllers: [AdminController],
  providers: [AdminService, DangerZoneService],
})
export class AdminModule {}
