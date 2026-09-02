// Cliente del backend para el panel de administración — separado a
// propósito de ../api.ts (esa es la sesión de estudiante/Logto). Todo acá
// usa adminAuthHeader() (ver adminAuth.svelte.ts), nunca authHeader().
import { adminAuthHeader } from "./adminAuth.svelte";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function networkErrorMessage(): string {
  return "No se pudo conectar con el servidor — revisa tu conexión a internet e intenta de nuevo.";
}

async function friendlyErrorMessage(res: Response, path: string): Promise<string> {
  try {
    const body = await res.clone().json();
    if (typeof body?.message === "string") return body.message;
    if (Array.isArray(body?.message)) return body.message.join(", ");
  } catch {
    // el body no era JSON — cae al mensaje genérico de abajo
  }
  return `Backend respondió ${res.status} en ${path}`;
}

async function getJSON<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { headers: adminAuthHeader() });
  } catch {
    throw new AdminApiError(networkErrorMessage());
  }
  if (!res.ok) throw new AdminApiError(await friendlyErrorMessage(res, path), res.status);
  return res.json() as Promise<T>;
}

async function patchJSON<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(networkErrorMessage());
  }
  if (!res.ok) throw new AdminApiError(await friendlyErrorMessage(res, path), res.status);
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(networkErrorMessage());
  }
  if (!res.ok) throw new AdminApiError(await friendlyErrorMessage(res, path), res.status);
  return res.json() as Promise<T>;
}

export interface AdminMe {
  email: string;
  role: string;
}

export function fetchAdminMe(): Promise<AdminMe> {
  return getJSON<AdminMe>("/admin/auth/me");
}

export interface AdminOverviewTier {
  id: string;
  name: string;
  amount: number;
  subscriberCount: number;
  revenueConfirmed: number;
}

export interface AdminOverview {
  periodLabel: string;
  lockers: {
    total: number;
    rented: number;
    reserved: number;
    available: number;
    basePrice: number;
    revenueConfirmed: number;
  };
  subscriptions: {
    tiers: AdminOverviewTier[];
    revenueConfirmed: number;
  };
  totalRevenueConfirmed: number;
}

export function fetchAdminOverview(): Promise<AdminOverview> {
  return getJSON<AdminOverview>("/admin/overview");
}

export interface AdminUser {
  id: string;
  fullName: string;
  email: string | null;
  uniqueCode: string;
  role: string;
  cedula: string | null;
  phone: string | null;
  createdAt: string;
}

export interface AdminUsersPage {
  total: number;
  page: number;
  pageSize: number;
  users: AdminUser[];
}

export function fetchAdminUsers(page: number, search?: string): Promise<AdminUsersPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  return getJSON<AdminUsersPage>(`/admin/users?${params.toString()}`);
}

export interface AdminSubscriptionTier {
  id: string;
  name: string;
  amount: string;
  benefits: unknown;
}

export function fetchAdminSubscriptionTiers(): Promise<{ periodLabel: string; tiers: AdminSubscriptionTier[] }> {
  return getJSON("/admin/subscription-tiers");
}

export function updateAdminSubscriptionTier(
  id: string,
  input: { amount?: number; benefits?: unknown[] }
): Promise<AdminSubscriptionTier> {
  return patchJSON(`/admin/subscription-tiers/${id}`, input);
}

export function fetchAdminLockerPricing(): Promise<{ periodLabel: string; basePrice: number }> {
  return getJSON("/admin/locker-pricing");
}

export function updateAdminLockerPricing(basePrice: number): Promise<{ periodLabel: string; basePrice: number }> {
  return patchJSON("/admin/locker-pricing", { basePrice });
}

export interface AdminAuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AdminAuditLogsPage {
  total: number;
  page: number;
  pageSize: number;
  logs: AdminAuditLogEntry[];
}

export function fetchAdminAuditLogs(page: number, action?: string): Promise<AdminAuditLogsPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (action) params.set("action", action);
  return getJSON<AdminAuditLogsPage>(`/admin/audit-logs?${params.toString()}`);
}

