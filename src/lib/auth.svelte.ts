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

/** connector opcional (ej. "github") — ver Login.svelte, que es quien
 *  realmente decide el conector según qué botón tocó el estudiante. Sin
 *  connector, el backend deja que Logto muestre su propio selector.
 *
 *  loginHint opcional — el correo que el estudiante ya escribió en
 *  NUESTRO formulario, para no hacer que lo vuelva a escribir
 *  en la pantalla de Logto. Precarga el campo, no salta el paso (el
 *  código de verificación lo sigue mostrando/pidiendo Logto — no hay
 *  forma de recibir/validar ese código sin su propia pantalla). */
export function login(connector?: string, loginHint?: string) {
  const params = new URLSearchParams();
  if (connector) params.set("connector", connector);
  if (loginHint) params.set("email", loginHint);
  const qs = params.toString();
  window.location.href = `${API_BASE_URL}/auth/login${qs ? `?${qs}` : ""}`;
}

// Login por correo — a diferencia de login("github") (que
// navega el navegador entero hacia afuera), este flujo se queda en
// Login.svelte de principio a fin: el backend habla con la Experience API
// de Logto por dentro (ver backend/src/shared/auth/logto-experience.client.ts)
// y solo nos devuelve JSON. `credentials: "include"` es obligatorio en las
// dos llamadas — el estado de la interacción vive en una cookie httpOnly
// que pone /auth/email/start y que /auth/email/verify necesita releer.
export class EmailLoginError extends Error {}

export async function startEmailLogin(email: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/email/start`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new EmailLoginError(body.message ?? "No se pudo enviar el código — intenta de nuevo");
  }
}

export interface EmailVerifyResult {
  /** true si Logto pidió reiniciar como registro (primera vez con este
   *  correo) y mandó un código nuevo — Login.svelte debe pedir el nuevo
   *  código sin volver a mostrar el paso de "escribe tu correo". */
  needsNewCode: boolean;
}

export async function verifyEmailLogin(code: string): Promise<EmailVerifyResult> {
  const res = await fetch(`${API_BASE_URL}/auth/email/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 202 && body.needsNewCode) {
    return { needsNewCode: true };
  }
  if (!res.ok) {
    throw new EmailLoginError(body.message ?? body.error ?? "Código incorrecto o vencido — intenta de nuevo");
  }
  if (!body.accessToken) {
    throw new EmailLoginError("Logto no devolvió una sesión válida — intenta de nuevo");
  }

  token = body.accessToken;
  sessionStorage.setItem(STORAGE_KEY, body.accessToken);
  return { needsNewCode: false };
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
