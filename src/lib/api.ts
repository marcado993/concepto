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
// que el navegador corta la petición a medio camino. Justo en el flujo de
// pago — la acción más crítica y con más ansiedad de toda la app ("¿se
// confirmó o no, me cobraron o no?") — un solo intento fallido no debería
// obligar al estudiante a empezar de cero.
//
// Reintentar automáticamente ACÁ es seguro (a diferencia de reintentar una
// respuesta HTTP ya recibida, que sí podría duplicar una acción): un
// fetch() que nunca llegó a responder significa que el backend puede no
// haber visto la petición en absoluto, y si SÍ la vio, cada acción crítica
// (alquilar, confirmar el pago) ya está protegida con
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

// El backend (NestJS) manda {message, error, statusCode} en sus errores —
// mostrar ese `message` es mucho más útil para el estudiante que "Backend
// respondió 400", sobre todo en el flujo de alquiler (ej. "El casillero ya
// no está disponible", "PayPhone no aprobó esta transacción").
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

// Identidad del estudiante logueado — para prellenar el formulario de
// alquiler/aportación, siempre editable (ver
// backend/src/shared/auth/auth.controller.ts).
export interface MeResponse {
  /** null mientras siga siendo el placeholder interno — mismo patrón que
   *  uniqueCode/cedula/phone. El login por correo no trae ningún nombre
   *  real (a diferencia de GitHub/Google), así que el alquiler/aportación
   *  lo piden como campo obligatorio, editable, nunca prellenado con el
   *  placeholder (bug real corregido: ese placeholder llegó a ser
   *  literalmente el correo del estudiante). */
  fullName: string | null;
  /** null mientras siga siendo el placeholder interno ("PENDIENTE-...") —
   *  mismo patrón que cedula/phone. El paso de alquiler lo pide como
   *  campo obligatorio (dato real usado para localizar al dueño de un
   *  casillero, no un identificador nuestro). */
  uniqueCode: string | null;
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

// Alquiler de casilleros — flujo de 3 pasos (identidad → PayPhone →
// confirmación). PayPhone es el único método de pago (transferencia +
// comprobante por OCR se retiró) — el alquiler queda PENDING hasta que
// confirmLockerPayphonePayment() verifica el pago contra la API real.
export interface RentLockerInput {
  lockerCode: string;
  fullName: string;
  uniqueCode: string;
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
  price: { PAYPHONE: number };
  /** El semestre al que va el alquiler — viene del backend, NUNCA se
   *  escribe a mano en la UI: es el mismo dato con el que se asigna el
   *  alquiler y con el que se archiva la aceptación de términos (ver
   *  PeriodService.getCurrentPeriod). Antes el modal lo tenía hardcodeado
   *  y nombraba un semestre que ya no era el vigente.
   *
   *  Opcional a propósito: el frontend (Vercel) se despliega en segundos y
   *  el backend (GitHub Actions → VPS) tarda minutos, así que SIEMPRE hay
   *  una ventana real en la que esta versión del frontend habla con un
   *  backend que todavía no manda este campo. Marcarlo opcional obliga a
   *  cubrir ese caso en la UI en vez de reventar con "cannot read
   *  properties of undefined" justo en la pantalla de precio. */
  period?: { label: string; endsAt: string };
}

export function fetchLockerPricePreview(): Promise<LockerPricePreview> {
  return getJSON<LockerPricePreview>("/lockers/my-price", { auth: true });
}

// "¿Ya tengo un casillero confirmado este periodo?" — pedido real: en vez
// de que el estudiante busque el suyo entre hasta 108, la grilla lo
// distingue y lo deja tocar para ver el estado directamente.
export interface MyRentedLocker {
  lockerCode: string;
  zone: string;
}

export function fetchMyRentedLocker(): Promise<MyRentedLocker | null> {
  return getJSON<MyRentedLocker | null>("/lockers/mine/rented", { auth: true });
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

// method conserva "TRANSFER" en el tipo a propósito — es una lectura de
// datos HISTÓRICOS (una aportación creada antes de que se retirara
// transferencia como método sigue existiendo con ese valor guardado, ver
// docs/dominio/12-concurrencia-y-testing.md); PayPhone es el único método
// con el que se puede crear una aportación NUEVA hoy (ver SubscribeInput).
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
  fullName: string;
}

export interface SubscriptionFromApi {
  id: string;
  userId: string;
  tierId: string;
  periodId: string;
  paymentId: string;
  createdAt: string;
}

// Aportaciones son informativas, sin pasarela real — el backend confirma
// de una vez (ver subscription.service.ts::subscribe(), autoConfirm:true).
// Nunca hay un paso de PayPhone que pedir acá, a diferencia de casilleros.
export function subscribeToTier(input: SubscribeInput): Promise<SubscriptionFromApi> {
  return postJSON<SubscriptionFromApi>("/subscriptions", input);
}

// Rueda ("A") vs. lista accesible ("B") — feature flag editable desde el
// panel de administración (ver abTest.ts para cómo se usa/cachea).
export function fetchUiVariant(): Promise<{ variant: "A" | "B" }> {
  return getJSON("/ui-variant");
}

// El cliente del panel de administración vive aparte, en
// src/lib/admin/adminApi.ts — usa su PROPIA sesión (login de correo+
// contraseña, ver admin-auth.service.ts), nunca el token de estudiante de
// este archivo.

// ---------------------------------------------------------------------
// Bolsa de empleo — pasantias y vacantes de Sistemas/Software agregadas
// por el backend desde varias fuentes (ver backend/src/jobs/).
//
// El listado es publico (sin auth), igual que /ventures y /security: son
// datos que ya son publicos en las bolsas de origen, y exigir login para
// ver pasantias seria una puerta justo delante de lo que la asociacion
// quiere que la gente use.
// ---------------------------------------------------------------------

export type JobKind = "INTERNSHIP" | "FULL_TIME" | "PART_TIME" | "CONTRACT";
export type JobWorkMode = "ONSITE" | "HYBRID" | "REMOTE";
export type JobSeniority = "INTERN" | "JUNIOR" | "MID" | "SENIOR" | "UNKNOWN";

export interface JobOfferPublic {
  id: string;
  title: string;
  company: string;
  excerpt: string;
  url: string;
  location: string | null;
  kind: JobKind;
  seniority: JobSeniority;
  workMode: JobWorkMode;
  tags: string[];
  /** Ya formateado por el backend ("USD 60k - 90k"), o null si no se informo. */
  salary: string | null;
  /** Nombre legible de la bolsa de origen — se MUESTRA en la tarjeta:
      Remote OK exige la atribucion en sus terminos de uso de la API. */
  source: string;
  postedAt: string | null;
  relevance: number;
}

export interface JobListResult {
  jobs: JobOfferPublic[];
  total: number;
  /** Conteos que respetan los filtros activos, no la tabla entera. */
  facets: { internships: number; remote: number; ecuador: number };
}

export interface JobFilters {
  q?: string;
  kind?: JobKind;
  workMode?: JobWorkMode;
  seniority?: JobSeniority;
  ecuador?: boolean;
  tag?: string;
  sort?: "relevance" | "recent";
  limit?: number;
  offset?: number;
}

export function fetchJobs(filters: JobFilters = {}): Promise<JobListResult> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    // Se omiten los vacios en vez de mandarlos como cadena vacia: el DTO
    // del backend valida con @IsIn/@IsBoolean, y un "" explicito seria un
    // 400 en vez de "sin filtro" — que es lo que quiere decir un select
    // que el estudiante dejo en "Todos".
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return getJSON<JobListResult>(`/jobs${qs ? `?${qs}` : ""}`);
}

export function fetchJobTags(): Promise<{ tag: string; count: number }[]> {
  return getJSON<{ tag: string; count: number }[]>("/jobs/tags");
}
