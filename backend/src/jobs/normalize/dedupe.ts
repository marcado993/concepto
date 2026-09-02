import { jobFingerprint, RawJob } from "./normalize";

// Dedupe entre fuentes. Sin esto el listado abre con la misma vacante de
// "Backend Developer en Acme" tres veces seguidas — una por bolsa — que fue
// exactamente el problema que hacía inútiles a los agregadores caseros.

/**
 * Prioridad de fuentes cuando dos filas son la misma oferta.
 *
 * Manda quién tiene el dato MÁS COMPLETO y más fiable, no quién es más
 * conocido:
 *  - `remotive`/`arbeitnow` publican una API oficial con descripción
 *    completa, fecha real y salario estructurado.
 *  - `jobspy:indeed` es, según el propio README de JobSpy, el scraper más
 *    estable (sin rate limiting).
 *  - `jobspy:linkedin` queda al final: es el que más se rompe y el que
 *    devuelve la descripción recortada salvo que se pida aparte.
 *
 * Una fuente desconocida vale 0 — nunca le gana a una conocida.
 */
export const SOURCE_PRIORITY: Readonly<Record<string, number>> = {
  remotive: 100,
  arbeitnow: 90,
  remoteok: 80,
  "jobspy:indeed": 70,
  "jobspy:glassdoor": 55,
  "jobspy:google": 50,
  "jobspy:linkedin": 40,
};

export function sourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 0;
}

/**
 * Se queda con una fila por oferta.
 *
 * El criterio de desempate va de lo más a lo menos decisivo:
 *  1. Tener fecha de publicación. Una oferta sin fecha pierde puntos en el
 *     motor, así que quedarse con la versión fechada mejora el ranking real
 *     aunque venga de una fuente de menor prioridad.
 *  2. Prioridad de la fuente (arriba).
 *  3. Descripción más larga — más señal para el motor y para el estudiante.
 *
 * Devuelve las ofertas en el orden en que apareció su PRIMERA ocurrencia:
 * un orden estable hace que el resultado del ingest sea reproducible y que
 * los tests no dependan del orden interno de un Map.
 */
export function dedupeJobs(jobs: readonly RawJob[]): RawJob[] {
  const best = new Map<string, RawJob>();
  const order: string[] = [];

  for (const job of jobs) {
    const fp = jobFingerprint(job);
    const incumbent = best.get(fp);
    if (!incumbent) {
      best.set(fp, job);
      order.push(fp);
      continue;
    }
    if (isBetter(job, incumbent)) best.set(fp, job);
  }

  return order.map((fp) => best.get(fp) as RawJob);
}

function isBetter(candidate: RawJob, incumbent: RawJob): boolean {
  const candHasDate = candidate.postedAt !== null;
  const incHasDate = incumbent.postedAt !== null;
  if (candHasDate !== incHasDate) return candHasDate;

  const candPrio = sourcePriority(candidate.source);
  const incPrio = sourcePriority(incumbent.source);
  if (candPrio !== incPrio) return candPrio > incPrio;

  return candidate.description.length > incumbent.description.length;
}
