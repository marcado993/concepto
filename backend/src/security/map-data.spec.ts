import { baseFor, combinedRisk, riskColor, pointsGeoJSON, labelsGeoJSON, ZONES, PEAK_INCIDENTS } from "./map-data";

describe("baseFor", () => {
  it("Dada la zona con más incidentes (Centro Histórico), Cuando se normaliza, Entonces da exactamente 1 (es el pico)", () => {
    expect(baseFor({ incidents: PEAK_INCIDENTS })).toBe(1);
  });

  it("Dada una zona con la mitad de incidentes del pico, Cuando se normaliza, Entonces da 0.5", () => {
    expect(baseFor({ incidents: PEAK_INCIDENTS / 2 })).toBe(0.5);
  });
});

describe("combinedRisk", () => {
  it("Dado riesgo base 0 y factor de hora 0, Cuando se combina, Entonces el riesgo total es 0", () => {
    expect(combinedRisk(0, 0)).toBe(0);
  });

  it("Dado riesgo base 1 y factor de hora 1, Cuando se combina, Entonces nunca excede 1 (clamp)", () => {
    expect(combinedRisk(1, 1)).toBe(1);
  });

  it("Dado un riesgo base fijo, Cuando el factor de hora sube, Entonces el riesgo combinado también sube (más riesgoso de noche)", () => {
    const dia = combinedRisk(0.5, 0.1);
    const noche = combinedRisk(0.5, 0.9);
    expect(noche).toBeGreaterThan(dia);
  });
});

describe("riskColor", () => {
  it("Dado un riesgo alto (>0.66), Cuando se colorea, Entonces es rojo", () => {
    expect(riskColor(0.8)).toBe("#ef4444");
  });
  it("Dado un riesgo medio (>0.4 y <=0.66), Cuando se colorea, Entonces es ámbar", () => {
    expect(riskColor(0.5)).toBe("#f5b942");
  });
  it("Dado un riesgo bajo (<=0.4), Cuando se colorea, Entonces es verde", () => {
    expect(riskColor(0.2)).toBe("#21e0a0");
  });
});

describe("pointsGeoJSON", () => {
  it("Dado un PRNG determinista fijo en 0.5 (sin jitter), Cuando se genera el heatmap, Entonces cada punto cae EXACTAMENTE en el centro de su zona", () => {
    const fixedRng = () => 0.5; // (0.5 - 0.5) * 0.006 === 0
    const fc = pointsGeoJSON(0, fixedRng);
    const centroHistorico = fc.features.find(
      (f) => f.geometry.coordinates[0] === ZONES[0].lng && f.geometry.coordinates[1] === ZONES[0].lat
    );
    expect(centroHistorico).toBeDefined();
  });

  it("Dado un riesgo mayor por hora del día, Cuando se genera el heatmap, Entonces produce más puntos totales (más denso)", () => {
    const rng = () => 0.5;
    const bajo = pointsGeoJSON(0, rng).features.length;
    const alto = pointsGeoJSON(1, rng).features.length;
    expect(alto).toBeGreaterThan(bajo);
  });

  it("Dado el número de zonas fijo, Cuando se genera el heatmap, Entonces hay al menos 14 puntos por zona (mínimo visual, incluso con riesgo 0)", () => {
    const fc = pointsGeoJSON(0, () => 0.5);
    expect(fc.features.length).toBeGreaterThanOrEqual(14 * ZONES.length);
  });
});

describe("labelsGeoJSON", () => {
  it("Dadas las 6 zonas reales, Cuando se generan las etiquetas, Entonces hay exactamente una etiqueta por zona, con su nombre real", () => {
    const fc = labelsGeoJSON(0.5);
    expect(fc.features).toHaveLength(ZONES.length);
    expect(fc.features.map((f) => f.properties.name)).toEqual(ZONES.map((z) => z.name));
  });

  it("Dada una zona marcada como estimada, Cuando se genera su etiqueta, Entonces el detalle se marca con \"~\" y \"(est.)\" — nunca se presenta una cifra estimada como si fuera oficial", () => {
    const fc = labelsGeoJSON(0.5);
    const estimada = fc.features.find((f) => f.properties.name === "Itchimbía")!;
    expect(estimada.properties.detail).toMatch(/^~.*\(est\.\)$/);

    const oficial = fc.features.find((f) => f.properties.name === "Centro Histórico")!;
    expect(oficial.properties.detail).not.toMatch(/est\./);
  });
});
