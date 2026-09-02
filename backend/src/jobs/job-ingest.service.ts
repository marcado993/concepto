import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../shared/prisma/prisma.service";
import { collectFromSources, JobSource } from "./sources/job-source";
import { RemoteOkSource } from "./sources/remoteok.source";
import { ArbeitnowSource } from "./sources/arbeitnow.source";
import { RemotiveSource } from "./sources/remotive.source";
import { ScraperSource } from "./sources/scraper.source";
import { dedupeJobs } from "./normalize/dedupe";
import { jobFingerprint, RawJob } from "./normalize/normalize";
import { assessJob, MAX_AGE_DAYS } from "./relevance/job-relevance.engine";

export interface IngestReport {
  fetched: number;
  afterDedupe: number;
  relevant: number;
  created: number;
  updated: number;
  archived: number;
  failedSources: string[];
}

// Orquesta la ingesta: fuentes → dedupe → motor → base.
//
// Corre en el MISMO proceso que sirve la API, igual que
// ResourceMonitorService (ver la nota ahí sobre por qué en este VPS no hay
// un daemon aparte ni una cola). La diferencia es que esto sí hace I/O
// pesado, y por eso todo lo caro está acotado: timeout por fuente, tope de
// resultados por consulta, y un guard de reentrada para que dos corridas
// nunca se solapen.
@Injectable()
export class JobIngestService {
  private readonly logger = new Logger(JobIngestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteok: RemoteOkSource,
    private readonly arbeitnow: ArbeitnowSource,
    private readonly remotive: RemotiveSource,
    private readonly scraper: ScraperSource
  ) {}

  private get sources(): JobSource[] {
    // Los scrapers (Bolsa EPN, Indeed, LinkedIn, Multitrabajos,
    // Computrabajo) solo entran si `JOBS_SCRAPER_URL` está configurado —
    // sin eso el módulo sigue funcionando con las APIs públicas, que es lo
    // que permite correr el backend en local sin levantar el contenedor
    // con Chromium adentro (ver ScraperSource).
    const list: JobSource[] = [this.remoteok, this.arbeitnow, this.remotive];
    if (this.scraper.enabled) list.push(this.scraper);
    return list;
  }

  /**
   * Cada 3 horas — el mismo número que la página le muestra al estudiante
   * ("se actualiza cada 3 h", ver REFRESH_HOURS en job.service.ts). Si este
   * cron cambia, hay que mover esa constante también: prometer una
   * frecuencia distinta de la real es peor que no prometer ninguna.
   *
   * No cada 5 minutos, aunque el pedido dijera "tiempo real": las bolsas
   * publican por lotes (una vacante nueva no aparece a los 5 minutos de
   * escribirla) y raspar más seguido solo consigue el 429 de LinkedIn y que
   * bloqueen la IP del VPS. Cada 3 h el listado nunca está a más de 3 h de
   * la realidad, que para postular a una pasantía es tiempo real de sobra,
   * y mantiene al scraper por debajo del radar de rate limiting.
   */
  @Cron(CronExpression.EVERY_3_HOURS)
  async scheduledIngest(): Promise<void> {
    await this.ingest();
  }

