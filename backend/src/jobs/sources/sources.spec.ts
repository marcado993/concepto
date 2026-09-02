import { Logger } from "@nestjs/common";
import { parseRemoteOk } from "./remoteok.source";
import { parseArbeitnow } from "./arbeitnow.source";
import { parseRemotive } from "./remotive.source";
import { parseJobSpy } from "./jobspy.source";
import { collectFromSources, JobSource } from "./job-source";
import type { RawJob } from "../normalize/normalize";

// Los payloads de abajo son la forma REAL de cada API, verificada contra el
// servicio en vivo al escribir el adaptador — no una invención. Testear el
// parseo contra estos fixtures, y no contra la red, es lo que hace que la
// suite no dependa de que una bolsa esté arriba un lunes cualquiera.

describe("parseRemoteOk", () => {
  // El primer elemento del array de Remote OK NO es una oferta: es un
  // objeto de metadatos con `legal` y `last_updated`. Tratarlo como oferta
  // metia una fila fantasma sin empresa ni titulo en CADA corrida.
  const payload = [
    { last_updated: 1788310438, legal: "API Terms of Service: Please link back..." },
    {
      slug: "backend-dev-acme-1137251",
      id: "1137251",
      epoch: 1788241696,
      date: "2026-09-01T05:48:16+00:00",
      company: "Acme",
      position: "Backend Developer",
      tags: ["full time", "backend"],
      location: "Worldwide",
      url: "https://remoteOK.com/remote-jobs/backend-dev-acme-1137251",
      description: "<p>Node y <strong>PostgreSQL</strong></p>",
      salary_min: 60000,
      salary_max: 90000,
    },
  ];

  it("Dado el payload real, Cuando se parsea, Entonces descarta el objeto legal y deja solo las ofertas", () => {
    const jobs = parseRemoteOk(payload);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Backend Developer");
  });

  it("Dado el payload real, Cuando se parsea, Entonces marca remote=true — toda la bolsa es remota", () => {
    expect(parseRemoteOk(payload)[0].remote).toBe(true);
  });

  it("Dada una descripcion con HTML, Cuando se parsea, Entonces queda en texto plano", () => {
    expect(parseRemoteOk(payload)[0].description).toBe("Node y PostgreSQL");
  });

  // Sus terminos exigen enlazar de vuelta a la oferta en remoteok.com o
  // suspenden el acceso a la API. La URL guardada tiene que ser la de ellos.
  it("Dado el payload real, Cuando se parsea, Entonces conserva la URL de Remote OK (atribucion obligatoria por sus terminos)", () => {
    expect(parseRemoteOk(payload)[0].url).toContain("remoteOK.com");
  });

  // salary_min: 0 en esta API significa "no informado", no "sueldo cero".
  it("Dado salary_min=0, Cuando se parsea, Entonces guarda null y no 0 — la UI no debe mostrar '$0'", () => {
    const jobs = parseRemoteOk([{ ...payload[1], salary_min: 0, salary_max: 0 }]);

    expect(jobs[0].salaryMin).toBeNull();
    expect(jobs[0].salaryCurrency).toBeNull();
  });

  it.each([[null], [undefined], [{}], ["texto"], [42]])(
    "Dado el payload invalido %p, Cuando se parsea, Entonces devuelve [] en vez de reventar",
    (bad) => {
      expect(parseRemoteOk(bad)).toEqual([]);
    }
  );

  it("Dada una fila sin url, Cuando se parsea, Entonces se descarta — sin link la oferta es inservible", () => {
    expect(parseRemoteOk([{ ...payload[1], url: undefined, apply_url: undefined }])).toEqual([]);
  });
});

