import { Test } from "@nestjs/testing";
import { JobIngestService } from "./job-ingest.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { RemoteOkSource } from "./sources/remoteok.source";
import { ArbeitnowSource } from "./sources/arbeitnow.source";
import { RemotiveSource } from "./sources/remotive.source";
import { ScraperSource } from "./sources/scraper.source";
import type { RawJob } from "./normalize/normalize";

const NOW = new Date("2026-09-01T12:00:00Z");

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: "remoteok",
    sourceId: "1",
    title: "Desarrollador Backend",
    company: "Acme",
    description: "Node y PostgreSQL",
    url: "https://example.com/1",
    location: "Quito, Ecuador",
    remote: null,
    kind: null,
    postedAt: new Date("2026-08-31T00:00:00Z"),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    ...overrides,
  };
}

function buildPrisma() {
  return {
    jobOffer: {
      findUnique: jest.fn().mockResolvedValue(null), // por defecto: alta nueva
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn(),
    },
  };
}

async function buildService(opts: {
  prisma?: ReturnType<typeof buildPrisma>;
  remoteokJobs?: RawJob[] | Error;
  scraperEnabled?: boolean;
  scraperJobs?: RawJob[] | Error;
}) {
  const prisma = opts.prisma ?? buildPrisma();

  const source = (jobs: RawJob[] | Error | undefined, name: string) => ({
    name,
    fetchJobs: jest.fn(async () => {
      if (jobs instanceof Error) throw jobs;
      return jobs ?? [];
    }),
  });

  const moduleRef = await Test.createTestingModule({
    providers: [
      JobIngestService,
      { provide: PrismaService, useValue: prisma },
      { provide: RemoteOkSource, useValue: source(opts.remoteokJobs, "remoteok") },
      { provide: ArbeitnowSource, useValue: source([], "arbeitnow") },
      { provide: RemotiveSource, useValue: source([], "remotive") },
      {
        provide: ScraperSource,
        useValue: { ...source(opts.scraperJobs, "scraper"), enabled: opts.scraperEnabled ?? false },
      },
    ],
  }).compile();

  return { service: moduleRef.get(JobIngestService), prisma };
}

describe("JobIngestService.ingest — camino feliz", () => {
  it("Dada una oferta relevante, Cuando se ingesta, Entonces se guarda y se reporta como alta nueva", async () => {
    const { service, prisma } = await buildService({ remoteokJobs: [raw()] });

    const report = await service.ingest(NOW);

    expect(report.created).toBe(1);
    expect(report.updated).toBe(0);
    expect(prisma.jobOffer.upsert).toHaveBeenCalledTimes(1);
  });

  it("Dada una oferta ya conocida, Cuando se ingesta de nuevo, Entonces cuenta como actualizacion y no como alta", async () => {
    const prisma = buildPrisma();
    prisma.jobOffer.findUnique.mockResolvedValue({ id: "existente" });
    const { service } = await buildService({ prisma, remoteokJobs: [raw()] });

    const report = await service.ingest(NOW);

    expect(report.created).toBe(0);
    expect(report.updated).toBe(1);
  });

  // `firstSeenAt` dice hace cuanto la asociacion conoce esa vacante.
  // Pisarlo en cada corrida borraba esa historia y hacia que TODA oferta
  // pareciera recien descubierta.
  it("Dada una oferta ya conocida, Cuando se actualiza, Entonces firstSeenAt NO se toca", async () => {
    const prisma = buildPrisma();
    prisma.jobOffer.findUnique.mockResolvedValue({ id: "existente" });
    const { service } = await buildService({ prisma, remoteokJobs: [raw()] });

    await service.ingest(NOW);

    const args = prisma.jobOffer.upsert.mock.calls[0][0];
    expect(args.create.firstSeenAt).toEqual(NOW);
    expect(args.update).not.toHaveProperty("firstSeenAt");
  });

  it("Dada una oferta vista de nuevo, Cuando se actualiza, Entonces lastSeenAt queda en el ahora inyectado", async () => {
    const { service, prisma } = await buildService({ remoteokJobs: [raw()] });

    await service.ingest(NOW);

    expect(prisma.jobOffer.upsert.mock.calls[0][0].update.lastSeenAt).toEqual(NOW);
  });

  // Una oferta archivada que vuelve a aparecer en la fuente es una oferta
  // que sigue abierta.
  it("Dada una oferta archivada que reaparece, Cuando se ingesta, Entonces vuelve a active=true", async () => {
    const { service, prisma } = await buildService({ remoteokJobs: [raw()] });

    await service.ingest(NOW);

    expect(prisma.jobOffer.upsert.mock.calls[0][0].update.active).toBe(true);
  });

  it("Dada una oferta, Cuando se ingesta, Entonces se guarda con lo que decidio el motor (kind, tags, relevancia)", async () => {
    const { service, prisma } = await buildService({
      remoteokJobs: [raw({ title: "Pasante de Desarrollo Java" })],
    });

    await service.ingest(NOW);

    const data = prisma.jobOffer.upsert.mock.calls[0][0].create;
    expect(data.kind).toBe("INTERNSHIP");
    expect(data.tags).toContain("Java");
    expect(data.relevance).toBeGreaterThan(0);
    expect(data.reasons.length).toBeGreaterThan(0);
  });
});

