import { Module } from "@nestjs/common";
import { LockerController } from "./locker.controller";
import { LockerService } from "./locker.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { AuditModule } from "../shared/audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [LockerController],
  providers: [LockerService, PayphoneClient],
})
export class LockerModule {}
