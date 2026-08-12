// Sesión del estudiante — un solo lugar que sabe leer/guardar el token
// (DRY: cualquier componente que necesite saber "¿hay sesión?" importa de
// aquí, ninguno relee sessionStorage por su cuenta).
//
// El backend redirige a `${FRONTEND_ORIGIN}/#access_token=...` tras el
// login (backend/src/shared/auth/auth.controller.ts) — sessionStorage, no
// localStorage: el token de Logto es de corta vida por diseño, y no hay
// razón para que sobreviva a cerrar la pestaña.

const STORAGE_KEY = "aeis_access_token";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

let token = $state<string | null>(readStoredToken());

function readStoredToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

/** Revisa `location.hash` en cada carga — si el backend acaba de redirigir
 *  tras un login exitoso, ahí viene el `access_token`. Se llama una vez al
 *  montar App.svelte. */
export function consumeAuthCallback() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  if (!hash.includes("access_token=")) return;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get("access_token");
  if (accessToken) {
    token = accessToken;
    sessionStorage.setItem(STORAGE_KEY, accessToken);
  }
  // Limpia el fragmento de la URL — el token ya no debe quedar visible en
  // la barra de direcciones ni en el historial del navegador.
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function isAuthenticated(): boolean {
  return token !== null;
}

export function getAccessToken(): string | null {
  return token;
}

export function login() {
  window.location.href = `${API_BASE_URL}/auth/login`;
}

export function logout() {
  token = null;
  sessionStorage.removeItem(STORAGE_KEY);
  window.location.href = `${API_BASE_URL}/auth/logout`;
}

/** Cabecera Authorization lista para fetch() — {} si no hay sesión, para
 *  poder hacer siempre `headers: { ...authHeader() }` sin condicionales. */
export function authHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
