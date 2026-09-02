import { Injectable } from "@nestjs/common";
import { getJson, JobSource } from "./job-source";
import { parseDate, stripHtml, truncate, RawJob } from "../normalize/normalize";
import type { JobKind } from "../relevance/job-relevance.engine";

// Remotive — API pública, sin key, categoría acotada a software para no
// traerse la bolsa entera (también publica marketing, soporte, diseño).
//
// `limit` alto a propósito: la API no pagina, devuelve todo de una y el
// filtrado fino lo hace el motor, no la fuente. Pedir de menos acá
// significaba perder ofertas buenas antes de siquiera puntuarlas.
export const REMOTIVE_URL = "https://remotive.com/api/remote-jobs?category=software-dev&limit=200";

interface RemotiveItem {
  id?: unknown;
  title?: unknown;
  company_name?: unknown;
  description?: unknown;
  url?: unknown;
  candidate_required_location?: unknown;
  job_type?: unknown;
  publication_date?: unknown;
  salary?: unknown;
}

const JOB_TYPE_MAP: Readonly<Record<string, JobKind>> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  freelance: "CONTRACT",
  internship: "INTERNSHIP",
};

export function parseRemotive(payload: unknown): RawJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];

  const out: RawJob[] = [];
  for (const item of jobs as RemotiveItem[]) {
    if (!item || typeof item !== "object") continue;

    const id = str(item.id);
    const title = str(item.title);
    const company = str(item.company_name);
    const url = str(item.url);
    if (!id || !title || !company || !url) continue;

    out.push({
      source: "remotive",
      sourceId: id,
      title,
      company,
      // Remotive manda la descripción como HTML CRUDO escrito por la
      // empresa. `stripHtml` acá no es cosmética, es el corte de un XSS
      // almacenado antes de que llegue a la base (ver normalize.ts).
      description: truncate(stripHtml(str(item.description) ?? "")),
      url,
      // No es la sede de la empresa: es DESDE DÓNDE puede postularse el
      // candidato ("Worldwide", "LATAM", "USA Only"). Para un estudiante en
      // Quito ese dato vale mucho más que la dirección de la oficina, y es
      // lo que el motor necesita para decidir si la oferta es alcanzable.
      location: str(item.candidate_required_location),
      remote: true, // toda la bolsa es remota
      kind: mapKind(item.job_type),
      postedAt: parseDate(item.publication_date),
      // `salary` es texto libre ("$50k - $70k", "Competitive") — no se
      // intenta parsear a número. Un rango mal inferido es peor que no
      // mostrar nada, porque el estudiante decide postular con esa cifra.
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    });
  }
  return out;
}

function mapKind(jobType: unknown): JobKind | null {
  if (typeof jobType !== "string") return null;
  return JOB_TYPE_MAP[jobType.toLowerCase().replace(/[\s-]/g, "_")] ?? null;
}

@Injectable()
export class RemotiveSource implements JobSource {
  readonly name = "remotive";

  async fetchJobs(): Promise<RawJob[]> {
    return parseRemotive(await getJson(REMOTIVE_URL));
  }
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}
