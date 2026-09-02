import { Injectable } from "@nestjs/common";
import { getJson, JobSource } from "./job-source";
import { parseDate, stripHtml, truncate, RawJob } from "../normalize/normalize";
import type { JobKind } from "../relevance/job-relevance.engine";

// Arbeitnow — API pública, sin key. Bolsa mayormente europea/alemana, así
// que casi todo lo que trae termina castigado por "presencial fuera de
// Ecuador" en el motor... salvo lo remoto, que es justo lo que sí le sirve
// a un estudiante en Quito. Entra por eso: aporta volumen de vacantes
// remotas reales sin costo ni key.
export const ARBEITNOW_URL = "https://www.arbeitnow.com/api/job-board-api";

interface ArbeitnowItem {
  slug?: unknown;
  title?: unknown;
  company_name?: unknown;
  description?: unknown;
  url?: unknown;
  location?: unknown;
  remote?: unknown;
  job_types?: unknown;
  created_at?: unknown;
}

/** Mapeo de `job_types` de Arbeitnow al enum del dominio. */
const JOB_TYPE_MAP: Readonly<Record<string, JobKind>> = {
  internship: "INTERNSHIP",
  intern: "INTERNSHIP",
  praktikum: "INTERNSHIP", // "pasantía" en alemán — la bolsa es de Alemania
  full_time: "FULL_TIME",
  fulltime: "FULL_TIME",
  part_time: "PART_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACT",
  freelance: "CONTRACT",
};

export function parseArbeitnow(payload: unknown): RawJob[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const out: RawJob[] = [];
  for (const item of data as ArbeitnowItem[]) {
    if (!item || typeof item !== "object") continue;

    const slug = str(item.slug);
    const title = str(item.title);
    const company = str(item.company_name);
    const url = str(item.url);
    if (!slug || !title || !company || !url) continue;

    out.push({
      source: "arbeitnow",
      sourceId: slug,
      title,
      company,
      description: truncate(stripHtml(str(item.description) ?? "")),
      url,
      location: str(item.location),
      remote: typeof item.remote === "boolean" ? item.remote : null,
      kind: mapKind(item.job_types),
      // `created_at` viene como epoch en SEGUNDOS — `parseDate` distingue la
      // unidad sola; interpretarlo como ms mandaba todo a 1970 y el motor
      // archivaba la fuente entera por "antigua".
      postedAt: parseDate(item.created_at),
      // Arbeitnow no publica salario estructurado.
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    });
  }
  return out;
}

function mapKind(jobTypes: unknown): JobKind | null {
  if (!Array.isArray(jobTypes)) return null;
  for (const t of jobTypes) {
    if (typeof t !== "string") continue;
    const mapped = JOB_TYPE_MAP[t.toLowerCase().replace(/[\s-]/g, "_")];
    if (mapped) return mapped;
  }
  return null;
}

@Injectable()
export class ArbeitnowSource implements JobSource {
  readonly name = "arbeitnow";

  async fetchJobs(): Promise<RawJob[]> {
    return parseArbeitnow(await getJson(ARBEITNOW_URL));
  }
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}
