import { Test } from "@nestjs/testing";
import { JobService, formatSalary, DEFAULT_LIMIT } from "./job.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { QueryJobsDto } from "./dto/query-jobs.dto";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Desarrollador Backend",
    company: "Acme",
    description: "Node y PostgreSQL",
    url: "https://example.com/1",
    location: "Quito, Ecuador",
    kind: "FULL_TIME",
    seniority: "JUNIOR",
    workMode: "ONSITE",
    tags: ["Node.js", "PostgreSQL"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    source: "indeed",
    companyLogo: null,
    postedAt: new Date("2026-08-30T00:00:00Z"),
    relevance: 72,
    ...overrides,
  };
}

async function buildService(rows: ReturnType<typeof row>[] = [row()]) {
  const prisma = {
    jobOffer: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [JobService, { provide: PrismaService, useValue: prisma }],
  }).compile();

  return { service: moduleRef.get(JobService), prisma };
}

describe("JobService.list — filtros", () => {
  it("Dada una consulta sin filtros, Cuando se lista, Entonces solo trae las ofertas ACTIVAS", async () => {
    const { service, prisma } = await buildService();

    await service.list({} as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].where.active).toBe(true);
  });

  it("Dado kind=INTERNSHIP, Cuando se lista, Entonces filtra por pasantias", async () => {
    const { service, prisma } = await buildService();

    await service.list({ kind: "INTERNSHIP" } as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].where.kind).toBe("INTERNSHIP");
  });

  it("Dado un tag, Cuando se lista, Entonces filtra por el array de tags con 'has'", async () => {
    const { service, prisma } = await buildService();

    await service.list({ tag: "Java" } as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].where.tags).toEqual({ has: "Java" });
  });

  // La columna guarda el texto tal como lo publico la empresa, con
  // mayusculas y tildes: comparar en minusculas del lado de la app no
  // encontraria "Desarrollador" buscando "desarrollador".
  it("Dada una busqueda libre, Cuando se lista, Entonces busca en titulo/empresa/descripcion sin distinguir mayusculas", async () => {
    const { service, prisma } = await buildService();

    await service.list({ q: "java" } as QueryJobsDto);

    const or = prisma.jobOffer.findMany.mock.calls[0][0].where.OR;
    expect(or).toHaveLength(3);
    expect(or[0].title).toEqual({ contains: "java", mode: "insensitive" });
  });

  // Para un estudiante en Quito, una vacante remota de una empresa
  // extranjera es tan tomable como una de Quito. Dejarla fuera de este
  // filtro escondia la mitad de lo que si puede conseguir.
  it("Dado ecuador=true, Cuando se lista, Entonces incluye tambien las REMOTAS y no solo las locales", async () => {
    const { service, prisma } = await buildService();

    await service.list({ ecuador: true } as QueryJobsDto);

    const or = prisma.jobOffer.findMany.mock.calls[0][0].where.OR;
    expect(or).toContainEqual({ workMode: "REMOTE" });
    expect(or.some((c: any) => c.location?.contains === "quito")).toBe(true);
  });

  it("Dado ecuador=false, Cuando se lista, Entonces NO aplica el filtro de ubicacion", async () => {
    const { service, prisma } = await buildService();

    await service.list({ ecuador: false } as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});

describe("JobService.list — orden", () => {
  it("Dado el orden por defecto, Cuando se lista, Entonces ordena por relevancia descendente", async () => {
    const { service, prisma } = await buildService();

    await service.list({} as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].orderBy[0]).toEqual({ relevance: "desc" });
  });

  // En Postgres los NULL ordenan PRIMERO en DESC: sin nulls:"last", "mas
  // recientes" abria con las ofertas SIN fecha — al reves de lo pedido.
  it("Dado sort=recent, Cuando se lista, Entonces las ofertas sin fecha van al FINAL", async () => {
    const { service, prisma } = await buildService();

    await service.list({ sort: "recent" } as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].orderBy[0]).toEqual({
      postedAt: { sort: "desc", nulls: "last" },
    });
  });
});

