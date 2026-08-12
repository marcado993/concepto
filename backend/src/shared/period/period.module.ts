import { Module } from "@nestjs/common";
import { PeriodService } from "./period.service";

@Module({
  providers: [PeriodService],
  exports: [PeriodService],
})
export class PeriodModule {}
