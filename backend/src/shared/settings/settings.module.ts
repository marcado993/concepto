import { Module } from "@nestjs/common";
import { AppSettingService } from "./app-setting.service";
import { UiVariantService } from "./ui-variant.service";
import { UiVariantController } from "./ui-variant.controller";

@Module({
  controllers: [UiVariantController],
  providers: [AppSettingService, UiVariantService],
  exports: [UiVariantService],
})
export class SettingsModule {}
