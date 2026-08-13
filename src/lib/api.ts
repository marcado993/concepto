// Cliente del backend NestJS — único lugar del frontend que sabe la URL
// base y cómo llamar al backend (DRY: cada módulo que necesite datos del
// servidor importa de aquí, no arma su propio fetch()).
//
// El módulo de seguridad (mapa + indicadores) es el primero en migrar:
// vivía hardcodeado en SecurityMap.svelte y data.ts — ver
// backend/src/security/ y docs/dominio/05-metodologia-devsecops-pipeline.md.

import type { SecurityIndicator, SubscriptionTierPublic, VenturePublic } from "./data";
import { authHeader } from "./auth.svelte";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// `fetch()` que rechaza (en vez de resolver con un Response) significa que
// la petición nunca llegó a tener respuesta HTTP — red caída, DNS, CORS
// bloqueado, o (el caso real más común reportado, con captura de pantalla:
// un celular mostrando 19.2 KB/s) una conexión móvil tan lenta/inestable
// que el navegador corta la subida a medio camino. Justo en el flujo de
// subir un comprobante — la acción más crítica y con más ansiedad de toda
// la app ("¿se subió o no, me cobraron o no?") — un solo intento fallido
// no debería obligar al estudiante a volver a elegir la foto a mano.
//
// Reintentar automáticamente ACÁ es seguro (a diferencia de reintentar una
// respuesta HTTP ya recibida, que si podría duplicar una acción): un
// fetch() que nunca llegó a responder significa que el backend puede no
// haber visto la petición en absoluto, y si SÍ la vio, cada acción crítica
// (alquilar, confirmar comprobante) ya está protegida con
// `updateMany WHERE status:"PENDING"` — un reintento que en realidad SÍ
// se procesó la primera vez simplemente encuentra 0 filas PENDING y
// responde con "ya fue procesado" en vez de duplicar nada.
const NETWORK_RETRY_DELAYS_MS = [600, 1500]; // hasta 3 intentos en total

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt >= NETWORK_RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAYS_MS[attempt]));
    }
  }
}

// Mensaje después de agotar TODOS los reintentos — antes mostraba
// textualmente "No se pudo contactar al backend
// (https://api.aeis-app.online/...): Failed to fetch", la URL cruda del
// backend y jerga de navegador que no le dicen nada útil a un estudiante.
function networkErrorMessage(): string {
  return "No se pudo conectar con el servidor — revisa tu conexión a internet e intenta de nuevo.";
}

async function getJSON<T>(path: string, opts: { auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_BASE_URL}${path}`, { headers: opts.auth ? authHeader() : undefined });
  } catch {
    throw new ApiError(networkErrorMessage());
  }
  if (!res.ok) {
    throw new ApiError(`Backend respondió ${res.status} en ${path}`, res.status);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(networkErrorMessage());
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
    res = await fetchWithRetry(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { ...authHeader() },
      body: form,
    });
  } catch {
    throw new ApiError(networkErrorMessage());
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
  cedula: string | null;
  phone: string | null;
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
  cedula: string;
  phone: string;
  acceptedTerms: boolean;
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

// Precio real (con descuento de aportante ya resuelto por el backend) para
// el paso de identidad del modal — reemplaza las preguntas "¿eres
// aportante?" / "¿qué plan tienes?" del formulario en papel: el backend ya
// sabe la respuesta con solo la sesión del estudiante (ver
// backend/src/locker/locker.service.ts::getPricePreview).
export interface LockerPricePreview {
  basePrice: number;
  discountPercent: number;
  tierName: string | null;
  price: { TRANSFER: number; PAYPHONE: number };
}

export function fetchLockerPricePreview(): Promise<LockerPricePreview> {
  return getJSON<LockerPricePreview>("/lockers/my-price", { auth: true });
}

export function confirmLockerReceipt(rentalId: string, receipt: File) {
  const form = new FormData();
  form.append("receipt", receipt);
  return postFormData(`/lockers/rentals/${encodeURIComponent(rentalId)}/confirm-receipt`, form);
}

// "¿Tengo una reserva por transferencia esperando comprobante?" — para que
// la grilla deje tocar SOLO ese casillero (a resubir la foto) mientras
// sigue RESERVED, sin habilitar el de nadie más. El backend filtra por el
// userId del JWT, nunca por algo que este cliente pueda manipular.
export interface MyPendingReceipt {
  rentalId: string;
  lockerCode: string;
}

export function fetchMyPendingReceipt(): Promise<MyPendingReceipt | null> {
  return getJSON<MyPendingReceipt | null>("/lockers/mine/pending-receipt", { auth: true });
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
// con esos query params). Dos dominios pueden originar un pago con
// PayPhone (casillero o aportación) y cada uno tiene su propio endpoint
// de confirmación — App.svelte prueba el de casilleros primero y cae al
// de aportaciones si el id no corresponde a un alquiler.
export function confirmLockerPayphonePayment(id: number, clientTransactionId: string) {
  return postJSON("/lockers/payphone/confirm", { id, clientTransactionId });
}

export function confirmSubscriptionPayphonePayment(id: number, clientTransactionId: string) {
  return postJSON("/subscriptions/payphone/confirm", { id, clientTransactionId });
}

// Aportaciones (Bronce/Platino/Pantera) — mismo patrón de 3 pasos que
// casilleros (identidad → método de pago → confirmación). Público el
// listado de tiers (ver precios sin sesión no expone nada sensible).
export function fetchSubscriptionTiers(): Promise<SubscriptionTierPublic[]> {
  return getJSON<SubscriptionTierPublic[]>("/subscriptions/tiers");
}

export interface MySubscription {
  id: string;
  tierName: string;
  amount: string;
  method: "TRANSFER" | "PAYPHONE";
  paymentStatus: "PENDING" | "CONFIRMED" | "REJECTED";
}

export function fetchMySubscription(): Promise<MySubscription | null> {
  return getJSON<MySubscription | null>("/subscriptions/mine", { auth: true });
}

export interface SubscribeInput {
  tierName: string;
  method: "TRANSFER" | "PAYPHONE";
}

export interface SubscriptionFromApi {
  id: string;
  userId: string;
  tierId: string;
  periodId: string;
  paymentId: string;
  createdAt: string;
}

export function subscribeToTier(input: SubscribeInput): Promise<SubscriptionFromApi> {
  return postJSON<SubscriptionFromApi>("/subscriptions", input);
}

export function confirmSubscriptionReceipt(subscriptionId: string, receipt: File) {
  const form = new FormData();
  form.append("receipt", receipt);
  return postFormData(`/subscriptions/${encodeURIComponent(subscriptionId)}/confirm-receipt`, form);
}

export function fetchSubscriptionPayphoneConfig(): Promise<PayphonePublicConfig> {
  return getJSON<PayphonePublicConfig>("/subscriptions/payphone/config");
}
