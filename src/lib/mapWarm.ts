// mapWarm.ts — Map Singleton / Pre-warmer
//
// IMPORTANTE: la creación de `new maplibregl.Map()` se difiere con doble
// requestAnimationFrame para NO bloquear el hilo principal durante la
// evaluación del módulo. El splash puede animar y Svelte puede montar
// antes de que el mapa empiece a inicializarse.
//
// El mapa vive en `warmShell` (off-screen) mientras SecurityMap no lo
// adopte. La adopción consiste en mover ese div al contenedor del
// componente — cero workers nuevos, cero GL init, solo DOM.

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(mapWorkerUrl);

// Shell off-screen creado de forma síncrona (barato) para que esté
// disponible inmediatamente cuando SecurityMap quiera adoptarlo.
export const warmShell = document.createElement("div");
warmShell.style.cssText =
  "position:fixed;top:-99999px;left:0;" +
  "width:360px;height:280px;pointer-events:none;";
document.body.appendChild(warmShell);

// El map se crea de forma diferida (ver más abajo).
export let warmMap: maplibregl.Map | null = null;
export let mapLoaded = false;

// Objeto mutable para flags compartidos (exports ES son inmutables).
export const state = { navControlAdded: false };

// Cola de callbacks que esperan a que el mapa esté listo.
const _pending: Array<() => void> = [];

/** Ejecuta `cb` cuando warmMap existe Y ha disparado su evento 'load'. */
export function onWarmReady(cb: () => void): void {
  if (warmMap && mapLoaded) {
    cb();
    return;
  }
  _pending.push(cb);
}

// pitch:45 (vista 3D inclinada) es mucho más caro de dibujar que una
// vista plana — a ese ángulo la GPU tiene que rasterizar bastantes más
// tiles de los que caben en pantalla (todo lo que queda "detrás" del
// horizonte inclinado) y con proyección en perspectiva, no ortogonal.
// En un celular de gama baja eso es justo lo que se siente como lag al
// entrar a Seguridad. En desktop el efecto 3D se mantiene: es una GPU con
// mucho más margen y la pantalla es una fracción del hardware disponible
// en el dispositivo. `matchMedia` en vez de `innerWidth` a propósito —
// se evalúa UNA vez acá al crear el mapa (no reactivo), así que no hace
// falta un listener de resize por algo que nunca va a cambiar después de
// esta carga de página.
export const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

// Doble rAF: el primero espera a que el browser pinte el primer frame
// (splash visible), el segundo cede el hilo para que Svelte monte.
// Solo después creamos el Map, que es la operación costosa.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    warmMap = new maplibregl.Map({
      container: warmShell,
      style: "/map-style.json",
      center: [-78.4886, -0.208],
      zoom: 14,
      // Sin capar esto, MapLibre renderiza al devicePixelRatio real del
      // teléfono (2.5-3.5 típico en Android de gama baja), lo que
      // multiplica por ~6-12x el trabajo de fill-rate de CADA capa del
      // estilo (heatmap incluido) frente a un DPR de 1 — hallazgo de
      // auditoría de rendimiento móvil, el mayor lever de rendimiento
      // que quedaba en el mapa. 1.5 en mobile sigue viéndose nítido en
      // pantallas pequeñas; 2 en desktop es el tope habitual.
      pixelRatio: Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, isMobile ? 1.5 : 2),
      pitch: isMobile ? 0 : 45,
      bearing: isMobile ? 0 : -12,
      // Los gestos de inclinar/rotar con dos dedos casi nunca son
      // intencionales en un mapa chico dentro de una app (suelen ser un
      // pellizco/scroll que se malinterpreta) — además de bajar el costo
      // de repintado, evita que un gesto accidental deje el mapa
      // inclinado/rotado sin que el estudiante entienda por qué.
      dragRotate: !isMobile,
      touchPitch: !isMobile,
      attributionControl: false,
    });

    warmMap.once("load", () => {
      mapLoaded = true;
      // Notifica a SecurityMap si ya estaba esperando
      _pending.splice(0).forEach((cb) => cb());
    });
  })
);
