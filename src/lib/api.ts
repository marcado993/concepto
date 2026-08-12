// Cliente del backend NestJS — único lugar del frontend que sabe la URL
// base y cómo llamar al backend (DRY: cada módulo que necesite datos del
// servidor importa de aquí, no arma su propio fetch()).
//
// El módulo de seguridad (mapa + indicadores) es el primero en migrar:
// vivía hardcodeado en SecurityMap.svelte y data.ts — ver
// backend/src/security/ y docs/dominio/05-metodologia-devsecops-pipeline.md.

import type { SecurityIndicator, VenturePublic } from "./data";
import { authHeader } from "./auth.svelte";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJSON<T>(path: string, opts: { auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { headers: opts.auth ? authHeader() : undefined });
  } catch (err) {
    throw new ApiError(`No se pudo contactar al backend (${API_BASE_URL}${path}): ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new ApiError(`Backend respondió ${res.status} en ${path}`, res.status);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(`No se pudo contactar al backend (${API_BASE_URL}${path}): ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new ApiError(await friendlyErrorMessage(res, path), res.status);
  }
  return res.json() as Promise<T>;
}

// Sin JSON.stringify ni Content-Type manual: dejar que el propio browser
// arme el multipart/form-data con su boundary — ponerlo a mano es la forma
// más común de romper un upload de archivo silenciosamente.
async function postFormData<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { ...authHeader() },
      body: form,
    });
  } catch (err) {
    throw new ApiError(`No se pudo contactar al backend (${API_BASE_URL}${path}): ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new ApiError(await friendlyErrorMessage(res, path), res.status);
  }
  return res.json() as Promise<T>;
}

// El backend (NestJS) manda {message, error, statusCode} en sus errores —
// mostrar ese `message` es mucho más útil para el estudiante que "Backend
// respondió 400", sobre todo en el flujo de alquiler (ej. "El casillero ya
// no está disponible", "No pudimos confirmar el monto en el comprobante").
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

export function fetchSecurityIndicators(): Promise<SecurityIndicator[]> {
  return getJSON<SecurityIndicator[]>("/security/indicators");
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, string>;
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
}

export interface SecurityMapData {
  zones: Array<{ name: string; lng: number; lat: number; incidents: number; estimated: boolean }>;
  points: GeoJSONFeatureCollection;
  labels: GeoJSONFeatureCollection;
}

export function fetchSecurityMapData(risk: number): Promise<SecurityMapData> {
  return getJSON<SecurityMapData>(`/security/map-data?risk=${encodeURIComponent(risk)}`);
}

// Emprendimientos — directorio público (sin auth) + envío (requiere sesión).
export function fetchVentures(): Promise<VenturePublic[]> {
  return getJSON<VenturePublic[]>("/ventures");
}

export interface CreateVentureInput {
  name: string;
  description: string;
  category: string;
  whatsappNumber: string;
  photoUrl?: string;
}

export function createVenture(input: CreateVentureInput) {
  return postJSON("/ventures", input);
}

// Identidad del estudiante logueado — para mostrar en el formulario de
// alquiler en modo solo-lectura (ver backend/src/shared/auth/auth.controller.ts).
export interface MeResponse {
  fullName: string;
  uniqueCode: string;
  role: string;
}

export function fetchMe(): Promise<MeResponse> {
  return getJSON<MeResponse>("/auth/me", { auth: true });
}

// Directorio de casilleros — reemplaza los 9 casilleros MOCK que vivían
// hardcodeados en data.ts (makeLockers()) por los 108 reales sembrados en
// la base de datos (backend/prisma/seed.ts). Público — ver disponibilidad
// no requiere sesión, igual que security/ y ventures/.
export interface LockerFromApi {
  id: string;
  code: string;
  zone: string;
  status: "AVAILABLE" | "RESERVED" | "RENTED";
}

export function fetchLockers(): Promise<LockerFromApi[]> {
  return getJSON<LockerFromApi[]>("/lockers");
}

// Alquiler de casilleros — flujo de 3 pasos (identidad → método de pago →
// confirmación). Con TRANSFER el alquiler queda pendiente hasta que
// confirmReceipt() valide el comprobante por OCR.
export interface RentLockerInput {
  lockerCode: string;
  method: "TRANSFER" | "PAYPHONE";
}

export interface LockerRental {
  id: string;
  lockerId: string;
  userId: string;
  periodId: string;
  paymentId: string;
  createdAt: string;
}

export function rentLocker(input: RentLockerInput): Promise<LockerRental> {
  return postJSON<LockerRental>("/lockers/rent", input);
}

export function confirmLockerReceipt(rentalId: string, receipt: File) {
  const form = new FormData();
  form.append("receipt", receipt);
  return postFormData(`/lockers/rentals/${encodeURIComponent(rentalId)}/confirm-receipt`, form);
}

// PayPhone (Cajita de Pagos) — el widget corre en el navegador con estos
// valores (token/storeId), servidos por el backend en vez de vivir
// hardcodeados aquí, para poder rotarlos sin redeploy del frontend (ver
// backend/src/locker/locker.controller.ts). `configured:false` significa
// que PAYPHONE_TOKEN/PAYPHONE_STORE_ID no están puestos todavía en el
// backend — la UI debe deshabilitar esa opción de pago, no fingir que
// funciona.
export interface PayphonePublicConfig {
  configured: boolean;
  token: string;
  storeId: string;
}

export function fetchPayphoneConfig(): Promise<PayphonePublicConfig> {
  return getJSON<PayphonePublicConfig>("/lockers/payphone/config");
}

// Tras completar el pago en el widget, PayPhone redirige la página entera
// con ?id=&clientTransactionId= — App.svelte captura esos parámetros y
// llama aquí para que el backend verifique el pago contra la API real de
// PayPhone (nunca se confía en el solo hecho de que el navegador volvió
// con esos query params).
export function confirmPayphonePayment(id: number, clientTransactionId: string) {
  return postJSON("/lockers/payphone/confirm", { id, clientTransactionId });
}