describe("JobIngestService.ingest — filtrado y dedupe", () => {
  // Se filtra en la INGESTA y no en la consulta: guardar la basura seria
  // pagar disco y tiempo de query para siempre por algo que ningun
  // estudiante va a querer ver.
  it("Dada una oferta irrelevante, Cuando se ingesta, Entonces NO se guarda", async () => {
    const { service, prisma } = await buildService({
      remoteokJobs: [raw({ title: "Asesor Comercial", description: "Ventas puerta a puerta" })],
    });

    const report = await service.ingest(NOW);

    expect(report.relevant).toBe(0);
    expect(prisma.jobOffer.upsert).not.toHaveBeenCalled();
  });

  // Hueco real: al ajustar el motor, las ofertas YA guardadas conservaban
  // su puntaje viejo porque el bucle hacia `continue` sin tocarlas. Un
  // aviso que habia llegado al tope con las reglas viejas seguia visible
  // hasta que el barrido por antiguedad lo alcanzara, dias despues.
  it("Dada una oferta ya guardada que el motor deja de aprobar, Cuando se ingesta, Entonces se da de baja en el acto", async () => {
    const prisma = buildPrisma();
    prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
    const { service } = await buildService({
      prisma,
      remoteokJobs: [raw({ title: "Asesor Comercial", description: "Ventas puerta a puerta." })],
    });

    const report = await service.ingest(NOW);

    expect(report.deactivated).toBe(1);
    // La baja apunta a la huella de ESA oferta y solo a filas activas.
    const llamada = prisma.jobOffer.updateMany.mock.calls[0][0];
    expect(llamada.where).toEqual(expect.objectContaining({ active: true }));
    expect(llamada.where.fingerprint).toBeDefined();
    expect(llamada.data).toEqual({ active: false });
  });

  it("Dada una oferta irrelevante que NUNCA estuvo guardada, Cuando se ingesta, Entonces no cuenta como baja", async () => {
    const prisma = buildPrisma();
    prisma.jobOffer.updateMany.mockResolvedValue({ count: 0 });
    const { service } = await buildService({
      prisma,
      remoteokJobs: [raw({ title: "Asesor Comercial", description: "Ventas." })],
    });

    expect((await service.ingest(NOW)).deactivated).toBe(0);
  });

  it("Dada la misma vacante desde dos bolsas, Cuando se ingesta, Entonces se guarda UNA sola vez", async () => {
    const { service, prisma } = await buildService({
      remoteokJobs: [
        raw({ source: "remoteok", sourceId: "a" }),
        raw({ source: "indeed", sourceId: "b", title: "Desarrollador Backend (Remote)" }),
      ],
    });

    const report = await service.ingest(NOW);

    expect(report.fetched).toBe(2);
    expect(report.afterDedupe).toBe(1);
    expect(prisma.jobOffer.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("JobIngestService.ingest — resiliencia", () => {
  // El modo de falla mas caro de un agregador: UNA bolsa caida deja el
  // listado sin actualizar para todos.
  it("Dada una fuente caida, Cuando se ingesta, Entonces la corrida sigue y la reporta como fallida", async () => {
    const { service } = await buildService({ remoteokJobs: new Error("HTTP 429") });

    const report = await service.ingest(NOW);

    expect(report.failedSources).toContain("remoteok");
    expect(report.fetched).toBe(0);
  });

  // Sin este guard, un disparo manual desde el panel durante la corrida
  // programada duplicaba el trabajo y el consumo de cuota contra las bolsas.
  it("Dada una ingesta en curso, Cuando se dispara otra, Entonces la segunda se omite en vez de solaparse", async () => {
    const prisma = buildPrisma();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    prisma.jobOffer.upsert.mockImplementation(async () => {
      await gate;
      return {};
    });
    const { service } = await buildService({ prisma, remoteokJobs: [raw()] });

    const first = service.ingest(NOW);
    const second = await service.ingest(NOW);

    expect(second.failedSources).toContain("ya-en-curso");
    expect(second.created).toBe(0);

    release();
    await first;
  });

  it("Dada una ingesta que termino, Cuando se dispara otra, Entonces el guard ya se libero y SI corre", async () => {
    const { service, prisma } = await buildService({ remoteokJobs: [raw()] });

    await service.ingest(NOW);
    await service.ingest(NOW);

    expect(prisma.jobOffer.upsert).toHaveBeenCalledTimes(2);
  });

  // Sin JOBS_SCRAPER_URL el modulo tiene que seguir funcionando con las
  // APIs publicas — el entorno de desarrollo no levanta el contenedor
  // Python.
  it("Dados los scrapers desactivados, Cuando se ingesta, Entonces no se los consulta y las APIs publicas igual corren", async () => {
    const { service } = await buildService({
      remoteokJobs: [raw()],
      scraperEnabled: false,
      scraperJobs: new Error("no deberia llamarse"),
    });

    const report = await service.ingest(NOW);

    expect(report.failedSources).toEqual([]);
    expect(report.created).toBe(1);
  });

  it("Dados los scrapers activados, Cuando se ingesta, Entonces sus ofertas (Bolsa EPN, Multitrabajos...) tambien entran", async () => {
    const { service } = await buildService({
      remoteokJobs: [],
      scraperEnabled: true,
      scraperJobs: [raw({ source: "epn", title: "Pasante de QA" })],
    });

    const report = await service.ingest(NOW);

    expect(report.created).toBe(1);
  });
});

describe("JobIngestService.ingest — archivado", () => {
  it("Dada una corrida, Cuando termina, Entonces archiva por no-vista-hace-7-dias O publicada-hace-mucho", async () => {
    const { service, prisma } = await buildService({ remoteokJobs: [] });
    prisma.jobOffer.updateMany.mockResolvedValue({ count: 4 });

    const report = await service.ingest(NOW);

    expect(report.archived).toBe(4);
    const where = prisma.jobOffer.updateMany.mock.calls[0][0].where;
    expect(where.active).toBe(true);
    expect(where.OR).toHaveLength(2);
  });

  // Archivar y no borrar: asi firstSeenAt y el historico quedan, y si la
  // vacante reaparece se reactiva sin perder desde cuando se la conoce.
  it("Dada una oferta obsoleta, Cuando se archiva, Entonces se marca inactiva y NUNCA se borra la fila", async () => {
    const { service, prisma } = await buildService({ remoteokJobs: [] });

    await service.ingest(NOW);

    expect(prisma.jobOffer.updateMany.mock.calls[0][0].data).toEqual({ active: false });
    expect(prisma.jobOffer).not.toHaveProperty("deleteMany.mock.calls.0");
  });
});