  /**
   * Una corrida completa.
   *
   * @param now Reloj inyectado — el motor puntúa por frescura, así que
   *            poder fijarlo es lo que hace testeable la ingesta entera.
   */
  async ingest(now: Date = new Date()): Promise<IngestReport> {
    // Guard de reentrada: una corrida puede tardar minutos (el scraper hace
    // varias consultas reales). Sin esto, un disparo manual desde el panel
    // durante la corrida programada duplicaba el trabajo y el consumo de
    // cuota contra las bolsas.
    if (this.running) {
      this.logger.warn("Ingesta ya en curso — se omite este disparo");
      return emptyReport(["ya-en-curso"]);
    }
    this.running = true;

    try {
      const { jobs: fetched, failed } = await collectFromSources(this.sources, this.logger);
      const deduped = dedupeJobs(fetched);

      let created = 0;
      let updated = 0;
      let relevant = 0;

      for (const raw of deduped) {
        const assessment = assessJob(
          {
            title: raw.title,
            company: raw.company,
            description: raw.description,
            location: raw.location,
            declaredRemote: raw.remote,
            declaredKind: raw.kind,
            postedAt: raw.postedAt,
          },
          now
        );

        // Se filtra en la INGESTA y no en la consulta: guardar la basura
        // significaría pagar disco y tiempo de query para siempre por algo
        // que ningún estudiante va a querer ver (ver RELEVANCE_FLOOR).
        if (!assessment.relevant) continue;
        relevant += 1;

        const wasCreated = await this.upsert(raw, assessment, now);
        if (wasCreated) created += 1;
        else updated += 1;
      }

      const archived = await this.archiveStale(now);

      const report: IngestReport = {
        fetched: fetched.length,
        afterDedupe: deduped.length,
        relevant,
        created,
        updated,
        archived,
        failedSources: failed,
      };
      this.logger.log(`Ingesta: ${JSON.stringify(report)}`);
      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * Inserta o actualiza una oferta. Devuelve true si fue alta nueva.
   *
   * `firstSeenAt` NO se toca al actualizar: es el dato que dice hace cuánto
   * la asociación conoce esa vacante, y pisarlo en cada corrida borraba esa
   * historia y hacía que toda oferta pareciera recién descubierta.
   */
  private async upsert(
    raw: RawJob,
    assessment: ReturnType<typeof assessJob>,
    now: Date
  ): Promise<boolean> {
    const fingerprint = jobFingerprint(raw);

    const common = {
      source: raw.source,
      sourceId: raw.sourceId,
      url: raw.url,
      companyLogo: raw.companyLogo ?? null,
      title: raw.title,
      company: raw.company,
      description: raw.description,
      location: raw.location,
      kind: assessment.kind,
      seniority: assessment.seniority,
      workMode: assessment.workMode,
      salaryMin: raw.salaryMin,
      salaryMax: raw.salaryMax,
      salaryCurrency: raw.salaryCurrency,
      tags: assessment.tags,
      relevance: assessment.score,
      reasons: assessment.reasons,
      postedAt: raw.postedAt,
      lastSeenAt: now,
      // Reactivar es intencional: una oferta archivada que vuelve a
      // aparecer en la fuente es una oferta que sigue abierta.
      active: true,
    };

    const existing = await this.prisma.jobOffer.findUnique({
      where: { fingerprint },
      select: { id: true },
    });

    await this.prisma.jobOffer.upsert({
      where: { fingerprint },
      create: { fingerprint, firstSeenAt: now, ...common },
      update: common,
    });

    return existing === null;
  }

  /**
   * Archiva lo que ya no debería mostrarse.
   *
   * Dos criterios distintos, y los dos hacen falta:
   *  - `lastSeenAt` viejo ⇒ la oferta desapareció de las fuentes, casi
   *    siempre porque la vacante se llenó. Es la señal más fuerte.
   *  - `postedAt` viejo ⇒ sigue publicada pero lleva meses; la empresa
   *    simplemente no la bajó. Pasa mucho en las bolsas locales.
   *
   * Se archiva (active=false) en vez de borrar: así `firstSeenAt` y el
   * histórico quedan, y si la vacante reaparece se reactiva sin perder
   * desde cuándo se la conoce.
   */
  private async archiveStale(now: Date): Promise<number> {
    const unseenCutoff = new Date(now.getTime() - 7 * 86_400_000);
    const postedCutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000);

    const { count } = await this.prisma.jobOffer.updateMany({
      where: {
        active: true,
        OR: [{ lastSeenAt: { lt: unseenCutoff } }, { postedAt: { lt: postedCutoff } }],
      },
      data: { active: false },
    });
    return count;
  }
}

function emptyReport(failedSources: string[]): IngestReport {
  return { fetched: 0, afterDedupe: 0, relevant: 0, created: 0, updated: 0, archived: 0, failedSources };
}
