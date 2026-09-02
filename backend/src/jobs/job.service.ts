import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { QueryJobsDto } from "./dto/query-jobs.dto";
import { ECUADOR_TERMS, GLOBAL_REMOTE_TERMS } from "./relevance/taxonomy";

// Vista pública de una oferta. Se define aparte del modelo de Prisma a
// propósito: `reasons` (la explicación del puntaje) y `sourceId` son para
// depurar el ranking, no para el estudiante, y no tienen por qué viajar en
// cada respuesta del listado.
export interface JobOfferPublic {
  id: string;
  title: string;
  company: string;
  /** Extracto, no la descripción entera — la completa está en `url`. */
  excerpt: string;
  /** Descripcion completa — la tarjeta la muestra al expandirse. */
  description: string;
  url: string;
  /** Logo de la empresa, o null: la UI cae a la inicial. */
  companyLogo: string | null;
  location: string | null;
  kind: string;
  seniority: string;
  workMode: string;
  tags: string[];
  salary: string | null;
  /** Nombre legible de la bolsa — se muestra en la tarjeta (atribución). */
  source: string;
  postedAt: string | null;
  relevance: number;
}

export interface JobListResult {
  jobs: JobOfferPublic[];
  total: number;
  facets: {
    internships: number;
    remote: number;
    ecuador: number;
  };
  /**
   * Cuándo se refrescó el listado por última vez (ISO), o null si no hay
   * ninguna oferta todavía.
   *
   * Sale de `MAX(lastSeenAt)`, que el ingest pone en CADA oferta que vuelve
   * a ver — o sea, es la hora de la última corrida que trajo algo, no un
   * contador aparte que podría quedar desincronizado con los datos reales.
   *
   * Se expone porque un listado de ofertas sin fecha de actualización
   * obliga a adivinar si lo que se está viendo es de hoy o de la semana
   * pasada, justo en un módulo cuyo valor entero es la frescura.
   */
  updatedAt: string | null;
  /** Cada cuánto corre la ingesta automática, en horas. */
  refreshHours: number;
}

const EXCERPT_LENGTH = 280;
export const DEFAULT_LIMIT = 30;

/**
 * Cada cuánto corre la ingesta. Debe coincidir con el `@Cron` de
 * JobIngestService — se expone al frontend para que la página pueda decir
 * "se actualiza cada 3 horas" sin que ese número esté escrito a mano en dos
 * lugares que se pueden desincronizar.
 */
export const REFRESH_HOURS = 3;

