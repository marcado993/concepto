import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// Bandeja genérica clave/valor (feature flags, ajustes globales) — ver
// AppSetting en schema.prisma. Servicios específicos (ej. UiVariantService)
// envuelven una clave puntual con su propio default/validación; este
// servicio no sabe nada del SIGNIFICADO de ninguna clave, solo lee/escribe.
@Injectable()
export class AppSettingService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
