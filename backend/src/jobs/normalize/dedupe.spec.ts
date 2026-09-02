import { dedupeJobs, sourcePriority } from "./dedupe";
import type { RawJob } from "./normalize";

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: "remotive",
    sourceId: "1",
    title: "Backend Developer",
    company: "Acme S.A.",
    description: "Node y SQL",
    url: "https://example.com/1",
    location: "Quito",
    remote: null,
    kind: null,
    postedAt: new Date("2026-08-20T00:00:00Z"),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    ...overrides,
  };
}

describe("dedupeJobs", () => {
  it("Dada la misma vacante en tres bolsas, Cuando se deduplica, Entonces queda UNA sola fila", () => {
    const out = dedupeJobs([
      raw({ source: "jobspy:linkedin", sourceId: "a", title: "Backend Developer (Remote)" }),
      raw({ source: "jobspy:indeed", sourceId: "b", company: "ACME" }),
      raw({ source: "remotive", sourceId: "c" }),
    ]);

    expect(out).toHaveLength(1);
  });

  it("Dadas ofertas distintas, Cuando se deduplica, Entonces las conserva todas", () => {
    const out = dedupeJobs([
      raw({ sourceId: "a", title: "Backend Developer" }),
      raw({ sourceId: "b", title: "Frontend Developer" }),
      raw({ sourceId: "c", company: "Beta" }),
    ]);

    expect(out).toHaveLength(3);
  });

  // Tener fecha manda sobre la prioridad de la fuente: el motor castiga la
  // ausencia de fecha, asi que quedarse con la version fechada mejora el
  // ranking real aunque venga de una bolsa de menor prioridad.
  it("Dada una duplicada donde solo la fuente de MENOR prioridad trae fecha, Cuando se deduplica, Entonces gana la que tiene fecha", () => {
    const out = dedupeJobs([
      raw({ source: "remotive", sourceId: "sin-fecha", postedAt: null }),
      raw({ source: "jobspy:linkedin", sourceId: "con-fecha", postedAt: new Date("2026-08-25T00:00:00Z") }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe("con-fecha");
  });

  it("Dada una duplicada donde ambas traen fecha, Cuando se deduplica, Entonces gana la fuente de mayor prioridad", () => {
    const out = dedupeJobs([
      raw({ source: "jobspy:linkedin", sourceId: "linkedin" }),
      raw({ source: "remotive", sourceId: "remotive" }),
    ]);

    expect(out[0].sourceId).toBe("remotive");
  });

  it("Dada una duplicada de la misma fuente, Cuando se deduplica, Entonces gana la de descripcion mas larga", () => {
    const out = dedupeJobs([
      raw({ sourceId: "corta", description: "Node" }),
      raw({ sourceId: "larga", description: "Node, SQL, Docker y AWS con equipo distribuido" }),
    ]);

    expect(out[0].sourceId).toBe("larga");
  });

  // Un orden estable hace reproducible el resultado del ingest — si
  // dependiera del orden interno de un Map, el mismo lote podria guardarse
  // distinto en dos corridas.
  it("Dado un lote mezclado, Cuando se deduplica, Entonces respeta el orden de PRIMERA aparicion", () => {
    const out = dedupeJobs([
      raw({ sourceId: "1", title: "Frontend Developer" }),
      raw({ sourceId: "2", title: "Backend Developer" }),
      raw({ sourceId: "3", title: "Frontend Developer (Remote)" }),
    ]);

    expect(out.map((j) => j.title)).toEqual(["Frontend Developer", "Backend Developer"]);
  });

  it("Dado un lote vacio, Cuando se deduplica, Entonces devuelve vacio sin romper", () => {
    expect(dedupeJobs([])).toEqual([]);
  });
});

describe("sourcePriority", () => {
  it("Dada una fuente conocida, Cuando se consulta, Entonces devuelve su prioridad", () => {
    expect(sourcePriority("remotive")).toBeGreaterThan(sourcePriority("jobspy:linkedin"));
  });

  // Indeed es, segun el propio README de JobSpy, el scraper mas estable;
  // LinkedIn el que mas se rompe y el que recorta la descripcion.
  it("Dado jobspy:indeed frente a jobspy:linkedin, Cuando se comparan, Entonces indeed tiene mas prioridad", () => {
    expect(sourcePriority("jobspy:indeed")).toBeGreaterThan(sourcePriority("jobspy:linkedin"));
  });

  it("Dada una fuente desconocida, Cuando se consulta, Entonces vale 0 y nunca le gana a una conocida", () => {
    expect(sourcePriority("bolsa-nueva")).toBe(0);
    expect(sourcePriority("bolsa-nueva")).toBeLessThan(sourcePriority("jobspy:linkedin"));
  });
});