describe("JobService.list — paginacion", () => {
  it("Dada una consulta sin limit, Cuando se lista, Entonces usa el limite por defecto", async () => {
    const { service, prisma } = await buildService();

    await service.list({} as QueryJobsDto);

    expect(prisma.jobOffer.findMany.mock.calls[0][0].take).toBe(DEFAULT_LIMIT);
  });

  it("Dado limit y offset, Cuando se lista, Entonces los pasa a la consulta", async () => {
    const { service, prisma } = await buildService();

    await service.list({ limit: 10, offset: 20 } as QueryJobsDto);

    const args = prisma.jobOffer.findMany.mock.calls[0][0];
    expect(args.take).toBe(10);
    expect(args.skip).toBe(20);
  });
});

describe("JobService.list — facetas", () => {
  // Si el estudiante ya filtro por "React", el contador de pasantias tiene
  // que decir cuantas pasantias DE REACT hay — no cuantas hay en total, que
  // seria un numero que no corresponde a nada de lo que esta viendo.
  it("Dado un filtro activo, Cuando se cuentan las facetas, Entonces respetan ese mismo filtro", async () => {
    const { service, prisma } = await buildService();

    await service.list({ tag: "React" } as QueryJobsDto);

    const facetCalls = prisma.jobOffer.count.mock.calls.slice(1);
    for (const [args] of facetCalls) {
      expect(args.where.tags).toEqual({ has: "React" });
    }
  });

  it("Dada una consulta, Cuando se lista, Entonces devuelve total y las tres facetas", async () => {
    const { service } = await buildService();

    const result = await service.list({} as QueryJobsDto);

    expect(result).toHaveProperty("total");
    expect(result.facets).toEqual(
      expect.objectContaining({ internships: expect.any(Number), remote: expect.any(Number), ecuador: expect.any(Number) })
    );
  });
});

describe("JobService.list — vista publica", () => {
  // `reasons` y `sourceId` son para depurar el ranking, no para el
  // estudiante, y no tienen por que viajar en cada respuesta del listado.
  it("Dada una oferta, Cuando se expone, Entonces NO se filtran los internos del ranking", async () => {
    const { service } = await buildService();

    const [job] = (await service.list({} as QueryJobsDto)).jobs;

    expect(job).not.toHaveProperty("reasons");
    expect(job).not.toHaveProperty("sourceId");
    expect(job).not.toHaveProperty("fingerprint");
  });

  // La tarjeta se expande en el propio listado para leer de que va la
  // oferta sin salir de la app, asi que necesita AMBOS: el extracto para el
  // estado plegado y la descripcion completa para el desplegado.
  it("Dada una oferta, Cuando se expone, Entonces trae el extracto Y la descripcion completa", async () => {
    const largo = "palabra ".repeat(200);
    const { service } = await buildService([row({ description: largo })]);

    const [job] = (await service.list({} as QueryJobsDto)).jobs;

    expect(job.excerpt.length).toBeLessThan(job.description.length);
    expect(job.description).toBe(largo);
  });

  // Reconocer un logo es mas rapido que leer un nombre al escanear decenas
  // de ofertas; cuando la fuente no lo trae, la UI cae a la inicial.
  it("Dada una oferta con logo, Cuando se expone, Entonces el logo viaja al frontend", async () => {
    const { service } = await buildService([row({ companyLogo: "https://cdn.example.com/acme.png" })]);

    expect((await service.list({} as QueryJobsDto)).jobs[0].companyLogo).toContain("acme.png");
  });

  it("Dada una oferta sin logo, Cuando se expone, Entonces companyLogo es null y no una cadena vacia", async () => {
    expect((await (await buildService()).service.list({} as QueryJobsDto)).jobs[0].companyLogo).toBeNull();
  });

  // Remote OK exige por sus terminos que se los mencione como fuente.
  it("Dada una oferta, Cuando se expone, Entonces la fuente sale con su nombre legible", async () => {
    const { service } = await buildService([row({ source: "remoteok" })]);

    expect((await service.list({} as QueryJobsDto)).jobs[0].source).toBe("Remote OK");
  });

  it("Dada una fuente desconocida, Cuando se expone, Entonces muestra la clave cruda en vez de quedar vacia", async () => {
    const { service } = await buildService([row({ source: "bolsa-nueva" })]);

    expect((await service.list({} as QueryJobsDto)).jobs[0].source).toBe("bolsa-nueva");
  });

  it("Dada una descripcion larga, Cuando se expone, Entonces se recorta a un extracto", async () => {
    const { service } = await buildService([row({ description: "palabra ".repeat(200) })]);

    const [job] = (await service.list({} as QueryJobsDto)).jobs;
    expect(job.excerpt.length).toBeLessThanOrEqual(281);
    expect(job.excerpt).toMatch(/…$/);
  });

  it("Dada una descripcion corta, Cuando se expone, Entonces no le agrega elipsis", async () => {
    const { service } = await buildService([row({ description: "Node y SQL" })]);

    expect((await service.list({} as QueryJobsDto)).jobs[0].excerpt).toBe("Node y SQL");
  });

  it("Dada una oferta sin fecha, Cuando se expone, Entonces postedAt es null y no rompe", async () => {
    const { service } = await buildService([row({ postedAt: null })]);

    expect((await service.list({} as QueryJobsDto)).jobs[0].postedAt).toBeNull();
  });
});

