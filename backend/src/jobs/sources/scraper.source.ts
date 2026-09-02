import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobSource } from "./job-source";
import { parseDate, stripHtml, truncate, RawJob } from "../normalize/normalize";

// Puente hacia el microservicio de scraping (jobs-scraper/, Python).
//
// Cubre las CINCO fuentes que de verdad importan para un estudiante de la
// EPN: la bolsa de la propia universidad, Indeed Ecuador, LinkedIn,
// Multitrabajos y Computrabajo. Las tres locales no tienen API publica —
// van con scrapers propios sobre Playwright, portados del worker Panchito
// GPT (ver jobs-scraper/panchito/__init__.py).
//
// Por que un servicio aparte y no TypeScript: JobSpy y los scrapers son
// Python, y reimplementar el parseo de cinco portales que cambian de HTML
// sin avisar seria mantenerlo a mano para siempre. Aca es un contenedor mas
// en el mismo compose y un contrato HTTP de una sola ruta.
//
// El servicio NO publica puertos al host (igual que postgres, ver
// docker-compose.prod.yml): solo el backend lo alcanza por la red interna.
//
// Realidad operativa: los portales cambian su HTML sin avisar, y que un
// scraper deje de traer resultados es cuestion de tiempo, no un accidente.
// Por eso el ingest tolera que esta fuente falle entera, y por eso el
// servicio devuelve 200 con los errores por-fuente en el cuerpo en vez de
// un 500 que tiraria tambien las fuentes que si funcionaron.

/** Nombres tal como los reporta el servicio Python. */
export const SCRAPER_SOURCES = ["epn", "indeed", "linkedin", "multitrabajos", "computrabajo"] as const;

/** Ver la nota junto a su uso en fetchJobs() para el porque de 40 min. */
export const SCRAPER_TIMEOUT_MS = 40 * 60_000;

interface ScraperRow {
  source?: unknown;
  source_id?: unknown;
  url?: unknown;
  company_logo?: unknown;
  title?: unknown;
  company?: unknown;
  location?: unknown;
  is_remote?: unknown;
  is_internship?: unknown;
  description?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
  salary_currency?: unknown;
  posted_at?: unknown;
  tags?: unknown;
}

export interface ScraperResponse {
  jobs?: unknown;
  errors?: unknown;
  /** Cuantas ofertas trajo cada fuente — se registra en el log del ingest. */
  stats?: unknown;
}

/**
 * Convierte la respuesta del servicio a `RawJob[]`.
 *
 * Funcion pura y exportada para poder testearla con payloads reales sin
 * depender de que los portales esten arriba, ni convertir la suite en algo
 * que falla los lunes porque Multitrabajos cambio el DOM.
 */
export function parseScraperJobs(payload: unknown): RawJob[] {
  const rows = (payload as ScraperResponse)?.jobs;
  if (!Array.isArray(rows)) return [];

  const out: RawJob[] = [];
  for (const row of rows as ScraperRow[]) {
    if (!row || typeof row !== "object") continue;

    const title = str(row.title);
    const company = str(row.company);
    const url = str(row.url);
    // Sin titulo o sin link la oferta es inservible: no se puede mostrar ni
    // se puede postular.
    if (!title || !url) continue;

    const source = (str(row.source) ?? "desconocido").toLowerCase();

    out.push({
      source,
      // Varios portales no exponen un id propio; la URL siempre es unica y
      // estable, asi que sirve de identificador de respaldo.
      sourceId: str(row.source_id) ?? url,
      title,
      company: company ?? "",
      // Los scrapers propios ya devuelven texto plano, pero Indeed y
      // LinkedIn (via JobSpy) traen HTML de la empresa que publica. Se
      // limpia igual: es el corte de un XSS almacenado antes de que llegue
      // a la base (ver normalize.ts).
      description: truncate(stripHtml(str(row.description) ?? "")),
      url,
      companyLogo: httpUrl(row.company_logo),
      location: str(row.location),
      remote: typeof row.is_remote === "boolean" ? row.is_remote : null,
      // El scraper ya decidio si es pasantia leyendo el titulo, las
      // etiquetas del portal y la descripcion — la bolsa de la EPN incluso
      // trae el tipo de contrato etiquetado. Se respeta ese dato en vez de
      // volver a adivinarlo; el motor igual puede corregirlo por titulo
      // (ver detectKind).
      kind: row.is_internship === true ? "INTERNSHIP" : null,
      postedAt: parseDate(row.posted_at),
      salaryMin: positive(row.salary_min),
      salaryMax: positive(row.salary_max),
      salaryCurrency: str(row.salary_currency),
    });
  }
  return out;
}

@Injectable()
export class ScraperSource implements JobSource {
  readonly name = "scraper";
  private readonly logger = new Logger(ScraperSource.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * URL del microservicio, o null si no esta configurado.
   *
   * Que sea opcional es deliberado: sin `JOBS_SCRAPER_URL`, el modulo entero
   * sigue funcionando con las APIs publicas. Asi el entorno de desarrollo
   * no se rompe por una fuente que necesita levantar un contenedor con
   * Chromium adentro.
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
      this.logger.debug("JOBS_SCRAPER_URL no configurado — scrapers desactivados");
      return [];
    }

    const res = await fetch(`${base.replace(/\/$/, "")}/scrape`, {
      method: "POST",
      // Timeout MUCHO mas largo que el resto de fuentes, y explicito en vez
      // de un multiplo del de las APIs: son cosas distintas.
      //
      // Medido contra los portales reales: la Bolsa EPN sola tarda ~6 min
      // (11 terminos x 4 paginas, con pausas de 3-8 s entre paginas para no
      // parecer una rafaga), y la corrida completa de las cinco fuentes
      // ronda 12-14 min con dos en paralelo. LinkedIn es la mas variable
      // porque pide la descripcion de CADA vacante aparte.
      //
      // 40 minutos deja margen para un dia lento sin quedarse colgado para
      // siempre. Que se agote significa que algo esta mal de verdad, no que
      // los portales anduvieran despacio.
      signal: AbortSignal.timeout(SCRAPER_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const payload = (await res.json()) as ScraperResponse;

    if (payload.stats && typeof payload.stats === "object") {
      this.logger.log(`Scrapers por fuente: ${JSON.stringify(payload.stats)}`);
    }
    // Los errores por-fuente no tumban la corrida: si Multitrabajos cambio
    // el DOM pero la EPN trajo 86 ofertas, esas 86 entran igual.
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      this.logger.warn(`Scrapers con errores parciales: ${JSON.stringify(payload.errors).slice(0, 400)}`);
    }
    return parseScraperJobs(payload);
  }
}

function str(v: unknown): string | null {
  // "nan" viene de los DataFrame de pandas (JobSpy): guardarla tal cual
  // ponia literalmente la palabra "nan" en la descripcion que ve el
  // estudiante.
  if (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "nan") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * URL de logo, solo si es http(s).
 *
 * Los portales a veces devuelven `data:` o rutas relativas que ya no
 * resuelven fuera de su sitio. Guardar eso significaria un `<img>` roto en
 * cada tarjeta; con null, la UI cae al respaldo (la inicial de la empresa),
 * que ademas distingue una empresa de otra mejor que un icono generico.
 */
function httpUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

function positive(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  // 0 significa "no informado" en varias fuentes, no "sueldo cero".
  return Number.isFinite(n) && n > 0 ? n : null;
}
