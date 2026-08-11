import { Test } from "@nestjs/testing";
import * as os from "node:os";
import { ResourceMonitorService } from "./resource-monitor.service";
import { AlertService } from "./alert.service";

// jest.mock (no jest.spyOn directo) — los bindings nativos de "node:os"
// vienen no-configurables en este runtime de Jest/ts-jest, así que
// spyOn().mockReturnValue() falla con "Cannot redefine property". Reemplazar
// el módulo completo con jest.mock es la forma robusta de inyectar
// valores deterministas sin depender de que el binding sea mutable.
jest.mock("node:os", () => ({
  loadavg: jest.fn(),
  cpus: jest.fn(),
  totalmem: jest.fn(),
  freemem: jest.fn(),
}));

describe("ResourceMonitorService", () => {
  let service: ResourceMonitorService;
  let alerts: { send: jest.Mock };

  function mockOs(loadavg1: number, cores: number, freeRatio: number) {
    (os.loadavg as jest.Mock).mockReturnValue([loadavg1, loadavg1, loadavg1]);
    (os.cpus as jest.Mock).mockReturnValue(Array(cores).fill({}));
    (os.totalmem as jest.Mock).mockReturnValue(1000);
    (os.freemem as jest.Mock).mockReturnValue(1000 * freeRatio);
  }

  beforeEach(async () => {
    alerts = { send: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [ResourceMonitorService, { provide: AlertService, useValue: alerts }],
    }).compile();
    service = moduleRef.get(ResourceMonitorService);
  });

  afterEach(() => jest.restoreAllMocks());

  it("Dado un CPU y memoria normales, Cuando corre el chequeo, Entonces NO envía ninguna alerta", async () => {
    mockOs(0.5, 2, 0.6); // loadRatio = 0.25, memUsed = 0.4

    await service.check();

    expect(alerts.send).not.toHaveBeenCalled();
  });

  it('Dado un CPU al 95% de un droplet de 2 núcleos (\"a punto de morir\"), Cuando corre el chequeo, Entonces envía UNA alerta de severidad critical', async () => {
    mockOs(1.9, 2, 0.5); // loadRatio = 0.95

    await service.check();

    expect(alerts.send).toHaveBeenCalledWith(expect.stringContaining("CRITICAL"), "critical");
  });

  it("Dado que el CPU se mantiene alto varios minutos seguidos, Cuando corre el chequeo repetidamente, Entonces alerta UNA sola vez, no en cada corrida (cooldown, evita spamear el correo/celular)", async () => {
    mockOs(1.9, 2, 0.5);

    await service.check();
    await service.check();
    await service.check();

    expect(alerts.send).toHaveBeenCalledTimes(1);
  });

  it("Dado que el CPU baja después de haber estado crítico, Cuando corre el chequeo, Entonces envía un aviso de recuperación (para no dejar la duda de si sigue caído)", async () => {
    mockOs(1.9, 2, 0.5); // critical
    await service.check();

    mockOs(0.2, 2, 0.5); // vuelve a la normalidad
    await service.check();

    expect(alerts.send).toHaveBeenCalledTimes(2);
    expect(alerts.send).toHaveBeenLastCalledWith(expect.stringContaining("Recuperado"), "warning");
  });
});
