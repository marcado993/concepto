import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobSource, SOURCE_TIMEOUT_MS } from "./job-source";
import { parseDate, stripHtml, truncate, RawJob } from "../normalize/normalize";
import type { JobKind } from "../relevance/job-relevance.engine";

// Puente hacia JobSpy (https://github.com/speedyapply/JobSpy), que es una
// librería de PYTHON y este backend es NestJS. En vez de reimplementar el
// scraping en TypeScript — que sería mantener a mano el parseo de cinco
// bolsas que cambian de HTML sin avisar — corre como un microservicio
// aparte en el mismo compose, y este archivo solo le habla por HTTP.
//
// El servicio NO publica puertos al host (igual que postgres, ver
// docker-compose.prod.yml): solo el backend lo alcanza por la red interna.
// Un scraper es justamente la pieza que uno no quiere expuesta a internet.
//
// Realidad operativa, dicha sin adornos: Indeed es el scraper estable;
// LinkedIn limita por tasa (429) y a veces devuelve vacío, y Glassdoor va y
// viene. Por eso el ingest tolera que esta fuente falle entera y por eso
// `jobspy:linkedin` es la de MENOR prioridad en el dedupe. Cuando LinkedIn
// bloquee, el listado sigue vivo con el resto.

export interface JobSpyQuery {
  siteNames: string[];
  searchTerm: string;
  location?: string;
  resultsWanted?: number;
  hoursOld?: number;
  countryIndeed?: string;
  isRemote?: boolean;
}

/**
 * Búsquedas por defecto contra las bolsas locales.
 *
 * Están escritas en ESPAÑOL y con los términos ecuatorianos reales
 * ("pasantías", "prácticas preprofesionales") porque así es como publican
 * las empresas en Indeed Ecuador. Buscar "internship" acá devolvía casi
 * nada; ese fue el motivo de tener queries locales separadas de las
 * internacionales en inglés.
 *
 * `hoursOld: 336` = 14 días. Más atrás las vacantes ya suelen estar
 * llenas, y el motor igual las castigaría por antiguas.
 */
export const DEFAULT_QUERIES: readonly JobSpyQuery[] = [
  {
    siteNames: ["indeed"],
    searchTerm: "pasantias desarrollo software",
    location: "Quito, Ecuador",
    countryIndeed: "ecuador",
    resultsWanted: 40,
    hoursOld: 336,
  },
  {
    siteNames: ["indeed"],
    searchTerm: "practicas preprofesionales sistemas",
    location: "Quito, Ecuador",
    countryIndeed: "ecuador",
    resultsWanted: 40,
    hoursOld: 336,
  },
  {
    siteNames: ["indeed"],
    searchTerm: "desarrollador junior",
    location: "Quito, Ecuador",
    countryIndeed: "ecuador",
    resultsWanted: 40,
    hoursOld: 336,
  },
  {
    siteNames: ["indeed"],
    searchTerm: "ingeniero de sistemas",
    location: "Ecuador",
    countryIndeed: "ecuador",
    resultsWanted: 40,
    hoursOld: 336,
  },
];

interface JobSpyRow {
  site?: unknown;
  id?: unknown;
  title?: unknown;
  company?: unknown;
  description?: unknown;
  job_url?: unknown;
  location?: unknown;
  is_remote?: unknown;
  job_type?: unknown;
  date_posted?: unknown;
  min_amount?: unknown;
  max_amount?: unknown;
  currency?: unknown;
}

const JOB_TYPE_MAP: Readonly<Record<string, JobKind>> = {
  internship: "INTERNSHIP",
  fulltime: "FULL_TIME",
  full_time: "FULL_TIME",
  parttime: "PART_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  temporary: "CONTRACT",
};

/**
 * Convierte la respuesta del microservicio a `RawJob[]`.
 *
 * Cada fila lleva su bolsa de origen en `source` ("jobspy:indeed",
 * "jobspy:linkedin") y no un genérico "jobspy": el dedupe necesita saber
 * QUÉ bolsa fue para poder preferir Indeed sobre LinkedIn cuando la misma
 * vacante llega por las dos.
 */
export function parseJobSpy(payload: unknown): RawJob[] {
  const rows = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(rows)) return [];

  const out: RawJob[] = [];
  for (const row of rows as JobSpyRow[]) {
    if (!row || typeof row !== "object") continue;

    const title = str(row.title);
    const company = str(row.company);
    const url = str(row.job_url);
    if (!title || !company || !url) continue;

    const site = (str(row.site) ?? "desconocido").toLowerCase();

    out.push({
      source: `jobspy:${site}`,
      // Varias bolsas no devuelven id propio; la URL siempre es única y
      // estable, así que sirve de identificador de respaldo.
      sourceId: str(row.id) ?? url,
      title,
      company,
      description: truncate(stripHtml(str(row.description) ?? "")),
      url,
      location: str(row.location),
      remote: typeof row.is_remote === "boolean" ? row.is_remote : null,
      kind: mapKind(row.job_type),
      postedAt: parseDate(row.date_posted),
      salaryMin: positive(row.min_amount),
      salaryMax: positive(row.max_amount),
      salaryCurrency: str(row.currency),
    });
  }
  return out;
}

function mapKind(jobType: unknown): JobKind | null {
  if (typeof jobType !== "string") return null;
  // JobSpy a veces devuelve varios tipos separados por coma.
  for (const part of jobType.split(",")) {
    const mapped = JOB_TYPE_MAP[part.trim().toLowerCase().replace(/[\s-]/g, "_")];
    if (mapped) return mapped;
  }
  return null;
}

@Injectable()
export class JobSpySource implements JobSource {
  readonly name = "jobspy";
  private readonly logger = new Logger(JobSpySource.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * URL del microservicio, o null si no está configurado.
   *
   * Que sea opcional es deliberado: sin `JOBS_SCRAPER_URL`, el módulo
   * entero sigue funcionando con las APIs públicas. Así el entorno de
   * desarrollo (y el VPS, hasta que se levante el contenedor Python) no se
   * rompe por una fuente que todavía no existe.
   */
  private get baseUrl(): string | null {
    return this.config.get<string>("JOBS_SCRAPER_URL")?.trim() || null;
  }

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  async fetchJobs(): Promise<RawJob[]> {
    const base = this.baseUrl;
    if (!base) {
      this.logger.debug("JOBS_SCRAPER_URL no configurado — fuente JobSpy desactivada");
      return [];
    }

    const res = await fetch(`${base.replace(/\/$/, "")}/scrape`, {
      method: "POST",
      // Timeout más largo que el resto: el servicio hace scraping real de
      // varias bolsas, y 20 s no le alcanzan ni para la primera.
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS * 6),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ queries: DEFAULT_QUERIES }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const payload = (await res.json()) as { jobs?: unknown; errors?: unknown };
    // Los errores por-bolsa no tumban la corrida: si LinkedIn devolvió 429
    // pero Indeed trajo 40 ofertas, esas 40 entran igual.
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      this.logger.warn(`JobSpy reporto errores parciales: ${JSON.stringify(payload.errors).slice(0, 300)}`);
    }
    return parseJobSpy(payload);
  }
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "nan") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function positive(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