// Rueda (ArcMenu, "A") vs. lista accesible (AccessibleCategoryNav, "B") —
// ver ../abTest.ts. Feature flag real, editable acá en vez de hardcodeado
// en el frontend público (antes cualquier cambio necesitaba un redeploy).
export type UiVariant = "A" | "B";

export function fetchAdminUiVariant(): Promise<{ variant: UiVariant }> {
  return getJSON("/admin/ui-variant");
}

export function updateAdminUiVariant(variant: UiVariant): Promise<{ variant: UiVariant }> {
  return patchJSON("/admin/ui-variant", { variant });
}

// Zona de riesgo — reemplaza los scripts .ps1 manuales que antes había que
// pedir por chat cada vez (wipe-all-to-zero.ps1 / free-stuck-lockers.ps1).
// Mismo alcance exacto que esos scripts, ver backend/src/admin/danger-zone.service.ts.
export interface DangerZonePreview {
  aeisApp: {
    users: number;
    payments: number;
    lockerRentals: number;
    subscriptions: number;
    ventures: number;
    studentAuditLogs: number;
    lockersNotAvailable: number;
  };
  logtoDefaultTenantUsers: number | null;
  logtoError: string | null;
}

export function fetchDangerZonePreview(): Promise<DangerZonePreview> {
  return getJSON<DangerZonePreview>("/admin/danger-zone/preview");
}

export interface WipeTestDataResult {
  wiped: DangerZonePreview["aeisApp"];
  logtoDeleted: number | null;
  logtoError: string | null;
}

// El body EXACTO "BORRAR DATOS DE PRUEBA" / "LIBERAR CASILLEROS" lo valida
// otra vez el backend (ConfirmWipeTestDataDto/ConfirmFreeLockersDto) — acá
// solo se manda lo que el admin escribió, la UI ya lo hace escribir la
// frase completa antes de habilitar el botón (ver AdminDangerZone.svelte).
export function wipeTestData(confirm: string): Promise<WipeTestDataResult> {
  return postJSON("/admin/danger-zone/wipe-test-data", { confirm });
}

export function freeLockers(confirm: string): Promise<{ freed: number }> {
  return postJSON("/admin/danger-zone/free-lockers", { confirm });
}

// Bolsa de empleo — refresco a demanda.
//
// El cron del backend corre cada 3 horas (JobIngestService), que para
// postular a una pasantia es tiempo real de sobra. Este boton existe para
// los casos en que esperar no sirve: acabas de publicar el modulo, o
// cambiaste un peso del motor y quieres ver el efecto ya.
export interface JobIngestReport {
  fetched: number;
  afterDedupe: number;
  relevant: number;
  created: number;
  updated: number;
  archived: number;
  /** Bolsas que fallaron en esta corrida. Vacio = todas respondieron. */
  failedSources: string[];
}

export function ingestJobs(): Promise<JobIngestReport> {
  // POST sin cuerpo: a diferencia de la zona de riesgo, esto no borra nada
  // — solo refresca una cache de datos externos, asi que no pide frase de
  // confirmacion. Lo protege el mismo guard de admin que todo /admin/*.
  return postJSON<JobIngestReport>("/admin/jobs/ingest", {});
}

export interface AdminJobsSnapshot {
  total: number;
  facets: { internships: number; remote: number; ecuador: number };
  jobs: {
    id: string;
    title: string;
    company: string;
    kind: string;
    workMode: string;
    source: string;
    relevance: number;
    postedAt: string | null;
    url: string;
  }[];
}

// Reusa el endpoint PUBLICO /jobs a proposito — es exactamente lo que ve el
// estudiante. Un endpoint de admin aparte podria divergir del real y
// mostrar en el panel algo que en la app no aparece.
export function fetchAdminJobsSnapshot(): Promise<AdminJobsSnapshot> {
  return getJSON<AdminJobsSnapshot>("/jobs?limit=12&sort=relevance");
}
