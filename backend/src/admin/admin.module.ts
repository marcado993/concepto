import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { DangerZoneService } from "./danger-zone.service";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { PeriodModule } from "../shared/period/period.module";
import { SettingsModule } from "../shared/settings/settings.module";
import { MonitoringModule } from "../shared/monitoring/monitoring.module";

@Module({
  imports: [AuditModule, PeriodModule, AdminAuthModule, SettingsModule, MonitoringModule],
  controllers: [AdminController],
  providers: [AdminService, DangerZoneService],
})
export class AdminModule {}
