import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AlertService } from "./alert.service";
import { ResourceMonitorService } from "./resource-monitor.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [AlertService, ResourceMonitorService],
  exports: [AlertService],
})
export class MonitoringModule {}
