import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveApiBaseUrl } from "./apiBase";

// Estos tests fijan el comportamiento que evita la rotura real: el panel de
// administracion publicado en panel.aeis-app.online pidiendole el login a
// `http://localhost:3000`, o sea a la maquina de quien lo estaba mirando.

function conHostname(hostname: string, protocol = "https:") {
  vi.stubGlobal("window", { location: { hostname, protocol } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveApiBaseUrl", () => {
  it("Dada VITE_API_BASE_URL definida, Cuando se resuelve, Entonces manda esa y nada mas", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://staging.ejemplo.test");
    conHostname("panel.aeis-app.online");

    expect(resolveApiBaseUrl()).toBe("https://staging.ejemplo.test");
  });

  // EL caso que rompio produccion: build sin la variable, servido desde un
  // dominio real. Antes devolvia localhost y la pagina quedaba inservible.
  //
  // El panel se sirve DENTRO de la red Tailscale, no en el internet
  // publico, asi que la API se deriva de su propio hostname para resolver
  // por la misma ruta de red que sirvio la pagina.
  it.each([
    ["panel.aeis-app.online", "https://api.aeis-app.online"],
    ["panel.otro-dominio.test", "https://api.otro-dominio.test"],
  ])(
    "Dado el panel servido desde '%s' sin variable, Cuando se resuelve, Entonces deriva la API del MISMO dominio",
    (hostname, esperado) => {
      vi.stubEnv("VITE_API_BASE_URL", "");
      conHostname(hostname);

      expect(resolveApiBaseUrl()).toBe(esperado);
    }
  );

  it.each([["aeis.app"], ["www.aeis.app"]])(
    "Dada la app del estudiante en '%s' sin variable, Cuando se resuelve, Entonces usa el backend de produccion",
    (hostname) => {
      vi.stubEnv("VITE_API_BASE_URL", "");
      conHostname(hostname);

      expect(resolveApiBaseUrl()).toBe("https://api.aeis-app.online");
    }
  );

  // Y la contraparte: en desarrollo tiene que seguir apuntando a la maquina
  // local, o `npm run dev` deja de hablarle al backend de uno.
  it.each([["localhost"], ["127.0.0.1"], ["[::1]"]])(
    "Dada NINGUNA variable y la pagina servida desde '%s', Cuando se resuelve, Entonces sigue siendo el backend local",
    (hostname) => {
      vi.stubEnv("VITE_API_BASE_URL", "");
      conHostname(hostname);

      expect(resolveApiBaseUrl()).toBe("http://localhost:3000");
    }
  );

  it("Dado que no hay DOM (tests, SSR), Cuando se resuelve, Entonces cae al backend local sin reventar", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubGlobal("window", undefined);

    expect(resolveApiBaseUrl()).toBe("http://localhost:3000");
  });
});
