import { Injectable } from "@nestjs/common";
import { AppSettingService } from "./app-setting.service";

// Qué navegación ve el estudiante — A = la rueda (ArcMenu), B = lista
// accesible (AccessibleCategoryNav). El experimento A/B real ya se cerró
// a favor de B (reportes repetidos de doble-tap en móvil con la rueda —
// ver abTest.ts), pero antes el valor quedaba hardcodeado en el frontend:
// cualquier cambio necesitaba un redeploy. Ahora vive acá, editable desde
// el panel de administración (AdminController) sin tocar código.
export type UiVariant = "A" | "B";

const UI_VARIANT_KEY = "ui_variant";
const DEFAULT_UI_VARIANT: UiVariant = "B";

function isUiVariant(value: string | null): value is UiVariant {
  return value === "A" || value === "B";
}

@Injectable()
export class UiVariantService {
  constructor(private readonly settings: AppSettingService) {}

  async get(): Promise<UiVariant> {
    const value = await this.settings.get(UI_VARIANT_KEY);
    return isUiVariant(value) ? value : DEFAULT_UI_VARIANT;
  }

  async set(variant: UiVariant): Promise<void> {
    await this.settings.set(UI_VARIANT_KEY, variant);
  }
}
