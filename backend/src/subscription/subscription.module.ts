import { Module } from "@nestjs/common";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionBenefitsService } from "./subscription-benefits.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { AuditModule } from "../shared/audit/audit.module";
import { OcrModule } from "../shared/ocr/ocr.module";
import { PeriodModule } from "../shared/period/period.module";

@Module({
  imports: [AuditModule, OcrModule, PeriodModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PayphoneClient, SubscriptionBenefitsService],
  // SOLO SubscriptionBenefitsService sale del módulo — ni SubscriptionService
  // ni PrismaService directo. Otro dominio (locker/) puede preguntar "¿qué
  // descuento tiene este estudiante?" pero no puede leer/crear Subscriptions
  // ni Payments por su cuenta — esa es la frontera real del dominio.
  exports: [SubscriptionBenefitsService],
})
export class SubscriptionModule {}
