// Sesión del panel de administración — COMPLETAMENTE aparte de
// ../auth.svelte.ts (esa es la del estudiante, vía Logto). Login propio de
// correo+contraseña (ver backend/src/admin/admin-auth/), su propio token,
// su propia clave de localStorage. Pedido explícito: que el mismo correo
// real de un directivo no termine controlando la sesión de administrador Y
// la de estudiante con el mismo login/token.

const STORAGE_KEY = "aeis_admin_token";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

let token = $state<string | null>(readStoredToken());

function readStoredToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function isAdminAuthenticated(): boolean {
  return token !== null;
}

export class AdminLoginError extends Error {}

export async function adminLogin(email: string, password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new AdminLoginError("No se pudo conectar con el servidor — revisa tu conexión.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AdminLoginError(body.message ?? "Correo o contraseña incorrectos");
  }
  if (!body.accessToken) {
    throw new AdminLoginError("El servidor no devolvió una sesión válida — intenta de nuevo");
  }
  token = body.accessToken;
  localStorage.setItem(STORAGE_KEY, body.accessToken);
}

export function adminLogout(): void {
  token = null;
  localStorage.removeItem(STORAGE_KEY);
}

/** Cabecera Authorization lista para fetch() — {} si no hay sesión. */
export function adminAuthHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
