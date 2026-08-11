import { Module } from "@nestjs/common";
import { VentureController } from "./venture.controller";
import { VentureService } from "./venture.service";
import { AuditModule } from "../shared/audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [VentureController],
  providers: [VentureService],
})
export class VentureModule {}
