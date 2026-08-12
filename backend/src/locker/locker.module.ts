import { Module } from "@nestjs/common";
import { LockerController } from "./locker.controller";
import { LockerService } from "./locker.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { AuditModule } from "../shared/audit/audit.module";
import { OcrModule } from "../shared/ocr/ocr.module";
import { PeriodModule } from "../shared/period/period.module";
import { SubscriptionModule } from "../subscription/subscription.module";

@Module({
  imports: [AuditModule, OcrModule, PeriodModule, SubscriptionModule],
  controllers: [LockerController],
  providers: [LockerService, PayphoneClient],
})
export class LockerModule {}
