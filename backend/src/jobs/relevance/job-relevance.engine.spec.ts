import { assessJob, extractTags, RELEVANCE_FLOOR, ScorableJob } from "./job-relevance.engine";
import { normalizeForMatch, containsTerm } from "./taxonomy";

// Reloj fijo — el motor recibe `now` por parámetro justamente para que
// estos tests no cambien de resultado según el día en que corran.
const NOW = new Date("2026-09-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function job(overrides: Partial<ScorableJob> = {}): ScorableJob {
  return {
    title: "Desarrollador Backend",
    company: "Acme S.A.",
    description: "Buscamos desarrollador con Node.js y PostgreSQL.",
    location: "Quito, Ecuador",
    postedAt: daysAgo(1),
    ...overrides,
  };
}

describe("assessJob — clasificacion de dominio", () => {
  it("Dado un titulo del area, Cuando se evalua, Entonces es relevante", () => {
    const r = assessJob(job(), NOW);

    expect(r.relevant).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(RELEVANCE_FLOOR);
  });

  // El caso REAL que motivo NOISE_TERMS: Indeed devuelve esto cuando le
  // pides "software" y, sin castigo, se colaba arriba del listado porque
  // "software" en el titulo suma igual que en una vacante de verdad.
  it("Dado 'Ejecutivo Comercial - venta de software contable', Cuando se evalua, Entonces se descarta pese a decir 'software'", () => {
    const r = assessJob(
      job({ title: "Ejecutivo Comercial - venta de software contable", description: "Venta de licencias." }),
      NOW
    );

    expect(r.relevant).toBe(false);
  });

  it("Dado un puesto de docencia en computacion, Cuando se evalua, Entonces se descarta — no es una vacante de la industria", () => {
    const r = assessJob(
      job({ title: "Docente de Computacion", description: "Dictar clases de programacion en python." }),
      NOW
    );

    expect(r.relevant).toBe(false);
  });

  // REGRESION — falsos positivos encontrados corriendo la ingesta real
  // contra Remote OK/Arbeitnow: "tester" y "redes" a secas estaban en
  // DOMAIN_TERMS y estas ofertas puntuaban 44 y 41, colandose al top del
  // listado. Son revision electrica de aparatos, revision vehicular y
  // manejo de redes SOCIALES — ninguna es de software.
  it.each([
    ["Professional PAT Tester"],
    ["MOT Tester"],
    ["Community Manager de redes sociales"],
  ])("Dado el titulo real '%s', Cuando se evalua, Entonces NO es relevante", (title) => {
    expect(assessJob(job({ title, description: "Trabajo de campo." }), NOW).relevant).toBe(false);
  });

  it("Dado 'QA Tester' (tester SI calificado), Cuando se evalua, Entonces sigue siendo relevante", () => {
    expect(assessJob(job({ title: "QA Tester de Software" }), NOW).relevant).toBe(true);
  });

  it("Dado 'Administrador de Redes', Cuando se evalua, Entonces sigue siendo relevante", () => {
    expect(assessJob(job({ title: "Administrador de Redes y Servidores" }), NOW).relevant).toBe(true);
  });

  it("Dado un titulo sin ninguna senal del area, Cuando se evalua, Entonces NO es relevante aunque sume puntos por ubicacion", () => {
    const r = assessJob(
      job({ title: "Asistente Administrativa", description: "Manejo de agenda y archivo.", location: "Quito" }),
      NOW
    );

    expect(r.relevant).toBe(false);
  });

  // Un dev que menciona de pasada al area comercial no es una vacante
  // comercial — por eso el ruido del CUERPO castiga poco y el del TITULO
  // mucho.
  it("Dado un dev cuya descripcion menciona al equipo comercial, Cuando se evalua, Entonces sigue siendo relevante", () => {
    const r = assessJob(
      job({
        title: "Desarrollador Backend Java",
        description: "Trabajaras con el equipo comercial para levantar requerimientos. Stack: java, spring, sql.",
      }),
      NOW
    );

    expect(r.relevant).toBe(true);
  });
});