describe("parseArbeitnow", () => {
  const payload = {
    data: [
      {
        slug: "backend-dev-berlin-268769",
        company_name: "Mauser GmbH",
        title: "Backend Developer",
        description: "<p>Java und Spring</p>",
        remote: true,
        url: "https://www.arbeitnow.com/jobs/backend-dev-berlin-268769",
        tags: ["Engineering"],
        job_types: ["internship"],
        location: "Berlin",
        created_at: 1788328830,
      },
    ],
  };

  it("Dado el payload real, Cuando se parsea, Entonces extrae la oferta", () => {
    const jobs = parseArbeitnow(payload);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe("Mauser GmbH");
  });

  // created_at viene en SEGUNDOS. Interpretarlo como ms mandaba la bolsa
  // entera a 1970 y el motor la archivaba completa por "antigua".
  it("Dado created_at en segundos, Cuando se parsea, Entonces da una fecha de 2026 y no de 1970", () => {
    expect(parseArbeitnow(payload)[0].postedAt?.getUTCFullYear()).toBe(2026);
  });

  it("Dado job_types=['internship'], Cuando se parsea, Entonces kind=INTERNSHIP", () => {
    expect(parseArbeitnow(payload)[0].kind).toBe("INTERNSHIP");
  });

  // La bolsa es alemana: "Praktikum" es literalmente "pasantia" y aparece
  // en sus job_types. Omitirlo dejaba fuera justo las ofertas del tipo que
  // este modulo prioriza.
  it("Dado job_types=['praktikum'], Cuando se parsea, Entonces tambien es INTERNSHIP", () => {
    const jobs = parseArbeitnow({ data: [{ ...payload.data[0], job_types: ["praktikum"] }] });

    expect(jobs[0].kind).toBe("INTERNSHIP");
  });

  it("Dado job_types vacio, Cuando se parsea, Entonces kind=null y que lo infiera el motor", () => {
    const jobs = parseArbeitnow({ data: [{ ...payload.data[0], job_types: [] }] });

    expect(jobs[0].kind).toBeNull();
  });

  it.each([[null], [{}], [{ data: "no soy un array" }], [[]]])(
    "Dado el payload invalido %p, Cuando se parsea, Entonces devuelve []",
    (bad) => {
      expect(parseArbeitnow(bad)).toEqual([]);
    }
  );
});

describe("parseRemotive", () => {
  const payload = {
    jobs: [
      {
        id: 1234,
        title: "Senior Backend Engineer",
        company_name: "Remote Co",
        description: "<p>Python</p><script>alert(1)</script>",
        url: "https://remotive.com/remote-jobs/backend/1234",
        candidate_required_location: "LATAM",
        job_type: "full_time",
        publication_date: "2026-08-25T10:00:00",
        salary: "$50k - $70k",
      },
    ],
  };

  it("Dado el payload real, Cuando se parsea, Entonces extrae la oferta con id numerico", () => {
    expect(parseRemotive(payload)[0].sourceId).toBe("1234");
  });

  // candidate_required_location NO es la sede de la empresa: es desde
  // donde puede postularse el candidato. Para un estudiante en Quito ese
  // dato vale mas que la direccion de la oficina.
  it("Dado candidate_required_location, Cuando se parsea, Entonces ese es el location guardado", () => {
    expect(parseRemotive(payload)[0].location).toBe("LATAM");
  });

  // Remotive manda HTML crudo escrito por la empresa que publica: si se
  // guardara tal cual, seria un XSS almacenado esperando a que alguna
  // vista lo renderice sin escapar.
  it("Dado un <script> en la descripcion, Cuando se parsea, Entonces no sobrevive nada ejecutable", () => {
    const desc = parseRemotive(payload)[0].description;

    expect(desc).not.toContain("alert");
    expect(desc).toContain("Python");
  });

  // El salario viene como texto libre ("Competitive", "$50k - $70k"). Un
  // rango mal inferido es PEOR que no mostrar nada: el estudiante decide
  // postular con esa cifra.
  it("Dado un salario en texto libre, Cuando se parsea, Entonces NO se inventa un rango numerico", () => {
    const job = parseRemotive(payload)[0];

    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
  });

  it("Dado el payload real, Cuando se parsea, Entonces marca remote=true", () => {
    expect(parseRemotive(payload)[0].remote).toBe(true);
  });

  it.each([[null], [{}], [{ jobs: null }]])("Dado el payload invalido %p, Cuando se parsea, Entonces devuelve []", (bad) => {
    expect(parseRemotive(bad)).toEqual([]);
  });
});

