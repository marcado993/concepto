import { Module } from "@nestjs/common";
import { LockerController } from "./locker.controller";
import { LockerService } from "./locker.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { AuditModule } from "../shared/audit/audit.module";
import { PeriodModule } from "../shared/period/period.module";
import { SubscriptionModule } from "../subscription/subscription.module";

@Module({
  imports: [AuditModule, PeriodModule, SubscriptionModule],
  controllers: [LockerController],
  providers: [LockerService, PayphoneClient],
})
export class LockerModule {}
