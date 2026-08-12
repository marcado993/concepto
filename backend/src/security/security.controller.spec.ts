import { SecurityController } from "./security.controller";
import { SECURITY_INDICATORS } from "./indicators";
import { ZONES } from "./map-data";

describe("SecurityController", () => {
  const controller = new SecurityController();

  it("Dada una petición sin parámetro de riesgo, Cuando se piden los indicadores, Entonces devuelve la lista completa sin filtrar (son públicos, no personalizados)", () => {
    expect(controller.indicators()).toEqual(SECURITY_INDICATORS);
  });

  it("Dado un risk fuera de rango (2, o negativo), Cuando se pide el mapa, Entonces lo recorta a [0,1] en vez de propagar un valor absurdo al heatmap", () => {
    const alto = controller.mapData("2");
    const bajo = controller.mapData("-5");
    // Con risk=1 el conteo de puntos por zona es el máximo posible (14+70=84);
    // si no se recortara, "2" produciría aún más puntos que "1".
    expect(alto.points.features.length).toBe(controller.mapData("1").points.features.length);
    expect(bajo.points.features.length).toBe(controller.mapData("0").points.features.length);
  });

  it("Dado un parámetro no numérico, Cuando se pide el mapa, Entonces usa el valor por defecto (0.5) en vez de romper", () => {
    expect(() => controller.mapData("no-es-un-numero")).not.toThrow();
  });

  it("Dada cualquier petición, Cuando se pide el mapa, Entonces siempre incluye las 6 zonas reales sin filtrar", () => {
    const result = controller.mapData();
    expect(result.zones).toEqual(ZONES);
  });
});
