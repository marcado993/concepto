import { AlertService } from "./alert.service";
import { ConfigService } from "@nestjs/config";

// Hallazgo de pentesting: si el .env se despliega con el placeholder del
// .env.example (https://ntfy.sh/<tu-topic-secreto>), este servicio posteaba
// las alertas a esa URL literal — un topic público adivinable, y nunca le
// llegaban a nadie. El guard isRealWebhook descarta URLs con < > o sin
// esquema http(s). Estos tests fijan que no vuelva a filtrar en silencio.
function makeService(alertUrls: string | undefined) {
  const config = { get: (k: string) => (k === "ALERT_WEBHOOK_URLS" ? alertUrls : undefined) } as unknown as ConfigService;
  return new AlertService(config);
}

describe("AlertService", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("Dado el placeholder del .env sin reemplazar (con < >), Cuando se manda una alerta, Entonces NO postea a ningún lado", async () => {
    const service = makeService("https://ntfy.sh/<tu-topic-secreto>");

    await service.send("CPU alta", "critical");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Dado un valor vacío, Cuando se manda una alerta, Entonces NO postea (solo loguea)", async () => {
    const service = makeService("");

    await service.send("CPU alta");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Dado una URL real, Cuando se manda una alerta, Entonces SÍ postea con el JSON esperado", async () => {
    const service = makeService("https://ntfy.sh/aeis-topic-real-123");

    await service.send("Memoria alta", "warning");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/aeis-topic-real-123");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual(expect.objectContaining({ text: "Memoria alta", severity: "warning" }));
  });

  it("Dado una lista mixta (una real, una placeholder), Cuando se manda, Entonces solo postea a la real", async () => {
    const service = makeService("https://ntfy.sh/real-topic, https://ntfy.sh/<placeholder>");

    await service.send("Disco lleno", "critical");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ntfy.sh/real-topic");
  });
});
