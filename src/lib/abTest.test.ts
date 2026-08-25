import { describe, it, expect, beforeEach, vi } from "vitest";

// getUiVariant() ahora dispara una consulta real de fondo al backend (ver
// abTest.ts) — se mockea ANTES de importar abTest.ts (vi.mock se sube
// automáticamente arriba de los imports) para que ese fetch nunca se
// intente de verdad en un test que corre en Node sin backend.
const fetchUiVariantMock = vi.fn().mockResolvedValue({ variant: "B" });
vi.mock("./api", () => ({
  fetchUiVariant: () => fetchUiVariantMock(),
}));

import { getUiVariant } from "./abTest";

// El entorno de test es 'node' (vite.config.ts) — sin DOM, así que
// localStorage no existe de por sí. Un mock en memoria es suficiente:
// abTest.ts solo necesita getItem/setItem, nada más.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
vi.stubGlobal("localStorage", new MemoryStorage());

// Ya no es un experimento cerrado a la fuerza — es un feature flag real,
// editable desde el panel de administración (ver
// backend/src/shared/settings/ui-variant.service.ts). getUiVariant()
// devuelve YA lo que haya en caché local (o el default "B") sin esperar
// red, y refresca esa caché en segundo plano para la PRÓXIMA carga.
describe("abTest.ts — getUiVariant", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchUiVariantMock.mockClear();
  });

  it("Dado un dispositivo que nunca visitó la app, Cuando pide su variante, Entonces devuelve el default B sin esperar red", () => {
    expect(getUiVariant()).toBe("B");
  });

  it("Dado un dispositivo con A guardado (el admin activó la rueda desde el panel), Cuando pide su variante, Entonces respeta A", () => {
    localStorage.setItem("aeis_ui_variant", "A");

    expect(getUiVariant()).toBe("A");
  });

  it("Dado que localStorage tiene un valor corrupto/inesperado, Cuando pide su variante, Entonces cae al default B (nunca revienta)", () => {
    localStorage.setItem("aeis_ui_variant", "algo-que-no-es-A-ni-B");

    expect(getUiVariant()).toBe("B");
  });

  it("Cuando se pide la variante, Entonces dispara en segundo plano una consulta real al backend, sin bloquear el valor síncrono que ya devolvió", () => {
    const result = getUiVariant();

    expect(result).toBe("B");
    expect(fetchUiVariantMock).toHaveBeenCalledTimes(1);
  });
});
