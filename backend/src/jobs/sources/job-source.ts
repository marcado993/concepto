import { Logger } from "@nestjs/common";
import type { RawJob } from "../normalize/normalize";

/**
 * Una fuente de ofertas.
 *
 * El contrato separa a propósito el I/O (`fetch`) del parseo (funciones
 * puras `parseX` exportadas por cada archivo). Esa división es lo que
 * permite tener tests reales del parseo — con payloads copiados de la API
 * de verdad — sin depender de que la bolsa esté arriba, ni convertir la
 * suite en algo que falla los lunes porque LinkedIn cambió de humor.
 */
export interface JobSource {
  /** Identificador estable — se guarda en cada fila y ordena el dedupe. */
  readonly name: string;
  fetchJobs(): Promise<RawJob[]>;
}

/**
 * Timeout por defecto de una fuente.
 *
 * 20 s y no más: la ingesta corre dentro del mismo proceso que sirve la API
 * (igual que ResourceMonitorService — ver la nota de por qué no hay un
 * daemon aparte en este VPS). Una fuente colgada no puede quedarse tomando
 * el event loop mientras un estudiante espera que le cargue el listado de
 * casilleros.
 */
export const SOURCE_TIMEOUT_MS = 20_000;

/**
 * GET + JSON con timeout duro.
 *
 * `AbortSignal.timeout` en vez de un `setTimeout` manual: aborta la conexión
 * TCP de verdad, no solo deja de esperar la promesa. Sin eso, un socket
 * abierto contra una bolsa caída seguía vivo hasta el timeout del sistema.
 */
export async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    headers: {
      // Identificarse es lo correcto y además práctico: varias bolsas
      // bloquean al User-Agent por defecto de undici, y un UA honesto con
      // contacto es lo que piden sus propios términos.
      "User-Agent": "AEIS-APP/1.0 (+https://aeis.app; bolsa de empleo estudiantil EPN)",
      Accept: "application/json",
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Corre las fuentes en paralelo y devuelve lo que haya llegado.
 *
 * Deliberadamente tolerante a fallos: si LinkedIn devuelve 429 o
 * Multitrabajos cambió el HTML, el resto de fuentes igual entra. Lo
 * contrario — un `Promise.all` que revienta entero — significaba que UNA
 * bolsa caída dejaba el listado sin actualizar para todos, que es el modo
 * de falla más caro y menos visible que puede tener un agregador.
 */
export async function collectFromSources(
  sources: readonly JobSource[],
  logger: Logger
): Promise<{ jobs: RawJob[]; failed: string[] }> {
  const settled = await Promise.allSettled(sources.map((s) => s.fetchJobs()));

  const jobs: RawJob[] = [];
  const failed: string[] = [];

  settled.forEach((result, i) => {
    const name = sources[i].name;
    if (result.status === "fulfilled") {
      jobs.push(...result.value);
      logger.log(`Fuente ${name}: ${result.value.length} ofertas`);
    } else {
      failed.push(name);
      logger.warn(`Fuente ${name} fallo: ${errorMessage(result.reason)}`);
    }
  });

  return { jobs, failed };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
