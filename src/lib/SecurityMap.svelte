<script lang="ts">
  import * as maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import { MapboxOverlay } from "@deck.gl/mapbox";
  import { HexagonLayer } from "@deck.gl/aggregation-layers";

  interface Props {
    risk?: number; // 0..1, current hour's illustrative risk level
    accent?: string;
  }

  let { risk = 0.5, accent = "#f5b942" }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let map: maplibregl.Map | null = null;
  let overlay: MapboxOverlay | null = null;

  // A handful of real Quito zone centers with an illustrative base weight —
  // NOT sourced incident locations. Point density scales with the current
  // hour's risk factor so the map visibly "heats up" the same way the card
  // above it does.
  // Centered on the EPN campus (La Floresta) instead of the whole city —
  // AEIS students care about the blocks around school, not Quito at large.
  const ZONES: [number, number, number][] = [
    [-78.4886, -0.2073, 0.5], // La Floresta / campus EPN
    [-78.5030, -0.2168, 0.65], // Itchimbía
    [-78.5125, -0.2201, 0.8], // Centro Histórico
    [-78.4863, -0.1985, 0.55], // La Mariscal
    [-78.479, -0.204, 0.35], // González Suárez / Guápulo
    [-78.493, -0.187, 0.4], // El Ejido / La Carolina
  ];

  function samplePoints(riskFactor: number) {
    const pts: { position: [number, number] }[] = [];
    for (const [lng, lat, base] of ZONES) {
      const count = Math.round(20 + base * riskFactor * 80);
      for (let i = 0; i < count; i++) {
        pts.push({
          position: [lng + (Math.random() - 0.5) * 0.006, lat + (Math.random() - 0.5) * 0.006],
        });
      }
    }
    return pts;
  }

  function buildLayer(riskFactor: number) {
    return new HexagonLayer({
      id: "risk-hex",
      data: samplePoints(riskFactor),
      getPosition: (d: { position: [number, number] }) => d.position,
      radius: 160,
      elevationScale: riskFactor * 160 + 20,
      extruded: true,
      pickable: false,
      colorRange: [
        [33, 224, 160],
        [130, 214, 110],
        [214, 193, 60],
        [245, 185, 66],
        [230, 110, 50],
        [239, 68, 68],
      ],
      opacity: 0.75,
    });
  }

  $effect(() => {
    if (!container || map) return;
    const el = container;
    map = new maplibregl.Map({
      container: el,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [-78.4886, -0.208],
      zoom: 14.2,
      pitch: 52,
      bearing: -14,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    // Overlaid (not interleaved) mode: deck.gl draws to its own canvas on
    // top of the base map instead of splicing into MapLibre's own layer
    // stack. Interleaving needs a correctly ordered beforeId per layer or
    // it silently renders nothing; overlaid mode has no such requirement,
    // and a flat hexagon heatmap has no need to sit "inside" the terrain.
    overlay = new MapboxOverlay({ layers: [buildLayer(risk)] });
    map.addControl(overlay as unknown as maplibregl.IControl);

    // The sheet this map lives in slides/fades into view, so the container
    // can be zero-sized (or mid-transition) the instant MapLibre reads its
    // dimensions — it then paints a blank canvas forever unless told to
    // remeasure. A ResizeObserver catches every subsequent layout change,
    // not just the first one.
    const ro = new ResizeObserver(() => map?.resize());
    ro.observe(el);
    requestAnimationFrame(() => map?.resize());

    return () => {
      ro.disconnect();
      map?.remove();
      map = null;
      overlay = null;
    };
  });

  $effect(() => {
    const r = risk;
    if (overlay) overlay.setProps({ layers: [buildLayer(r)] });
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
