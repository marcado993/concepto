import { Module } from "@nestjs/common";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { AuditModule } from "../shared/audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PayphoneClient],
})
export class SubscriptionModule {}