describe("assessJob — pasantias (el caso de uso central del modulo)", () => {
  it("Dado 'Pasante de Desarrollo', Cuando se evalua, Entonces kind=INTERNSHIP y seniority=INTERN", () => {
    const r = assessJob(job({ title: "Pasante de Desarrollo de Software" }), NOW);

    expect(r.kind).toBe("INTERNSHIP");
    expect(r.seniority).toBe("INTERN");
  });

  // "practicas preprofesionales" es el termino legal ecuatoriano y el que
  // usan Multitrabajos y las convocatorias de la EPN. Si el motor no lo
  // reconoce, se pierde justo la oferta mas relevante para un estudiante.
  it("Dado 'Practicas Preprofesionales en TI', Cuando se evalua, Entonces se reconoce como pasantia", () => {
    const r = assessJob(job({ title: "Practicas Preprofesionales en TI - Soporte Tecnico" }), NOW);

    expect(r.kind).toBe("INTERNSHIP");
  });

  it("Dado el titulo con tilde 'Pasantía', Cuando se evalua, Entonces la normalizacion lo reconoce igual", () => {
    const conTilde = assessJob(job({ title: "Pasantía de Desarrollo Web" }), NOW);
    const sinTilde = assessJob(job({ title: "Pasantia de Desarrollo Web" }), NOW);

    expect(conTilde.kind).toBe("INTERNSHIP");
    expect(conTilde.score).toBe(sinTilde.score);
  });

  // Bug real de las fuentes: la empresa publica la pasantia marcada como
  // "fulltime" porque son 40h semanales. Creerle al campo declarado
  // escondia la oferta del filtro de pasantias.
  it("Dado declaredKind=FULL_TIME pero el titulo dice 'Pasante', Cuando se evalua, Entonces el titulo gana y es INTERNSHIP", () => {
    const r = assessJob(job({ title: "Pasante de QA", declaredKind: "FULL_TIME" }), NOW);

    expect(r.kind).toBe("INTERNSHIP");
  });

  it("Dado declaredKind=CONTRACT y un titulo neutro, Cuando se evalua, Entonces se respeta lo declarado por la fuente", () => {
    const r = assessJob(job({ title: "Desarrollador Frontend", declaredKind: "CONTRACT" }), NOW);

    expect(r.kind).toBe("CONTRACT");
  });

  it("Dada una pasantia y una vacante senior identicas en lo demas, Cuando se comparan, Entonces la pasantia puntua mas alto", () => {
    const pasantia = assessJob(job({ title: "Pasante de Desarrollo Backend" }), NOW);
    const senior = assessJob(job({ title: "Senior Backend Developer" }), NOW);

    expect(pasantia.score).toBeGreaterThan(senior.score);
  });
});

describe("assessJob — seniority", () => {
  it("Dado 'Senior' en el titulo, Cuando se evalua, Entonces seniority=SENIOR", () => {
    expect(assessJob(job({ title: "Senior Software Engineer" }), NOW).seniority).toBe("SENIOR");
  });

  it("Dado 'Junior' en el titulo, Cuando se evalua, Entonces seniority=JUNIOR", () => {
    expect(assessJob(job({ title: "Junior Backend Developer" }), NOW).seniority).toBe("JUNIOR");
  });

  // Casi toda descripcion menciona "senior" en algun lado (el equipo, el
  // senior manager que entrevista). Mirar el cuerpo antes que el titulo
  // marcaba como SENIOR a la mitad de las vacantes junior.
  it("Dado 'Junior' en el titulo pero 'senior' en el cuerpo, Cuando se evalua, Entonces gana el titulo", () => {
    const r = assessJob(
      job({
        title: "Junior Developer",
        description: "Reportaras al senior manager del area de software.",
      }),
      NOW
    );

    expect(r.seniority).toBe("JUNIOR");
  });

  it("Dado un titulo neutro sin senales, Cuando se evalua, Entonces seniority=UNKNOWN", () => {
    const r = assessJob(job({ title: "Desarrollador Backend", description: "Stack node y sql." }), NOW);

    expect(r.seniority).toBe("UNKNOWN");
  });
});

