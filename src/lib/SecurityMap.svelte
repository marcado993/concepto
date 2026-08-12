<script lang="ts">
  // SecurityMap adopta el warmMap pre-inicializado en mapWarm.ts.
  // NO crea su propio Map — solo mueve warmShell al contenedor cuando
  // el mapa está listo (puede ser inmediato o asíncrono si el usuario
  // navega muy rápido antes de que el mapa haya terminado de crear).
  import * as maplibregl from "maplibre-gl";
  import { warmMap, warmShell, mapLoaded, onWarmReady, state as warmState } from "./mapWarm";
  import { fetchSecurityMapData, type GeoJSONFeatureCollection } from "./api";

  interface Props {
    risk?: number; // 0..1, current hour's illustrative risk level
    accent?: string;
    onready?: () => void;
  }

  let { risk = 0.5, accent = "#f5b942", onready }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let ready = $state(false);

  // Las 6 zonas, el conteo de incidentes y las fórmulas de riesgo YA NO
  // viven aquí — se pidieron al backend (backend/src/security/map-data.ts)
  // tras auditar que este componente las computaba en el cliente en cada
  // render. Ver docs/dominio/05-metodologia-devsecops-pipeline.md §7 y
  // App.svelte para el mismo cambio en los indicadores.
  const EMPTY_FC: GeoJSONFeatureCollection = { type: "FeatureCollection", features: [] };

  /** Pide al backend el heatmap+etiquetas para el `riskFactor` dado y actualiza
   *  las fuentes del mapa si ya existen. No lanza — si el backend no responde,
   *  el mapa se queda con los últimos datos que sí llegaron (o vacío). */
  async function syncMapData(m: maplibregl.Map, riskFactor: number) {
    try {
      const { points, labels } = await fetchSecurityMapData(riskFactor);
      (m.getSource("risk-points") as maplibregl.GeoJSONSource | undefined)?.setData(points);
      (m.getSource("zone-labels") as maplibregl.GeoJSONSource | undefined)?.setData(labels);
    } catch (err) {
      console.warn("SecurityMap: no se pudo cargar el mapa de seguridad del backend", err);
    }
  }

  /** Agrega sources/layers si es la primera vez (vacías — se llenan en
   *  syncMapData), o no hace nada si ya existen (solo syncMapData las toca). */
  function setupSources(m: maplibregl.Map) {
    if (!m.getSource("risk-points")) {
      m.addSource("risk-points", { type: "geojson", data: EMPTY_FC });
      m.addLayer({
        id: "risk-heat",
        type: "heatmap",
        source: "risk-points",
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 2.4],
          "heatmap-radius":    ["interpolate", ["linear"], ["zoom"], 11, 16, 16, 42],
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0,    "rgba(33,224,160,0)",
            0.25, "rgba(130,214,110,0.55)",
            0.5,  "rgba(214,193,60,0.7)",
            0.7,  "rgba(245,185,66,0.8)",
            0.85, "rgba(230,110,50,0.85)",
            1,    "rgba(239,68,68,0.9)",
          ],
        },
      });
      m.addSource("zone-labels", { type: "geojson", data: EMPTY_FC });
      m.addLayer({
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
      m.addLayer({
        id: "zone-text",
        type: "symbol",
        source: "zone-labels",
        layout: {
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
    }
    if (!warmState.navControlAdded) {
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      warmState.navControlAdded = true;
    }

    // NO llamar syncMapData() aquí — poner `ready = true` ya dispara el
    // $effect de abajo (lee `ready`), que llama a syncMapData() una vez.
    // Antes se llamaba desde los dos lados: cada montaje pedía el heatmap
    // al backend DOS veces y reconstruía la capa WebGL dos veces seguidas
    // (hallazgo de auditoría de rendimiento — un `setData()` de heatmap no
    // es gratis, son ~500 puntos re-tesselados en GPU cada vez).
    ready = true;
    onready?.();
  }

  $effect(() => {
    if (!container) return;
    const el = container;

    // Cuando el mapa esté disponible, mueve warmShell al contenedor y adopta.
    // Si el mapa ya existe (caso normal), la adopción es inmediata.
    // Si el usuario llegó aquí antes de los 2 rAF de mapWarm, esperamos.
    function adopt() {
      const m = warmMap!;

      // Mover el shell (que contiene el canvas WebGL) al contenedor real.
      // Esto es lo único que hacemos — no new Map(), no workers.
      warmShell.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
      el.appendChild(warmShell);

      // Resize guardado: solo si el contenedor tiene dimensiones reales.
      // Evita el bug de canvas 1×1px cuando el contenedor está colapsado.
      const safeResize = () => {
        if (el.offsetWidth > 10 && el.offsetHeight > 10) {
          m.resize();
        }
      };

      requestAnimationFrame(safeResize);

      const ro = new ResizeObserver(() => safeResize());
      ro.observe(el);

      if (mapLoaded) {
        setupSources(m);
      } else {
        m.once("load", () => {
          if (container === el) setupSources(m); // aún montado
        });
      }

      return ro;
    }

    let ro: ResizeObserver | null = null;

    if (warmMap) {
      ro = adopt();
    } else {
      // Mapa aún no creado (usuario muy rápido, < 2 frames del splash)
      onWarmReady(() => {
        if (container === el) ro = adopt();
      });
    }

    return () => {
      ro?.disconnect();
      // Devolver el shell al limbo off-screen — el mapa sigue vivo y cálido.
      warmShell.style.cssText =
        "position:fixed;top:-99999px;left:0;" +
        "width:360px;height:280px;pointer-events:none;";
      document.body.appendChild(warmShell);
      ready = false;
    };
  });

  $effect(() => {
    const r = risk;
    if (!ready || !warmMap) return;
    void syncMapData(warmMap, r);
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
