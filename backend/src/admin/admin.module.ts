import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { PeriodModule } from "../shared/period/period.module";

@Module({
  imports: [AuditModule, PeriodModule, AdminAuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
