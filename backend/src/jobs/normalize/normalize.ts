import { normalizeForMatch } from "../relevance/taxonomy";
import type { JobKind } from "../relevance/job-relevance.engine";

// Forma canónica de una oferta ANTES de puntuarla. Cada fuente devuelve un
// JSON distinto (Remotive manda HTML, JobSpy manda columnas de un
// DataFrame, Arbeitnow manda otra cosa); acá todas terminan igual.

export interface RawJob {
  /** Identifica la fuente: "remotive", "arbeitnow", "jobspy:linkedin". */
  source: string;
  /** Id de la oferta DENTRO de esa fuente. Único junto con `source`. */
  sourceId: string;
  title: string;
  company: string;
  /** Texto plano — el HTML ya viene removido, ver `stripHtml`. */
  description: string;
  url: string;
  location: string | null;
  remote: boolean | null;
  kind: JobKind | null;
  postedAt: Date | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/**
 * Máximo de descripción que se guarda.
 *
 * Las descripciones de LinkedIn pasan de 10 KB con boilerplate legal. El
 * motor solo necesita el principio (ahí van stack y requisitos) y la UI
 * muestra un extracto con link a la oferta original, así que guardar el
 * texto completo era pagar disco por algo que nadie lee.
 */
export const MAX_DESCRIPTION = 4000;

/**
 * Quita HTML y deja texto plano.
 *
 * Es tanto de calidad como de SEGURIDAD: Remotive devuelve la descripción
 * como HTML crudo escrito por la empresa que publica. Ese texto termina en
 * la UI, así que guardarlo con etiquetas sería guardar un XSS almacenado a
 * la espera de que alguien lo renderice sin escapar. Se corta en la
 * ingesta, no en el render: así ninguna vista futura puede reintroducir el
 * agujero por descuido.
 *
 * `<script>`/`<style>` se borran CON su contenido — quitarles solo las
 * etiquetas dejaría el código JavaScript como si fuera texto de la oferta.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** Recorta a `max` sin partir una palabra por la mitad. */
export function truncate(text: string, max = MAX_DESCRIPTION): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * Fecha desde lo que sea que mande la fuente.
 *
 * Las fuentes mandan ISO, epoch en segundos, epoch en milisegundos, o
 * basura. Devolver `null` ante lo dudoso es correcto: el motor castiga la
 * ausencia de fecha apenas (-3), mientras que una fecha inventada
 * distorsiona el ranking entero, que es lo que ordena el listado.
 */
export function parseDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isValidDate(value) ? value : null;

  if (typeof value === "number") {
    // Heurística de unidades: un epoch en SEGUNDOS del año 2026 ronda
    // 1.7e9; en MILISEGUNDOS, 1.7e12. Interpretar mal la unidad ponía las
    // ofertas en 1970 y el motor las archivaba a todas por antiguas.
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return isValidDate(d) ? d : null;
  }

  if (typeof value === "string") {
    const d = new Date(value);
    return isValidDate(d) ? d : null;
  }
  return null;
}

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

/**
 * Sufijos societarios que se quitan al comparar empresas.
 *
 * "Acme S.A." en Multitrabajos y "Acme" en LinkedIn son la MISMA empresa, y
 * sin esto la misma vacante se guardaba dos veces.
 */
const COMPANY_SUFFIXES =
  /\b(s\.?a\.?s?|c\.?a\.?|cia|compania|ltda|limitada|inc|llc|corp|corporation|gmbh|s\.?l\.?|bv|nv|group|holding)\b\.?/g;

/** Nombre de empresa comparable: sin tildes, sin sufijo societario, sin puntuación. */
export function canonicalCompany(company: string): string {
  return normalizeForMatch(company)
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Título comparable.
 *
 * Se quitan los paréntesis y corchetes porque las fuentes cuelgan ahí datos
 * que NO cambian el puesto: "Backend Developer (Remote)", "Backend
 * Developer [Quito]", "Backend Developer - Ecuador". Sin quitarlos, la
 * misma vacante replicada en tres bolsas contaba como tres ofertas
 * distintas, que es exactamente lo que el dedupe tiene que evitar.
 */
export function canonicalTitle(title: string): string {
  return normalizeForMatch(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9+#. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Huella de una oferta — empresa + puesto.
 *
 * A propósito NO incluye la fuente ni la URL: el objetivo es justamente que
 * la misma vacante publicada en LinkedIn, Indeed y Computrabajo colapse en
 * una sola fila. Tampoco incluye la ubicación: la misma vacante suele venir
 * con la ciudad en una fuente y con el país en otra.
 */
export function jobFingerprint(job: Pick<RawJob, "company" | "title">): string {
  return `${canonicalCompany(job.company)}::${canonicalTitle(job.title)}`;
}
