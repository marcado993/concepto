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
  // La bolsa de la EPN va PRIMERA, por encima de cualquier API: es la
  // unica fuente donde solo se compite con gente de la misma universidad,
  // trae el tipo de contrato ya etiquetado por la plataforma, y varias
  // empresas publican ahi pasantias que nunca llegan a los portales
  // generales. Cuando la misma vacante aparece en la EPN y en Computrabajo,
  // la version de la EPN es la mejor.
  epn: 120,
  // Portales locales: son los que de verdad publican pasantias en Ecuador.
  indeed: 100,
  multitrabajos: 95,
  computrabajo: 90,
  // Trabajo.org va por ENCIMA de Computrabajo pese a ser un agregador: es
  // la unica fuente local cuyo listado trae la descripcion completa (100%
  // de sus avisos, medido sobre 577). Computrabajo no publica ninguna en el
  // listado, asi que ante la misma vacante en ambas, la de trabajo.org es
  // la que el motor puede leer de verdad.
  trabajo_org: 92,
  linkedin: 85,
  // APIs internacionales: datos limpios y completos, pero casi todo lo que
  // traen es remoto del exterior.
  remotive: 70,
  arbeitnow: 60,
  remoteok: 50,
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