describe("assessJob — modalidad", () => {
  it("Dado 'remoto' en la descripcion, Cuando se evalua, Entonces workMode=REMOTE", () => {
    expect(assessJob(job({ description: "Trabajo 100% remoto con node." }), NOW).workMode).toBe("REMOTE");
  });

  // Toda oferta hibrida dice "hibrido (2 dias remoto)". Buscar "remoto"
  // primero las marcaba todas como 100% remotas y el estudiante se
  // enteraba de la oficina recien en la entrevista.
  it("Dado 'hibrido: 2 dias remoto', Cuando se evalua, Entonces workMode=HYBRID y no REMOTE", () => {
    const r = assessJob(job({ description: "Modalidad hibrida: 2 dias remoto, 3 en oficina. Stack java." }), NOW);

    expect(r.workMode).toBe("HYBRID");
  });

  it("Dado declaredRemote=true sin la palabra en el texto, Cuando se evalua, Entonces workMode=REMOTE", () => {
    const r = assessJob(job({ declaredRemote: true, description: "Backend con python." }), NOW);

    expect(r.workMode).toBe("REMOTE");
  });

  it("Dado un texto hibrido Y declaredRemote=true, Cuando se evalua, Entonces hibrido gana — es el dato mas especifico", () => {
    const r = assessJob(job({ declaredRemote: true, description: "Esquema semipresencial. Stack java." }), NOW);

    expect(r.workMode).toBe("HYBRID");
  });
});

describe("assessJob — ubicacion (sesgo hacia lo alcanzable desde la EPN)", () => {
  it("Dada una vacante en Quito y otra en Guayaquil, Cuando se comparan, Entonces Quito puntua mas alto", () => {
    const quito = assessJob(job({ location: "Quito, Ecuador" }), NOW);
    const guayaquil = assessJob(job({ location: "Guayaquil, Ecuador" }), NOW);

    expect(quito.score).toBeGreaterThan(guayaquil.score);
  });

  // Presencial en Berlin es ruido puro para un estudiante en Quito, por
  // buena que sea la vacante.
  it("Dada una vacante presencial en el extranjero, Cuando se evalua, Entonces se castiga fuerte", () => {
    const fuera = assessJob(job({ location: "Berlin, Alemania" }), NOW);
    const local = assessJob(job({ location: "Quito, Ecuador" }), NOW);

    expect(fuera.score).toBeLessThan(local.score);
  });

  it("Dada una vacante remota en el extranjero, Cuando se evalua, Entonces sigue siendo relevante — alguna si sirve", () => {
    const r = assessJob(
      job({ location: "Berlin, Alemania", description: "Fully remote backend role. Stack: node, postgres, docker." }),
      NOW
    );

    expect(r.relevant).toBe(true);
    expect(r.workMode).toBe("REMOTE");
  });

  // Ajuste pedido tras ver el listado REAL en produccion: 26 de 42 ofertas
  // eran remotas internacionales que en la practica no le sirven a un
  // estudiante de la EPN (ingles fluido, anios de experiencia,
  // contratacion en otro pais), y empujaban abajo las de aca. Lo remoto
  // sigue apareciendo, pero ya nunca le gana a una vacante ecuatoriana
  // comparable.
  it("Dada una remota extranjera y una presencial en Quito equivalentes, Cuando se comparan, Entonces gana la de Quito", () => {
    const quito = assessJob(job({ location: "Quito, Ecuador", description: "Backend con node y postgres." }), NOW);
    const remotaFuera = assessJob(
      job({ location: "Berlin, Alemania", description: "Fully remote backend. Stack node, postgres." }),
      NOW
    );

    expect(quito.score).toBeGreaterThan(remotaFuera.score);
  });

  it("Dada una remota EN Ecuador, Cuando se compara con una remota extranjera, Entonces gana la ecuatoriana", () => {
    const remotaEc = assessJob(job({ location: "Quito, Ecuador", description: "100% remoto. Node y sql." }), NOW);
    const remotaFuera = assessJob(job({ location: "Berlin", description: "Fully remote. Node y sql." }), NOW);

    expect(remotaEc.score).toBeGreaterThan(remotaFuera.score);
  });
});

