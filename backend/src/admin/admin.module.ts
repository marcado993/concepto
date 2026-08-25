import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AuditModule } from "../shared/audit/audit.module";
import { PeriodModule } from "../shared/period/period.module";

@Module({
  imports: [AuditModule, PeriodModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
