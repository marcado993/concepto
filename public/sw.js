// Service Worker — AEIS Map Cache
// Estrategia: Network First con fallback a caché para assets del mapa,
// y Cache First para el style JSON local (ya servido desde Vercel CDN).
// Esto hace que en internet lento los tiles ya visitados carguen al instante.

const CACHE_VERSION = "aeis-map-v1";

// Dominios externos del mapa que queremos cachear
const MAP_ORIGINS = [
  "https://tiles.openfreemap.org",
];

// Tamaño máximo de caché de tiles (evitar llenar el disco del usuario)
const MAX_TILE_ENTRIES = 300;

// ──────────────────────────────────────────────
// Install: precachea el style JSON local
// ──────────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(["/map-style.json"])
    )
  );
  self.skipWaiting();
});

// ──────────────────────────────────────────────
// Activate: limpia versiones anteriores
// ──────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ──────────────────────────────────────────────
// Fetch: lógica de caché por tipo de recurso
// ──────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Solo interceptamos GET
  if (e.request.method !== "GET") return;

  const isLocalStyle = url.pathname === "/map-style.json";
  const isMapAsset = MAP_ORIGINS.some((o) => e.request.url.startsWith(o));

  if (isLocalStyle) {
    // Cache First: el style JSON local ya es confiable (servido desde Vercel)
    e.respondWith(cacheFirst(e.request));
    return;
  }

  if (isMapAsset) {
    // Stale-While-Revalidate para tiles, glyphs, sprites:
    // responde inmediatamente desde caché si existe, y actualiza en background.
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }
});

// ──────────────────────────────────────────────
// Estrategias de caché
// ──────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await trimCache(cache, MAX_TILE_ENTRIES);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached); // Si falla la red, usa la caché

  // Si hay caché, responde ya; si no, espera la red
  return cached ?? networkFetch;
}

// Limita el número de entradas en caché para no llenar el almacenamiento
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length >= maxEntries) {
    // Borra las más antiguas (primeras en la lista)
    await cache.delete(keys[0]);
  }
}
