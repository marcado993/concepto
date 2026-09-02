import { Module } from "@nestjs/common";
import { LockerController } from "./locker.controller";
import { LockerService } from "./locker.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { AuditModule } from "../shared/audit/audit.module";
import { PeriodModule } from "../shared/period/period.module";
import { PromoModule } from "../promo/promo.module";
import { MailModule } from "../shared/mail/mail.module";

@Module({
  // SubscriptionModule salio de aca: el descuento de casillero ya no
  // depende del tier de aportacion sino de un codigo promocional (ver
  // promo/promo-code.service.ts y el comentario del modelo PromoCode).
  imports: [AuditModule, PeriodModule, PromoModule, MailModule],
  controllers: [LockerController],
  providers: [LockerService, PayphoneClient],
})
export class LockerModule {}
