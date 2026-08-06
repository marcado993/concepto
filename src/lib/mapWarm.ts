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
      pitch: 45,
      bearing: -12,
      attributionControl: false,
    });

    warmMap.once("load", () => {
      mapLoaded = true;
      // Notifica a SecurityMap si ya estaba esperando
      _pending.splice(0).forEach((cb) => cb());
    });
  })
);
