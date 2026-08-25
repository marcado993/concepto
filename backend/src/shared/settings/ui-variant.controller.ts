import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { UiVariantService } from "./ui-variant.service";

// Público — TODO estudiante necesita esto antes de decidir qué navegación
// mostrar, sin sesión (ver src/lib/abTest.ts en el frontend). El control
// de escritura vive en AdminController (PATCH /admin/ui-variant), no acá.
@Controller()
export class UiVariantController {
  constructor(private readonly uiVariant: UiVariantService) {}

  @Public()
  @Get("ui-variant")
  async get() {
    return { variant: await this.uiVariant.get() };
  }
}