describe("parseJobSpy", () => {
  const payload = {
    jobs: [
      {
        site: "indeed",
        id: "in-123",
        title: "Pasante de Desarrollo",
        company: "Banco Pichincha",
        description: "Practicas preprofesionales en TI",
        job_url: "https://ec.indeed.com/viewjob?jk=123",
        location: "Quito, Pichincha",
        is_remote: false,
        job_type: "internship",
        date_posted: "2026-08-28",
        min_amount: 460,
        max_amount: 0,
        currency: "USD",
      },
      {
        site: "linkedin",
        id: null,
        title: "Backend Developer",
        company: "Acme",
        description: "nan",
        job_url: "https://linkedin.com/jobs/view/999",
        location: "Quito",
        is_remote: null,
        job_type: "fulltime, contract",
        date_posted: null,
        min_amount: null,
        max_amount: null,
        currency: null,
      },
    ],
  };

  // El dedupe necesita saber QUE bolsa fue para poder preferir Indeed sobre
  // LinkedIn cuando la misma vacante llega por las dos — por eso el source
  // lleva sufijo y no es un generico "jobspy".
  it("Dado el payload, Cuando se parsea, Entonces cada fila lleva su bolsa en el source", () => {
    const jobs = parseJobSpy(payload);

    expect(jobs[0].source).toBe("jobspy:indeed");
    expect(jobs[1].source).toBe("jobspy:linkedin");
  });

  // Varias bolsas no devuelven id propio; la URL siempre es unica y estable.
  it("Dada una fila sin id, Cuando se parsea, Entonces usa la URL como identificador de respaldo", () => {
    expect(parseJobSpy(payload)[1].sourceId).toBe("https://linkedin.com/jobs/view/999");
  });

  // JobSpy viene de un DataFrame de pandas: los huecos llegan como la
  // cadena "nan", no como null. Guardarla tal cual ponia literalmente la
  // palabra "nan" en la descripcion que ve el estudiante.
  it("Dada la cadena 'nan' de pandas, Cuando se parsea, Entonces NO termina como texto visible", () => {
    expect(parseJobSpy(payload)[1].description).toBe("");
  });

  it("Dado job_type con varios valores separados por coma, Cuando se parsea, Entonces toma el primero reconocido", () => {
    expect(parseJobSpy(payload)[1].kind).toBe("FULL_TIME");
  });

  it("Dado job_type='internship', Cuando se parsea, Entonces kind=INTERNSHIP", () => {
    expect(parseJobSpy(payload)[0].kind).toBe("INTERNSHIP");
  });

  it("Dado max_amount=0, Cuando se parsea, Entonces es null — 0 significa 'no informado'", () => {
    const job = parseJobSpy(payload)[0];

    expect(job.salaryMin).toBe(460);
    expect(job.salaryMax).toBeNull();
  });

  it.each([[null], [{}], [{ jobs: "no soy array" }]])(
    "Dado el payload invalido %p, Cuando se parsea, Entonces devuelve []",
    (bad) => {
      expect(parseJobSpy(bad)).toEqual([]);
    }
  );
});

describe("collectFromSources — tolerancia a fallos", () => {
  const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() } as unknown as Logger;

  function fakeSource(name: string, result: RawJob[] | Error): JobSource {
    return {
      name,
      fetchJobs: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    };
  }

  const job = { source: "x", sourceId: "1", title: "t", company: "c" } as RawJob;

  beforeEach(() => jest.clearAllMocks());

  // El modo de falla mas caro de un agregador: UNA bolsa caida deja el
  // listado sin actualizar para todos. Un Promise.all haria exactamente eso.
  it("Dada una fuente que revienta, Cuando se recolecta, Entonces el resto igual entra", async () => {
    const { jobs, failed } = await collectFromSources(
      [fakeSource("rota", new Error("HTTP 429")), fakeSource("sana", [job])],
      logger
    );

    expect(jobs).toHaveLength(1);
    expect(failed).toEqual(["rota"]);
  });

  it("Dadas TODAS las fuentes caidas, Cuando se recolecta, Entonces no lanza — devuelve vacio y las reporta", async () => {
    const { jobs, failed } = await collectFromSources(
      [fakeSource("a", new Error("timeout")), fakeSource("b", new Error("500"))],
      logger
    );

    expect(jobs).toEqual([]);
    expect(failed).toEqual(["a", "b"]);
  });

  it("Dada una fuente caida, Cuando se recolecta, Entonces queda registrada en el log con su motivo", async () => {
    await collectFromSources([fakeSource("rota", new Error("HTTP 429"))], logger);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 429"));
  });

  it("Dadas todas las fuentes sanas, Cuando se recolecta, Entonces junta todas las ofertas y no reporta fallos", async () => {
    const { jobs, failed } = await collectFromSources([fakeSource("a", [job]), fakeSource("b", [job, job])], logger);

    expect(jobs).toHaveLength(3);
    expect(failed).toEqual([]);
  });
});
