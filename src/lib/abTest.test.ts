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

// Experimento cerrado (ver comentario en abTest.ts) — getUiVariant()
// siempre devuelve "B" ahora, sin importar qué había guardado antes.
describe("abTest.ts — getUiVariant", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("Dado un dispositivo que nunca visitó la app, Cuando pide su variante, Entonces es B y queda guardada", () => {
    expect(getUiVariant()).toBe("B");
    expect(localStorage.getItem("aeis_ui_variant")).toBe("B");
  });

  it("Dado un dispositivo que había quedado asignado a A antes de cerrar el experimento, Cuando pide su variante, Entonces migra a B — ya no hay moneda al aire, todos ven la lista accesible", () => {
    localStorage.setItem("aeis_ui_variant", "A");

    expect(getUiVariant()).toBe("B");
    expect(localStorage.getItem("aeis_ui_variant")).toBe("B");
  });

  it("Dado que localStorage tiene un valor corrupto/inesperado, Cuando pide su variante, Entonces igual devuelve B (nunca revienta)", () => {
    localStorage.setItem("aeis_ui_variant", "algo-que-no-es-A-ni-B");

    expect(getUiVariant()).toBe("B");
  });
});
