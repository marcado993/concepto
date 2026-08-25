import { Test } from "@nestjs/testing";
import { UiVariantService } from "./ui-variant.service";
import { AppSettingService } from "./app-setting.service";

async function buildService(getValue: string | null) {
  const settings = { get: jest.fn().mockResolvedValue(getValue), set: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = await Test.createTestingModule({
    providers: [UiVariantService, { provide: AppSettingService, useValue: settings }],
  }).compile();
  return { service: moduleRef.get(UiVariantService), settings };
}

describe("UiVariantService.get", () => {
  it('Dado que nunca se configuró nada, Cuando se pide, Entonces devuelve "B" (mismo default que dejó el cierre del experimento A/B)', async () => {
    const { service } = await buildService(null);
    expect(await service.get()).toBe("B");
  });

  it('Dado un valor guardado inválido (dato corrupto/viejo), Cuando se pide, Entonces cae al default "B" en vez de propagar basura', async () => {
    const { service } = await buildService("C");
    expect(await service.get()).toBe("B");
  });

  it('Dado que el admin puso "A" (rueda), Cuando se pide, Entonces devuelve "A"', async () => {
    const { service } = await buildService("A");
    expect(await service.get()).toBe("A");
  });
});

describe("UiVariantService.set", () => {
  it("Dado un valor nuevo, Cuando se guarda, Entonces lo pasa a AppSettingService con la clave ui_variant", async () => {
    const { service, settings } = await buildService(null);
    await service.set("A");
    expect(settings.set).toHaveBeenCalledWith("ui_variant", "A");
  });
});
