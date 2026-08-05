<script lang="ts">
  import * as maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";

  interface Props {
    risk?: number; // 0..1, current hour's illustrative risk level
    accent?: string;
  }

  type FeatureCollection = {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, string>;
      geometry: { type: "Point"; coordinates: [number, number] };
    }>;
  };

  let { risk = 0.5, accent = "#f5b942" }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let map: maplibregl.Map | null = null;
  let ready = $state(false);

  // Real Quito zone centers near the EPN/La Floresta campus with an
  // illustrative base weight (0..1, relative danger) — NOT sourced incident
  // counts. Each zone's shown color blends that base weight with the
  // current hour's citywide risk factor, so a naturally calmer sector
  // still reads cooler than a rougher one even during a "bad" hour.
  const ZONES = [
    { name: "La Floresta (EPN)", lng: -78.4886, lat: -0.2073, base: 0.5 },
    { name: "Itchimbía", lng: -78.503, lat: -0.2168, base: 0.65 },
    { name: "Centro Histórico", lng: -78.5125, lat: -0.2201, base: 0.8 },
    { name: "La Mariscal", lng: -78.4863, lat: -0.1985, base: 0.55 },
    { name: "González Suárez", lng: -78.479, lat: -0.204, base: 0.35 },
    { name: "El Ejido / La Carolina", lng: -78.493, lat: -0.187, base: 0.4 },
  ];

  function combinedRisk(base: number, riskFactor: number) {
    return Math.min(1, base * 0.55 + riskFactor * 0.45);
  }

  function riskColor(r: number) {
    if (r > 0.66) return "#ef4444";
    if (r > 0.4) return "#f5b942";
    return "#21e0a0";
  }

  function pointsGeoJSON(riskFactor: number): FeatureCollection {
    const features: FeatureCollection["features"] = [];
    for (const z of ZONES) {
      const c = combinedRisk(z.base, riskFactor);
      const count = Math.round(14 + c * 70);
      for (let i = 0; i < count; i++) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [z.lng + (Math.random() - 0.5) * 0.006, z.lat + (Math.random() - 0.5) * 0.006],
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }

  function labelsGeoJSON(riskFactor: number): FeatureCollection {
    return {
      type: "FeatureCollection",
      features: ZONES.map((z) => {
        const c = combinedRisk(z.base, riskFactor);
        return {
          type: "Feature",
          properties: { name: z.name, color: riskColor(c) },
          geometry: { type: "Point", coordinates: [z.lng, z.lat] },
        };
      }),
    };
  }

  $effect(() => {
    if (!container || map) return;
    const el = container;
    map = new maplibregl.Map({
      container: el,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [-78.4886, -0.208],
      zoom: 14,
      pitch: 45,
      bearing: -12,
      attributionControl: false,
    });
    const currentMap = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    currentMap.on("load", () => {
      if (map !== currentMap) return;

      currentMap.addSource("risk-points", { type: "geojson", data: pointsGeoJSON(risk) });
      currentMap.addLayer({
        id: "risk-heat",
        type: "heatmap",
        source: "risk-points",
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 2.4],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 16, 16, 42],
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(33,224,160,0)",
            0.25, "rgba(130,214,110,0.55)",
            0.5, "rgba(214,193,60,0.7)",
            0.7, "rgba(245,185,66,0.8)",
            0.85, "rgba(230,110,50,0.85)",
            1, "rgba(239,68,68,0.9)",
          ],
        },
      });

      currentMap.addSource("zone-labels", { type: "geojson", data: labelsGeoJSON(risk) });
      currentMap.addLayer({
        id: "zone-dot",
        type: "circle",
        source: "zone-labels",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#04060d",
        },
      });
      currentMap.addLayer({
        id: "zone-text",
        type: "symbol",
        source: "zone-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#eef4fb",
          "text-halo-color": "#04060d",
          "text-halo-width": 1.4,
        },
      });

      ready = true;
    });

    const ro = new ResizeObserver(() => currentMap.resize());
    ro.observe(el);
    requestAnimationFrame(() => currentMap.resize());

    return () => {
      ro.disconnect();
      map?.remove();
      map = null;
      ready = false;
    };
  });

  $effect(() => {
    const r = risk;
    if (!ready || !map) return;
    (map.getSource("risk-points") as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(r));
    (map.getSource("zone-labels") as maplibregl.GeoJSONSource | undefined)?.setData(labelsGeoJSON(r));
  });
</script>

<div class="map-shell">
  <div class="map-el" bind:this={container}></div>
  <div class="map-badge" style="--accent: {accent}">
    <span class="dot"></span>
    Quito · distribución ilustrativa, no incidentes reales
  </div>
</div>

<style>
  .map-shell {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
  }

  .map-el {
    position: absolute;
    inset: 0;
  }

  .map-badge {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(4, 8, 16, 0.72);
    backdrop-filter: blur(4px);
    font-size: 9.5px;
    letter-spacing: 0.03em;
    color: #eef4fb;
    border: 1px solid rgba(255, 255, 255, 0.12);
    pointer-events: none;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    flex-shrink: 0;
  }
</style>
