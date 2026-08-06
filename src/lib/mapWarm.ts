// mapWarm.ts — Map Singleton / Pre-warmer
//
// Este módulo se importa en main.ts ANTES de montar Svelte, de modo que
// se ejecuta durante el splash screen. Crea la instancia de MapLibre en
// un div off-screen invisible para que:
//   1. Los workers de WebGL arranquen inmediatamente (no al primer tap)
//   2. El style JSON se solicite mientras el JS bundle aún se ejecuta
//   3. Las tiles del viewport inicial empiecen a cachearse en la SW
//
// SecurityMap.svelte adopta este mapa: mueve `warmShell` a su propio
// contenedor en vez de crear una instancia nueva. El mapa NUNCA se
// destruye — workers, contexto GL y caché de tiles persisten toda la
// sesión.

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// setWorkerUrl debe llamarse antes del primer `new Map()`.
// Al estar en este módulo importado por main.ts, se garantiza que
// ocurre antes de que SecurityMap.svelte exista en el DOM.
maplibregl.setWorkerUrl(mapWorkerUrl);

// Shell off-screen: el mapa vive aquí hasta que SecurityMap lo adopta.
// Usamos top:-99999px (no display:none) para que WebGL pueda renderizar.
export const warmShell = document.createElement("div");
warmShell.style.cssText =
  "position:fixed;top:-99999px;left:0;" +
  "width:360px;height:280px;pointer-events:none;";
document.body.appendChild(warmShell);

// Crear la instancia ahora — workers arrancan, style JSON se solicita,
// tiles del viewport inicial empiezan a bajar (y la SW las cachea).
export const warmMap = new maplibregl.Map({
  container: warmShell,
  style: "/map-style.json",
  center: [-78.4886, -0.208],
  zoom: 14,
  pitch: 45,
  bearing: -12,
  attributionControl: false,
});

// Flag que SecurityMap consulta para saber si puede agregar sources/layers
// o si tiene que esperar el evento 'load'.
export let mapLoaded = false;
warmMap.once("load", () => {
  mapLoaded = true;
});

// Objeto mutable para flags que SecurityMap necesita modificar.
// Los exports de ES modules son inmutables, pero sus propiedades no.
export const state = {
  navControlAdded: false,
};
