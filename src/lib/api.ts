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
    throw new ApiError(`Backend respondió ${res.status} en ${path}`, res.status);
  }
  return res.json() as Promise<T>;
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
