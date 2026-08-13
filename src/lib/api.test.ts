import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLockers } from "./api";

// TDD: cubre el reintento automático de fetchWithRetry() en api.ts —
// hallazgo real reportado con captura de pantalla (celular a 19.2 KB/s):
// subir un comprobante de transferencia fallaba con "Failed to fetch" en
// una conexión móvil lenta/inestable, obligando a reintentar a mano justo
// en el momento de más ansiedad del flujo (¿se subió o no, me cobraron?).
// El reintento es seguro porque toda acción crítica (alquilar, confirmar
// comprobante) ya está protegida server-side con
// `updateMany WHERE status:"PENDING"` (ver locker.service.ts) — repetir
// una petición que en realidad SÍ llegó la primera vez encuentra 0 filas
// PENDING y responde "ya fue procesado" en vez de duplicar nada.
describe("api.ts — reintento automático ante fallos de red", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Dado que fetch() falla dos veces y luego tiene éxito (conexión móvil que corta la petición a medio camino), Cuando se pide fetchLockers(), Entonces reintenta automáticamente y retorna el resultado, sin que el estudiante tenga que volver a intentarlo a mano", async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      if (calls <= 2) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(new Response(JSON.stringify([{ id: "1", code: "A01" }]), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLockers();

    expect(calls).toBe(3);
    expect(result).toEqual([{ id: "1", code: "A01" }]);
  });

  it("Dado que fetch() falla en TODOS los intentos (conexión de verdad caída), Cuando se pide fetchLockers(), Entonces se rinde tras 3 intentos en total con un mensaje claro — nunca la URL cruda del backend ni jerga de 'Failed to fetch'", async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLockers()).rejects.toThrow("No se pudo conectar con el servidor — revisa tu conexión a internet e intenta de nuevo.");
    expect(calls).toBe(3);
  });

  it("Dado que el backend SÍ responde (con un error HTTP real, no un fallo de red), Cuando se pide fetchLockers(), Entonces NO reintenta — una respuesta que ya se recibió nunca debe repetirse (podría duplicar una acción del lado del servidor)", async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    // fetchLockers() usa getJSON(), que no parsea el body de error (a
    // diferencia de postJSON/postFormData vía friendlyErrorMessage) — lo
    // que importa acá es que NO reintentó, no el texto exacto del mensaje.
    await expect(fetchLockers()).rejects.toThrow("Backend respondió 500 en /lockers");
    expect(calls).toBe(1);
  });
});
