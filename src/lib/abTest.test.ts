import { describe, it, expect, beforeEach, vi } from "vitest";
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

// TDD: la asignación de variante A/B tiene que quedar FIJA por dispositivo
// — un experimento donde la misma persona ve A una vez y B la siguiente no
// mide nada. localStorage (no sessionStorage) a propósito: debe sobrevivir
// a cerrar la pestaña, no solo a la sesión actual.
describe("abTest.ts — getUiVariant", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("Dado un dispositivo que nunca visitó la app, Cuando pide su variante, Entonces asigna A o B y la deja guardada para la próxima vez", () => {
    const first = getUiVariant();

    expect(["A", "B"]).toContain(first);
    expect(localStorage.getItem("aeis_ui_variant")).toBe(first);
  });

  it("Dado un dispositivo que ya tiene una variante asignada, Cuando pide su variante de nuevo, Entonces devuelve SIEMPRE la misma — nunca reasigna al azar", () => {
    localStorage.setItem("aeis_ui_variant", "B");

    expect(getUiVariant()).toBe("B");
    expect(getUiVariant()).toBe("B");
    expect(getUiVariant()).toBe("B");
  });

  it("Dado que localStorage tiene un valor corrupto/inesperado, Cuando pide su variante, Entonces lo trata como si no hubiera nada guardado y asigna una nueva (nunca revienta)", () => {
    localStorage.setItem("aeis_ui_variant", "algo-que-no-es-A-ni-B");

    expect(["A", "B"]).toContain(getUiVariant());
  });
});
