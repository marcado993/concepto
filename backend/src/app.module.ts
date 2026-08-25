import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./shared/prisma/prisma.module";
import { AuthModule } from "./shared/auth/auth.module";
import { LockerModule } from "./locker/locker.module";
import { SubscriptionModule } from "./subscription/subscription.module";
import { SecurityModule } from "./security/security.module";
import { RateLimitModule } from "./shared/rate-limit/rate-limit.module";
import { MetricsModule } from "./shared/metrics/metrics.module";
import { HealthModule } from "./shared/health/health.module";
import { MonitoringModule } from "./shared/monitoring/monitoring.module";
import { VentureModule } from "./venture/venture.module";
import { AdminModule } from "./admin/admin.module";
import { SettingsModule } from "./shared/settings/settings.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MetricsModule,
    RateLimitModule,
    HealthModule,
    MonitoringModule,
    AuthModule,
    LockerModule,
    SubscriptionModule,
    SecurityModule,
    VentureModule,
    AdminModule,
    SettingsModule,
    // Módulos pendientes (ver docs/dominio/02-necesidades-stakeholders.md §3
    // MoSCoW): PeriodModule, EventModule, ResourceModule, AnalyticsModule.
  ],
})
export class AppModule {}
