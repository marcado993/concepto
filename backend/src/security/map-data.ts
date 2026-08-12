// Auditoría (2026-08-10): esta lógica vivía en
// src/lib/SecurityMap.svelte del frontend — el componente Svelte
// construía el GeoJSON del heatmap en cada render, con la lista de zonas
// y las fórmulas de riesgo hardcodeadas en el mismo archivo que dibuja el
// mapa. Se mueve aquí completa (no reescrita "a ojo") para que:
//
//   1. El frontend deje de cargar/computar estos datos — solo pide el
//      GeoJSON ya armado y lo pinta (menos JS en el bundle, un solo lugar
//      para actualizar cifras reales sin redesplegar el frontend).
//   2. Sea testeable de forma aislada (Vitest en el frontend no cubría
//      esto — vivía dentro de un $effect atado al ciclo de vida del mapa).
//   3. El PRNG del jitter de puntos sea inyectable — antes usaba
//      Math.random() directo, imposible de probar de forma determinista.

export interface Zone {
  name: string;
  lng: number;
  lat: number;
  incidents: number;
  estimated: boolean;
}

// Mismos 6 puntos y mismas cifras que el componente original — fuente:
// Observatorio Metropolitano de Seguridad Ciudadana (OMSC) Quito, 2025.
export const ZONES: Zone[] = [
  { name: "Centro Histórico", lng: -78.5125, lat: -0.2201, incidents: 14842, estimated: false },
  { name: "La Mariscal", lng: -78.4863, lat: -0.1985, incidents: 7444, estimated: false },
  { name: "Itchimbía", lng: -78.503, lat: -0.2168, incidents: 6200, estimated: true },
  { name: "La Floresta (EPN)", lng: -78.4886, lat: -0.2073, incidents: 4100, estimated: true },
  { name: "El Ejido / La Carolina", lng: -78.493, lat: -0.187, incidents: 3600, estimated: true },
  { name: "González Suárez", lng: -78.479, lat: -0.204, incidents: 2400, estimated: true },
];

export const PEAK_INCIDENTS = 14842;

export type FeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, string>;
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
};

export function baseFor(zone: Pick<Zone, "incidents">): number {
  return Math.min(1, zone.incidents / PEAK_INCIDENTS);
}

export function combinedRisk(base: number, riskFactor: number): number {
  return Math.min(1, base * 0.62 + riskFactor * 0.38);
}

export function riskColor(r: number): string {
  if (r > 0.66) return "#ef4444";
  if (r > 0.4) return "#f5b942";
  return "#21e0a0";
}

// `rng` es inyectable a propósito — en producción es Math.random (jitter
// visual del heatmap, no necesita ser criptográfico), en tests es
// determinista para poder aseverar el conteo/posición de puntos.
export function pointsGeoJSON(riskFactor: number, rng: () => number = Math.random): FeatureCollection {
  const features: FeatureCollection["features"] = [];
  for (const zone of ZONES) {
    const risk = combinedRisk(baseFor(zone), riskFactor);
    const count = Math.round(14 + risk * 70);
    for (let i = 0; i < count; i++) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: [zone.lng + (rng() - 0.5) * 0.006, zone.lat + (rng() - 0.5) * 0.006],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function labelsGeoJSON(riskFactor: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ZONES.map((zone) => {
      const risk = combinedRisk(baseFor(zone), riskFactor);
      const count = zone.incidents.toLocaleString("es-EC");
      return {
        type: "Feature",
        properties: {
          name: zone.name,
          detail: zone.estimated ? `~${count} inc. (est.)` : `${count} inc. · 2025`,
          color: riskColor(risk),
        },
        geometry: { type: "Point", coordinates: [zone.lng, zone.lat] },
      };
    }),
  };
}
