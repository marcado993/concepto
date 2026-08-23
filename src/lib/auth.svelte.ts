// Sesión del estudiante — un solo lugar que sabe leer/guardar el token
// (DRY: cualquier componente que necesite saber "¿hay sesión?" importa de
// aquí, ninguno relee localStorage por su cuenta).
//
// El backend redirige a `${FRONTEND_ORIGIN}/#access_token=...` tras el
// login (backend/src/shared/auth/auth.controller.ts) — localStorage, no
// sessionStorage: pedido real (menos correos de código de un solo uso
// disparados por re-logins frecuentes, con ~1700 estudiantes en juego) —
// la sesión debe sobrevivir cerrar la pestaña/app, no solo la duración de
// una visita. El TTL real del token lo fija Logto del lado del servidor
// (Console → tu Application → Token expiration), no este archivo — acá
// solo se decide DÓNDE se guarda mientras esté vivo.

const STORAGE_KEY = "aeis_access_token";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

let token = $state<string | null>(readStoredToken());

function readStoredToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, accessToken);
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

/** "Continuar con GitHub"/"Continuar con Google" de Login.svelte — a
 *  diferencia del correo (que se queda en esta pantalla de principio a
 *  fin), acá el navegador SÍ sale hacia GitHub/Google: inherente a
 *  cualquier OAuth social, no algo que se pueda evitar. Lo que sí se evita
 *  es la pantalla hospedada de Logto en el camino — /auth/social/start
 *  habla con la Experience API de Logto server-side y redirige derecho al
 *  proveedor real (ver backend/src/shared/auth/auth.controller.ts). */
export function loginSocial(connector: "github" | "google") {
  window.location.href = `${API_BASE_URL}/auth/social/start?connector=${connector}`;
}

// Login por correo — a diferencia de login("github") (que
// navega el navegador entero hacia afuera), este flujo se queda en
// Login.svelte de principio a fin: el backend habla con la Experience API
// de Logto por dentro (ver backend/src/shared/auth/logto-experience.client.ts)
// y solo nos devuelve JSON. `credentials: "include"` es obligatorio en las
// dos llamadas — el estado de la interacción vive en una cookie httpOnly
// que pone /auth/email/start y que /auth/email/verify necesita releer.
export class EmailLoginError extends Error {}

// El estado del login por correo entre pasos (código PKCE, cookie interna
// de la Experience API de Logto, verificationId) viaja explícito en el
// cuerpo JSON, NO en una cookie — aeis.app y api.aeis-app.online son
// dominios distintos, y aunque la cookie ya iba con SameSite=None+Secure,
// seguía sin llegar en producción real: varios navegadores (Safari con
// ITP, Chrome apagando cookies de terceros) bloquean cookies entre sitios
// distintos sin importar SameSite. Mismo patrón que el access_token final
// (que tampoco es una cookie). Se guarda en memoria del módulo — no en
// localStorage — porque no necesita sobrevivir un refresco de página; si
// el usuario recarga a medio código, pedir uno nuevo es aceptable.
let pendingEmailToken: string | null = null;

export async function startEmailLogin(email: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/email/start`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new EmailLoginError(body.message ?? "No se pudo enviar el código — intenta de nuevo");
  }
  pendingEmailToken = body.pendingToken ?? null;
}

export interface EmailVerifyResult {
  /** true si Logto pidió reiniciar como registro (primera vez con este
   *  correo) y mandó un código nuevo — Login.svelte debe pedir el nuevo
   *  código sin volver a mostrar el paso de "escribe tu correo". */
  needsNewCode: boolean;
}

export async function verifyEmailLogin(code: string): Promise<EmailVerifyResult> {
  if (!pendingEmailToken) {
    throw new EmailLoginError("Sesión de verificación expirada o inválida — solicita un nuevo código");
  }
  const res = await fetch(`${API_BASE_URL}/auth/email/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, pendingToken: pendingEmailToken }),
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 202 && body.needsNewCode) {
    // El backend reinició la interacción como registro (primera vez con
    // este correo) y mandó un código nuevo — el pendingToken viejo ya no
    // sirve, hay que reemplazarlo por el que vino en esta respuesta.
    pendingEmailToken = body.pendingToken ?? null;
    return { needsNewCode: true };
  }
  if (!res.ok) {
    throw new EmailLoginError(body.message ?? body.error ?? "Código incorrecto o vencido — intenta de nuevo");
  }
  if (!body.accessToken) {
    throw new EmailLoginError("Logto no devolvió una sesión válida — intenta de nuevo");
  }

  pendingEmailToken = null;
  token = body.accessToken;
  localStorage.setItem(STORAGE_KEY, body.accessToken);
  return { needsNewCode: false };
}

export function logout() {
  token = null;
  localStorage.removeItem(STORAGE_KEY);
  window.location.href = `${API_BASE_URL}/auth/logout`;
}

/** Cabecera Authorization lista para fetch() — {} si no hay sesión, para
 *  poder hacer siempre `headers: { ...authHeader() }` sin condicionales. */
export function authHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
