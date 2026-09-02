import { Injectable } from "@nestjs/common";
import { getJson, JobSource } from "./job-source";
import { parseDate, stripHtml, truncate, RawJob } from "../normalize/normalize";

// Remote OK — API pública, sin key, JSON plano.
//
// ATRIBUCIÓN OBLIGATORIA: sus términos (que vienen dentro de la propia
// respuesta, en el campo `legal` del primer elemento) exigen enlazar de
// vuelta a la oferta en remoteok.com y mencionar "Remote OK" como fuente, o
// suspenden el acceso. Por eso `url` guarda SIEMPRE la URL de Remote OK y
// nunca la de la empresa, y la UI muestra el nombre de la fuente en cada
// tarjeta. No es decorativo: es la condición de uso de la API.
export const REMOTEOK_URL = "https://remoteok.com/api";

interface RemoteOkItem {
  id?: unknown;
  slug?: unknown;
  position?: unknown;
  company?: unknown;
  description?: unknown;
  location?: unknown;
  tags?: unknown;
  url?: unknown;
  apply_url?: unknown;
  date?: unknown;
  epoch?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
}

/**
 * Convierte el payload de Remote OK a `RawJob[]`.
 *
 * Función pura y exportada para poder testearla con la respuesta REAL de la
 * API sin depender de que el sitio esté arriba.
 */
export function parseRemoteOk(payload: unknown): RawJob[] {
  if (!Array.isArray(payload)) return [];

  const out: RawJob[] = [];
  for (const item of payload as RemoteOkItem[]) {
    if (!item || typeof item !== "object") continue;

    // El PRIMER elemento del array no es una oferta: es un objeto de
    // metadatos con `legal` y `last_updated`. Tratarlo como oferta creaba
    // una fila fantasma sin empresa ni título en cada corrida.
    if (!item.position || !item.company) continue;

    const id = str(item.id) ?? str(item.slug);
    const url = str(item.url) ?? str(item.apply_url);
    if (!id || !url) continue;

    out.push({
      source: "remoteok",
      sourceId: id,
      title: str(item.position) as string,
      company: str(item.company) as string,
      description: truncate(stripHtml(str(item.description) ?? "")),
      url,
      location: str(item.location),
      // El nombre de la bolsa ya lo dice: todo lo que publica es remoto.
      remote: true,
      // Remote OK no manda un tipo de contrato estructurado — lo mete en
      // `tags` ("full time", "internship"). Se deja en null a propósito y
      // que el motor lo infiera del título, que es más fiable que un tag
      // que la empresa elige a dedo.
      kind: null,
      postedAt: parseDate(item.epoch ?? item.date),
      // 0 en esta API significa "no informado", no "sueldo cero". Guardarlo
      // como 0 haría que la UI mostrara "$0" en vacantes que simplemente no
      // publican el sueldo.
      salaryMin: positive(item.salary_min),
      salaryMax: positive(item.salary_max),
      salaryCurrency: positive(item.salary_min) !== null ? "USD" : null,
    });
  }
  return out;
}

@Injectable()
export class RemoteOkSource implements JobSource {
  readonly name = "remoteok";

  async fetchJobs(): Promise<RawJob[]> {
    return parseRemoteOk(await getJson(REMOTEOK_URL));
  }
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function positive(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
