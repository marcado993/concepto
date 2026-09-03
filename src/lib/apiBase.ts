/**
 * De dónde cuelga el backend.
 *
 * Existe por una rotura REAL de producción: el panel de administración se
 * construye a mano (`npm run build:admin` + scp, no pasa por Vercel), y si
 * quien lo construye no tiene `VITE_API_BASE_URL` definida, Vite deja el
 * valor por defecto — que era `http://localhost:3000` — HORNEADO en el
 * bundle. El panel quedaba publicado en panel.aeis-app.online pidiéndole el
 * login a la máquina del visitante:
 *
 *   POST http://localhost:3000/admin/auth/login   net::ERR_FAILED
 *   Access to fetch ... has been blocked by CORS policy
 *
 * Y el mensaje que veía la directiva era "No se pudo conectar con el
 * servidor — revisa tu conexión", que apunta al lugar equivocado: la
 * conexión estaba perfecta, el bundle estaba mal.
 *
 * La variable de entorno sigue mandando cuando existe. Lo que se agrega es
 * que, si NO existe y la página no se está sirviendo desde localhost, se
 * deduce el backend en vez de asumir que hay uno en la máquina de quien
 * mira. Un build de producción mal parametrizado deja de ser una página
 * rota y pasa a funcionar igual.
 */
const API_PRODUCCION = "https://api.aeis-app.online";

/** Hostnames que de verdad significan "estoy desarrollando en mi máquina". */
function esLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function resolveApiBaseUrl(): string {
  const desdeEntorno = import.meta.env.VITE_API_BASE_URL;
  if (desdeEntorno) return desdeEntorno;

  // `typeof window` y no un `if (window)` a secas: este módulo también se
  // importa desde los tests, que corren sin DOM.
  if (typeof window === "undefined") return "http://localhost:3000";

  const { hostname, protocol } = window.location;
  if (esLocal(hostname)) return "http://localhost:3000";

  // El panel NO vive en el internet público: se sirve dentro de la red
  // Tailscale. Por eso la API se DERIVA de su propio hostname
  // (panel.dominio → api.dominio) en vez de escribir un dominio fijo:
  // así se resuelve por la misma ruta de red que sirvió la página. Con una
  // constante, un panel servido por la VPN habría intentado salir a un
  // dominio que quizá ni resuelve igual desde ahí.
  if (hostname.startsWith("panel.")) {
    return `${protocol}//api.${hostname.slice("panel.".length)}`;
  }

  return API_PRODUCCION;
}
