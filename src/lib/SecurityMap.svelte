<script lang="ts">
  // SecurityMap NO crea su propio Map — adopta el warmMap pre-inicializado
  // en mapWarm.ts que arrancó durante el splash screen.
  // La única operación que ocurre aquí es mover el div `warmShell` al
  // contenedor del componente (no hay new Map(), no hay workers nuevos).
  import * as maplibregl from "maplibre-gl";
  import { warmMap, warmShell, mapLoaded, state as warmState } from "./mapWarm";

  interface Props {
    risk?: number; // 0..1, current hour's illustrative risk level
    accent?: string;
    onready?: () => void;
  }

  type FeatureCollection = {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, string>;
      geometry: { type: "Point"; coordinates: [number, number] };
    }>;
  };

  let { risk = 0.5, accent = "#f5b942", onready }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let ready = $state(false);

  // Zones around the EPN campus. `incidents` are the published 2025 counts
  // of incidentes contra la convivencia ciudadana from the Observatorio
  // Metropolitano de Seguridad Ciudadana; `estimated: true` marks the ones
  // the DMQ hasn't broken out publicly, scaled from their neighbours so the
  // map still reads as a gradient rather than blank patches.
  const PEAK_INCIDENTS = 14842; // Centro Histórico 2025 — the local maximum
  const ZONES = [
    { name: "Centro Histórico", lng: -78.5125, lat: -0.2201, incidents: 14842, estimated: false },
    { name: "La Mariscal", lng: -78.4863, lat: -0.1985, incidents: 7444, estimated: false },
    { name: "Itchimbía", lng: -78.503, lat: -0.2168, incidents: 6200, estimated: true },
    { name: "La Floresta (EPN)", lng: -78.4886, lat: -0.2073, incidents: 4100, estimated: true },
    { name: "El Ejido / La Carolina", lng: -78.493, lat: -0.187, incidents: 3600, estimated: true },
    { name: "González Suárez", lng: -78.479, lat: -0.204, incidents: 2400, estimated: true },
  ];

  /** Zone's own incident load, normalised 0..1 against the local peak. */
  function baseFor(z: { incidents: number }) {
    return Math.min(1, z.incidents / PEAK_INCIDENTS);
  }

  // Weighted so the zone's own record dominates: a historically calm sector
  // stays cool even at 3am, and the hour only shifts it a band or so.
  function combinedRisk(base: number, riskFactor: number) {
    return Math.min(1, base * 0.62 + riskFactor * 0.38);
  }

  function riskColor(r: number) {
    if (r > 0.66) return "#ef4444";
    if (r > 0.4) return "#f5b942";
    return "#21e0a0";
  }

  function pointsGeoJSON(riskFactor: number): FeatureCollection {
    const features: FeatureCollection["features"] = [];
    for (const z of ZONES) {
      const c = combinedRisk(baseFor(z), riskFactor);
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
        const c = combinedRisk(baseFor(z), riskFactor);
        const count = z.incidents.toLocaleString("es-EC");
        return {
          type: "Feature",
          properties: {
            name: z.name,
            detail: z.estimated ? `~${count} inc. (est.)` : `${count} inc. · 2025`,
            color: riskColor(c),
          },
          geometry: { type: "Point", coordinates: [z.lng, z.lat] },
        };
      }),
    };
  }

  // Agrega sources y layers al warmMap la primera vez.
  // Si ya existen (remount), solo actualiza los datos.
  function setupSources() {
    if (!warmMap.getSource("risk-points")) {
      warmMap.addSource("risk-points", { type: "geojson", data: pointsGeoJSON(risk) });
      warmMap.addLayer({
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

      warmMap.addSource("zone-labels", { type: "geojson", data: labelsGeoJSON(risk) });
      warmMap.addLayer({
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
      warmMap.addLayer({
        id: "zone-text",
        type: "symbol",
        source: "zone-labels",
        layout: {
          // MapLibre's default stack is "Open Sans Regular, Arial Unicode
          // MS Regular", which this tile server doesn't host — the glyph
          // request 404s and the labels silently never draw. Its style
          // ships Noto Sans, so name it explicitly.
          "text-font": ["Noto Sans Regular"],
          "text-field": ["format", ["get", "name"], {}, "\n", {}, ["get", "detail"], { "font-scale": 0.8 }],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-line-height": 1.3,
        },
        paint: {
          "text-color": "#eef4fb",
          "text-halo-color": "#04060d",
          "text-halo-width": 1.4,
        },
      });
    } else {
      // Remount — solo sincroniza datos actuales
      (warmMap.getSource("risk-points") as maplibregl.GeoJSONSource).setData(pointsGeoJSON(risk));
      (warmMap.getSource("zone-labels") as maplibregl.GeoJSONSource).setData(labelsGeoJSON(risk));
    }

    // NavigationControl se agrega una sola vez (el mapa es singleton)
    if (!warmState.navControlAdded) {
      warmMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      warmState.navControlAdded = true;
    }

    ready = true;
    onready?.();
  }

  $effect(() => {
    if (!container) return;
    const el = container;

    // ── Adoptar el mapa pre-calentado ────────────────────────────────────
    // Movemos warmShell (que contiene el canvas WebGL) dentro de nuestro
    // contenedor. No creamos ningún Map nuevo — zero workers, zero GL init.
    warmShell.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    el.appendChild(warmShell);

    if (mapLoaded || mapWarm.mapLoaded) {
      // El mapa ya cargó durante el splash — sources se agregan de inmediato
      setupSources();
    } else {
      // Todavía cargando (conexión muy lenta) — esperamos el evento
      warmMap.once("load", setupSources);
    }

    const ro = new ResizeObserver(() => warmMap.resize());
    ro.observe(el);
    // Forzar resize tras adoptar: el container tiene dimensiones reales ahora
    requestAnimationFrame(() => warmMap.resize());

    return () => {
      ro.disconnect();
      // Devolver el shell al limbo off-screen: el mapa sigue vivo, los
      // workers no se destruyen, y en el próximo adopt será instantáneo.
      warmShell.style.cssText =
        "position:fixed;top:-99999px;left:0;" +
        "width:360px;height:280px;pointer-events:none;";
      document.body.appendChild(warmShell);
      ready = false;
    };
  });

  $effect(() => {
    const r = risk;
    if (!ready) return;
    (warmMap.getSource("risk-points") as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(r));
    (warmMap.getSource("zone-labels") as maplibregl.GeoJSONSource | undefined)?.setData(labelsGeoJSON(r));
  });
</script>

<div class="map-shell">
  <div class="map-el" bind:this={container}></div>
  <div class="map-badge" style="--accent: {accent}">
    <span class="dot"></span>
    Incidentes de convivencia 2025 · OMSC Quito — puntos aproximados por zona
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