/**
 * Etiqueta legible por fuente.
 *
 * Remote OK exige por sus términos que se los mencione como fuente; el
 * resto se muestra por coherencia y porque al estudiante le sirve saber a
 * qué bolsa va a caer antes de hacer clic.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  epn: "Bolsa EPN",
  indeed: "Indeed",
  linkedin: "LinkedIn",
  multitrabajos: "Multitrabajos",
  computrabajo: "Computrabajo",
  remotive: "Remotive",
  remoteok: "Remote OK",
  arbeitnow: "Arbeitnow",
};

@Injectable()
export class JobService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryJobsDto): Promise<JobListResult> {
    const where = buildWhere(query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    // Las facetas se cuentan sobre el MISMO `where` que el listado, no
    // sobre la tabla entera: si el estudiante ya filtró por "React", el
    // contador de pasantías tiene que decir cuántas pasantías de React
    // hay — no cuántas pasantías hay en total, que sería un número que no
    // corresponde a nada de lo que está viendo.
    const [rows, total, internships, remote, ecuador, ultima] = await Promise.all([
      this.prisma.jobOffer.findMany({
        where,
        orderBy: orderBy(query.sort),
        take: limit,
        skip: offset,
      }),
      this.prisma.jobOffer.count({ where }),
      this.prisma.jobOffer.count({ where: { ...where, kind: "INTERNSHIP" } }),
      this.prisma.jobOffer.count({ where: { ...where, workMode: "REMOTE" } }),
      this.prisma.jobOffer.count({ where: { ...where, ...ecuadorFilter() } }),
      // Sobre TODAS las ofertas activas, no sobre las filtradas: "cuándo se
      // actualizó el listado" es una propiedad de la ingesta, no del filtro
      // que el estudiante tenga puesto. Si dependiera del filtro, buscar
      // "java" podría mostrar una fecha más vieja y hacer creer que el
      // módulo está desactualizado.
      this.prisma.jobOffer.aggregate({
        where: { active: true },
        _max: { lastSeenAt: true },
      }),
    ]);

    return {
      jobs: rows.map(toPublic),
      total,
      facets: { internships, remote, ecuador },
      updatedAt: ultima._max.lastSeenAt?.toISOString() ?? null,
      refreshHours: REFRESH_HOURS,
    };
  }

  /** Etiquetas de stack disponibles, con cuántas ofertas activas tiene cada una. */
  async topTags(limit = 20): Promise<{ tag: string; count: number }[]> {
    // `tags` es un array de Postgres, y Prisma no sabe agrupar por elemento
    // de array — de ahí el groupBy en memoria. Es barato porque solo mira
    // las ofertas ACTIVAS (unos cientos como mucho), no el histórico.
    const rows = await this.prisma.jobOffer.findMany({
      where: { active: true },
      select: { tags: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      // Desempate alfabético para que el orden sea estable entre llamadas
      // con los mismos datos — sin él, dos tags con el mismo conteo se
      // intercambiaban de lugar y la UI parpadeaba al refrescar.
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit);
  }
}

function orderBy(sort: QueryJobsDto["sort"]): Prisma.JobOfferOrderByWithRelationInput[] {
  if (sort === "recent") {
    // `nulls: "last"` es imprescindible: en Postgres los NULL ordenan
    // PRIMERO en DESC, así que sin esto "más recientes" abría con las
    // ofertas que no tienen fecha — exactamente al revés de lo pedido.
    return [{ postedAt: { sort: "desc", nulls: "last" } }, { relevance: "desc" }];
  }
  return [{ relevance: "desc" }, { postedAt: { sort: "desc", nulls: "last" } }];
}

function buildWhere(query: QueryJobsDto): Prisma.JobOfferWhereInput {
  const where: Prisma.JobOfferWhereInput = { active: true };

  if (query.kind) where.kind = query.kind;
  if (query.workMode) where.workMode = query.workMode;
  if (query.seniority) where.seniority = query.seniority;
  if (query.tag) where.tags = { has: query.tag };

  if (query.maxAgeDays) {
    // Las ofertas SIN fecha quedan fuera al filtrar por antigüedad, y es a
    // propósito: el filtro existe para responder "¿qué sigue abierto?", y
    // de una oferta sin fecha no se puede afirmar eso. Colarla en "últimos
    // 3 días" sería justamente la mentira que el filtro viene a evitar.
    where.postedAt = { gte: new Date(Date.now() - query.maxAgeDays * 86_400_000) };
  }

  if (query.q) {
    // `mode: "insensitive"` y no un `toLowerCase()` a mano: la columna
    // guarda el texto tal como lo publicó la empresa, con mayúsculas y
    // tildes, y comparar en minúsculas del lado de la app no encontraría
    // "Desarrollador" buscando "desarrollador".
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { company: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
    ];
  }

  if (query.ecuador === true) Object.assign(where, ecuadorFilter());

  return where;
}

/**
 * "Alcanzable desde Ecuador" = está en Ecuador, **o** es remota Y de verdad
 * abierta al mundo.
 *
 * Esa segunda condición no estaba y es la que importa: antes bastaba con
 * `workMode: REMOTE`, y eso dejaba entrar "Remote — Munich" o "Full Remote
 * aus Bayern", que NO quieren decir que contraten desde acá sino "desde tu
 * casa, en Alemania" — piden permiso de trabajo local y casi siempre el
 * idioma. Medido en producción, 10 de las remotas estaban atadas a una
 * ciudad alemana o al Reino Unido, y el filtro las presentaba como
 * tomables.
 *
 * Una remota SIN ubicación sí entra: las bolsas de remoto puro no la
 * publican justamente porque no aplica.
 */
function ecuadorFilter(): Prisma.JobOfferWhereInput {
  return {
    OR: [
      // Remota y abierta: sin lugar declarado, o el lugar dice
      // explícitamente que no está atada a un país.
      {
        workMode: "REMOTE",
        OR: [
          { location: null },
          { location: "" },
          ...GLOBAL_REMOTE_TERMS.map((t) => ({
            location: { contains: t, mode: "insensitive" as const },
          })),
        ],
      },
      // O simplemente está en Ecuador (presencial, híbrida o remota).
      ...ECUADOR_TERMS.map((city) => ({
        location: { contains: city, mode: "insensitive" as const },
      })),
    ],
  };
}

function toPublic(row: {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  companyLogo: string | null;
  location: string | null;
  kind: string;
  seniority: string;
  workMode: string;
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  source: string;
  postedAt: Date | null;
  relevance: number;
}): JobOfferPublic {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    excerpt: excerpt(row.description),
    description: row.description,
    url: row.url,
    companyLogo: row.companyLogo,
    location: row.location,
    kind: row.kind,
    seniority: row.seniority,
    workMode: row.workMode,
    tags: row.tags,
    salary: formatSalary(row.salaryMin, row.salaryMax, row.salaryCurrency),
    source: SOURCE_LABELS[row.source] ?? row.source,
    postedAt: row.postedAt?.toISOString() ?? null,
    relevance: row.relevance,
  };
}

function excerpt(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_LENGTH) return flat;
  const cut = flat.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > EXCERPT_LENGTH * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * Salario legible, o null si la fuente no lo informó.
 *
 * Devolver null y que la UI no muestre nada es deliberado: inventar un
 * "Salario a convenir" donde la fuente simplemente no mandó el dato es
 * afirmar algo que nadie dijo.
 */
export function formatSalary(min: number | null, max: number | null, currency: string | null): string | null {
  if (min === null && max === null) return null;
  const cur = currency ?? "USD";
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

  if (min !== null && max !== null) {
    // Rango de un solo valor: la fuente mandó min == max. Mostrar
    // "$460 - $460" se veía como un error de la app.
    if (min === max) return `${cur} ${fmt(min)}`;
    return `${cur} ${fmt(min)} - ${fmt(max)}`;
  }
  return `${cur} ${min !== null ? `desde ${fmt(min)}` : `hasta ${fmt(max as number)}`}`;
}