// Pedido explicito: la carrera de Sistemas de la EPN no es solo
// desarrollo. El vocabulario cubria casi puro "developer" y dejaba fuera
// areas enteras donde sus egresados si trabajan.
describe("assessJob — cobertura de TODAS las areas de Sistemas", () => {
  const AREAS: [string, string][] = [
    ["Cientifico de Datos Junior", "Ciencia de datos con python y machine learning"],
    ["Analista de Datos", "Analitica de datos, power bi y sql"],
    ["Ingeniero de Datos", "Pipeline de datos, etl y data warehouse"],
    ["Especialista en Gobernanza de Datos", "Calidad de datos y gobierno de datos"],
    ["Analista de Ciberseguridad", "SIEM y respuesta a incidentes"],
    ["Analista SOC", "Centro de operaciones de seguridad, turnos rotativos"],
    ["Pentester Junior", "Ethical hacking y gestion de vulnerabilidades"],
    ["Auditor de Sistemas", "Auditoria informatica bajo COBIT e ITIL"],
    ["Coordinador de Gobernanza de TI", "Gobierno de TI, ITIL y continuidad del negocio"],
    ["Administrador de Redes", "Cisco, firewall y cableado estructurado"],
    ["Analista de Telecomunicaciones", "Redes de datos, fibra optica y NOC"],
    ["Administrador de Servidores", "Windows server, active directory y virtualizacion"],
    ["Analista de Sistemas", "Tecnologias de la informacion y bases de datos"],
    ["Soporte Tecnico TI", "Mesa de ayuda y service desk"],
    ["Desarrollador Backend", "Node y postgresql"],
  ];

  it.each(AREAS)("Dada la vacante '%s', Cuando se evalua, Entonces es relevante", (title, description) => {
    expect(assessJob(job({ title, description }), NOW).relevant).toBe(true);
  });

  it("Dada una pasantia de ciencia de datos en Quito, Cuando se evalua, Entonces puntua alto y es INTERNSHIP", () => {
    const r = assessJob(
      job({
        title: "Pasante de Ciencia de Datos",
        description: "Practicas preprofesionales. Python, sql y power bi.",
        location: "Quito, Ecuador",
      }),
      NOW
    );

    expect(r.kind).toBe("INTERNSHIP");
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("Dada una vacante de ciberseguridad, Cuando se evalua, Entonces la etiqueta como tal para poder filtrarla", () => {
    const r = assessJob(
      job({ title: "Analista de Ciberseguridad", description: "SIEM, SOC e ISO 27001." }),
      NOW
    );

    expect(r.tags).toContain("Ciberseguridad");
    expect(r.tags).toContain("SIEM");
  });

  // Riesgos de falso positivo propios del espanol de Ecuador, detectados al
  // ampliar el vocabulario: el nombre de la empresa y la descripcion entran
  // al texto evaluado, asi que una sigla corta puede colarse por donde no
  // es. "soc" choca con "Soc. Anonima" (como se escribe toda sociedad
  // anonima) y "servidores" con "servidores publicos" (los funcionarios del
  // Estado). Ambos quedaron calificados por eso.
  it.each([
    ["Asistente Administrativa", "Manejo de agenda", "Constructora Andina Soc. Anonima"],
    ["Analista de Talento Humano", "Seleccion para servidores publicos del ministerio", "Ministerio"],
    ["Secretaria Ejecutiva", "Archivo y recepcion", "Comercial Soc. Anonima"],
  ])(
    "Dada la vacante ajena al area '%s' en '%s', Cuando se evalua, Entonces NO se cuela por una sigla corta",
    (title, description, company) => {
      expect(assessJob(job({ title, description, company, location: "Quito, Ecuador" }), NOW).relevant).toBe(false);
    }
  );

  it("Dada una vacante de BI, Cuando se evalua, Entonces 'business intelligence' e 'inteligencia de negocios' dan el MISMO tag", () => {
    const ingles = assessJob(job({ title: "Analista Business Intelligence", description: "Power bi y sql." }), NOW);
    const espanol = assessJob(job({ title: "Analista de Inteligencia de Negocios", description: "Power bi y sql." }), NOW);

    expect(ingles.tags).toContain("BI");
    expect(espanol.tags).toContain("BI");
  });

  // El vocabulario se amplio mucho — el riesgo real de eso es empezar a
  // aceptar cualquier cosa. Estas siguen teniendo que quedar fuera.
  it.each([
    ["Asesor Comercial", "Venta de seguros"],
    ["Auxiliar Contable", "Registro de facturas"],
    ["Chofer Profesional", "Reparto de mercaderia"],
    ["Enfermera", "Atencion a pacientes"],
  ])("Dada la vacante ajena al area '%s', Cuando se evalua, Entonces sigue descartandose", (title, description) => {
    expect(assessJob(job({ title, description }), NOW).relevant).toBe(false);
  });
});

describe("assessJob — frescura ('en tiempo real' fue el pedido)", () => {
  it("Dadas dos ofertas identicas, Cuando una es de hoy y otra de hace 30 dias, Entonces la de hoy puntua mas alto", () => {
    const hoy = assessJob(job({ postedAt: daysAgo(0) }), NOW);
    const vieja = assessJob(job({ postedAt: daysAgo(30) }), NOW);

    expect(hoy.score).toBeGreaterThan(vieja.score);
  });

  it("Dada una oferta sin fecha, Cuando se evalua, Entonces se castiga apenas — es una carencia de la fuente, no de la oferta", () => {
    const sinFecha = assessJob(job({ postedAt: null }), NOW);
    const vieja = assessJob(job({ postedAt: daysAgo(40) }), NOW);

    expect(sinFecha.score).toBeGreaterThan(vieja.score);
    expect(sinFecha.relevant).toBe(true);
  });

  // El descuento por antiguedad es continuo justamente para que no haya un
  // salto brusco en el orden al cruzar un dia concreto.
  it("Dadas ofertas de 22 a 60 dias, Cuando se evaluan, Entonces el puntaje decrece de forma monotona", () => {
    const scores = [22, 30, 40, 50, 60].map((d) => assessJob(job({ postedAt: daysAgo(d) }), NOW).score);

    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("Dada una fecha futura (reloj desfasado de la fuente), Cuando se evalua, Entonces no rompe ni supera el tope de 100", () => {
    const r = assessJob(job({ postedAt: new Date(NOW.getTime() + 5 * 86_400_000) }), NOW);

    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe("assessJob — limites del puntaje", () => {
  it("Dada una oferta inmejorable, Cuando se evalua, Entonces el puntaje nunca pasa de 100", () => {
    const r = assessJob(
      job({
        title: "Pasante Desarrollador Full Stack Java React",
        description: "Practicas preprofesionales. Stack: java, spring, react, sql, docker, aws, python, node.",
        location: "Quito, Pichincha, Ecuador",
        postedAt: daysAgo(0),
      }),
      NOW
    );

    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("Dada una oferta pesima, Cuando se evalua, Entonces el puntaje nunca baja de 0", () => {
    const r = assessJob(
      job({
        title: "Asesor Comercial Vendedor Call Center",
        description: "Ventas de software. Cobranzas y telemercadeo.",
        location: "Berlin",
        postedAt: daysAgo(90),
      }),
      NOW
    );

    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.relevant).toBe(false);
  });

  it("Dada una oferta cualquiera, Cuando se evalua, Entonces siempre explica su puntaje", () => {
    expect(assessJob(job(), NOW).reasons.length).toBeGreaterThan(0);
  });
});

describe("extractTags", () => {
  it("Dado un texto con node, nodejs y node.js, Cuando se extraen tags, Entonces aparece 'Node.js' UNA sola vez", () => {
    const tags = extractTags(normalizeForMatch("Buscamos node, nodejs y node.js"));

    expect(tags.filter((t) => t === "Node.js")).toHaveLength(1);
  });

  // "react native" va antes que "react" en STACK_TAGS a proposito: una
  // vacante de movil no debe salir etiquetada como React web.
  it("Dado 'React Native', Cuando se extraen tags, Entonces incluye 'React Native'", () => {
    expect(extractTags(normalizeForMatch("Desarrollador React Native"))).toContain("React Native");
  });

  it("Dado 'C#' y '.NET', Cuando se extraen tags, Entonces los reconoce pese a los simbolos", () => {
    const tags = extractTags(normalizeForMatch("Desarrollador C# con .NET 8"));

    expect(tags).toContain("C#");
    expect(tags).toContain(".NET");
  });

  it("Dado un texto sin tecnologias, Cuando se extraen tags, Entonces devuelve lista vacia", () => {
    expect(extractTags(normalizeForMatch("Buscamos una persona proactiva"))).toEqual([]);
  });
});

describe("containsTerm — limites de palabra", () => {
  // El bug clasico del matching por substring: "java" hace match dentro de
  // "javascript" y toda vacante de JS quedaba etiquetada tambien como Java.
  it("Dado 'javascript', Cuando se busca 'java', Entonces NO hace match", () => {
    expect(containsTerm("desarrollador javascript senior", "java")).toBe(false);
  });

  it("Dado 'java' como palabra suelta, Cuando se busca 'java', Entonces SI hace match", () => {
    expect(containsTerm("desarrollador java senior", "java")).toBe(true);
  });

  it("Dado 'abogado', Cuando se busca 'go', Entonces NO hace match", () => {
    expect(containsTerm("se busca abogado corporativo", "go")).toBe(false);
  });

  it("Dado un termino al inicio del texto, Cuando se busca, Entonces hace match (no hay caracter previo)", () => {
    expect(containsTerm("python developer", "python")).toBe(true);
  });

  it("Dado un termino al final del texto, Cuando se busca, Entonces hace match (no hay caracter siguiente)", () => {
    expect(containsTerm("developer python", "python")).toBe(true);
  });

  it("Dado un termino con puntuacion alrededor, Cuando se busca, Entonces hace match", () => {
    expect(containsTerm("stack: java, spring; sql.", "java")).toBe(true);
  });
});

describe("normalizeForMatch", () => {
  it("Dado texto con tildes y mayusculas, Cuando se normaliza, Entonces queda en minusculas y sin tildes", () => {
    expect(normalizeForMatch("Pasantía en Ingeniería")).toBe("pasantia en ingenieria");
  });

  it("Dada la enie, Cuando se normaliza, Entonces se convierte en n — las fuentes escriben 'anos' y 'años' indistintamente", () => {
    expect(normalizeForMatch("5 años")).toBe("5 anos");
  });

  it("Dado texto con espacios repetidos y saltos de linea, Cuando se normaliza, Entonces los colapsa", () => {
    expect(normalizeForMatch("  node\n\n  sql  ")).toBe("node sql");
  });
});