describe("formatSalary", () => {
  // Inventar un "Salario a convenir" donde la fuente no mando el dato es
  // afirmar algo que nadie dijo.
  it("Dado ningun dato de salario, Cuando se formatea, Entonces devuelve null y la UI no muestra nada", () => {
    expect(formatSalary(null, null, null)).toBeNull();
  });

  it("Dado un rango, Cuando se formatea, Entonces lo abrevia en miles", () => {
    expect(formatSalary(60000, 90000, "USD")).toBe("USD 60k - 90k");
  });

  // La fuente manda min == max cuando publica un sueldo fijo. Mostrar
  // "$460 - $460" se veia como un error de la app.
  it("Dado min igual a max, Cuando se formatea, Entonces muestra un solo valor y no un rango", () => {
    expect(formatSalary(460, 460, "USD")).toBe("USD 460");
  });

  it("Dado solo el minimo, Cuando se formatea, Entonces dice 'desde'", () => {
    expect(formatSalary(460, null, "USD")).toBe("USD desde 460");
  });

  it("Dado solo el maximo, Cuando se formatea, Entonces dice 'hasta'", () => {
    expect(formatSalary(null, 2000, "USD")).toBe("USD hasta 2k");
  });

  it("Dada una moneda ausente, Cuando se formatea, Entonces asume USD — es la moneda de Ecuador", () => {
    expect(formatSalary(1000, null, null)).toBe("USD desde 1k");
  });
});

describe("JobService.topTags", () => {
  it("Dadas ofertas con tags repetidos, Cuando se cuentan, Entonces devuelve cada tag una vez con su total", async () => {
    const prisma = {
      jobOffer: {
        findMany: jest.fn().mockResolvedValue([{ tags: ["Java", "SQL"] }, { tags: ["Java"] }, { tags: ["React"] }]),
        count: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [JobService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    const tags = await moduleRef.get(JobService).topTags();

    expect(tags[0]).toEqual({ tag: "Java", count: 2 });
    expect(tags).toHaveLength(3);
  });

  // Sin el desempate alfabetico, dos tags con el mismo conteo se
  // intercambiaban de lugar entre llamadas y la UI parpadeaba al refrescar.
  it("Dados tags con el mismo conteo, Cuando se ordenan, Entonces el orden es estable (alfabetico)", async () => {
    const prisma = {
      jobOffer: {
        findMany: jest.fn().mockResolvedValue([{ tags: ["Zig", "Ada"] }]),
        count: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [JobService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    expect((await moduleRef.get(JobService).topTags()).map((t) => t.tag)).toEqual(["Ada", "Zig"]);
  });

  it("Dado que no hay ofertas, Cuando se cuentan los tags, Entonces devuelve lista vacia", async () => {
    const prisma = { jobOffer: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [JobService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    expect(await moduleRef.get(JobService).topTags()).toEqual([]);
  });
});
