import {
  containsTerm,
  countTerms,
  normalizeForMatch,
  DOMAIN_TERMS,
  NOISE_TERMS,
  INTERNSHIP_TERMS,
  JUNIOR_TERMS,
  SENIOR_TERMS,
  REMOTE_TERMS,
  HYBRID_TERMS,
  ECUADOR_TERMS,
  QUITO_TERMS,
  GLOBAL_REMOTE_TERMS,
  STACK_TAGS,
} from "./taxonomy";

// EL MOTOR. Todo acá es función pura: entra el texto de una oferta, sale su
// clasificación y su puntaje. Ni Prisma, ni HTTP, ni relojes globales — la
// hora "ahora" se pasa como parámetro.
//
// Esa pureza no es estética: es lo que permite tener un spec que fija el
// comportamiento con ofertas REALES copiadas de Multitrabajos/LinkedIn, y
// que ajustar un peso sea un cambio de una línea con el test diciendo al
// instante qué ofertas se movieron de lugar.
//
// Por qué un motor y no un `WHERE title ILIKE '%developer%'`: las fuentes
// devuelven basura mezclada con oro. Indeed manda "Ejecutivo Comercial —
// software contable" cuando le pides "software"; LinkedIn manda ofertas de
// Senior con 8 años de experiencia a un estudiante de sexto semestre. Un
// LIKE no distingue eso. El motor sí, y además ORDENA: lo que un estudiante
// de la EPN puede tomar HOY va primero.

export type JobKind = "INTERNSHIP" | "FULL_TIME" | "PART_TIME" | "CONTRACT";
export type JobSeniority = "INTERN" | "JUNIOR" | "MID" | "SENIOR" | "UNKNOWN";
export type JobWorkMode = "ONSITE" | "HYBRID" | "REMOTE";

/** Lo que el motor necesita leer de una oferta, venga de donde venga. */
export interface ScorableJob {
  title: string;
  company: string;
  description: string;
  location: string | null;
  /** Modalidad declarada por la fuente, si la trae. Manda sobre el texto. */
  declaredRemote?: boolean | null;
  /** Tipo declarado por la fuente (ej. JobSpy `job_type`), si lo trae. */
  declaredKind?: JobKind | null;
  postedAt: Date | null;
}

export interface JobAssessment {
  /** false ⇒ ni siquiera se guarda. Ver `RELEVANCE_FLOOR`. */
  relevant: boolean;
  /** 0..100. Es el orden por defecto del listado. */
  score: number;
  kind: JobKind;
  seniority: JobSeniority;
  workMode: JobWorkMode;
  /** Stacks detectados, deduplicados y en orden estable. */
  tags: string[];
  /** Por qué obtuvo ese puntaje — se guarda para poder depurar el ranking. */
  reasons: string[];
}

/**
 * Piso de relevancia: por debajo de esto la oferta se descarta y NO entra a
 * la base.
 *
 * Filtrar en la ingesta y no en la consulta es deliberado: las fuentes
 * devuelven cientos de ofertas por corrida y guardar la basura significaría
 * pagar disco y tiempo de query para siempre por algo que ningún estudiante
 * va a querer ver. Además mantiene honesto el contador de "N ofertas" de la
 * UI — si dice 40, son 40 ofertas de verdad del área.
 */
export const RELEVANCE_FLOOR = 25;

/**
 * Puntaje base por ser del área, antes de cualquier modificador.
 *
 * Existe porque la fuerza del dominio MULTIPLICA en vez de sumar (ver
 * assessJob): sin una base, una vacante del área sin bonos —o con el
 * castigo por senior— quedaba en casi cero aunque fuera perfectamente
 * válida.
 */
export const DOMAIN_BASE = 40;

/** Vida útil de una oferta. Pasado esto se archiva aunque la fuente insista. */
export const MAX_AGE_DAYS = 45;

/**
 * Clasifica y puntúa una oferta.
 *
 * @param now  Reloj inyectado — sin esto el puntaje de una misma oferta
 *             cambiaría entre corridas y ningún test de frescura sería
 *             reproducible.
 */
export function assessJob(job: ScorableJob, now: Date): JobAssessment {
  // El título pesa más que la descripción: una oferta de ventas que
  // MENCIONA "software" en el cuerpo no es una oferta de software, pero una
  // que lo lleva en el título casi siempre sí. Por eso se puntúan aparte.
  const title = normalizeForMatch(job.title);
  const body = normalizeForMatch(`${job.description} ${job.company}`);
  const place = normalizeForMatch(job.location ?? "");
  const all = `${title} ${body} ${place}`;

  const reasons: string[] = [];

  // Base por SER del área. No es un número decorativo: sin ella, al pasar el
  // dominio de sumando a multiplicador, una vacante legítima de Sistemas que
  // arrastrara el castigo por senior (-22) caía a 7 puntos y quedaba fuera
  // ("Senior DevOps Engineer", caso real). Los modificadores de abajo
  // ajustan sobre esta base; el multiplicador de dominio decide cuánto de
  // todo eso cuenta.
  let score = DOMAIN_BASE;

  // --- 1. ¿Es del área? ---------------------------------------------------
  //
  // La fuerza del dominio MULTIPLICA al resto en vez de sumarse, y esa es la
  // decisión central del motor. Sumando, un aviso que solo menciona una
  // tecnología de pasada cobraba igual los bonos de pasantía (+30), frescura
  // (+15) y remoto (+6) y terminaba arriba del listado.
  //
  // Caso real que lo obligó: "Trainee (m/w/d) Financial Consulting" de una
  // consultora FINANCIERA de Berlín llegó a 56 puntos y encabezó la lista.
  // Su única señal del área era UN término suelto en una descripción en
  // alemán; todo lo demás vino de ser pasantía, reciente y remota. Con la
  // multiplicación cae a ~17 y no entra.
  //
  // Multiplicar también expresa mejor lo que significa: "qué tan del área
  // es" no es un punto más a sumar, es el factor que decide si el resto de
  // los méritos cuentan siquiera.
  const domainInTitle = countTerms(title, DOMAIN_TERMS);
  const domainInBody = countTerms(body, DOMAIN_TERMS);

  // 0..1. El TÍTULO vale mucho más que el cuerpo: casi toda descripción de
  // vacante nombra alguna tecnología en algún lado (el ERP que usa la
  // empresa, la herramienta del equipo), pero solo una vacante del área lo
  // lleva en el puesto.
  let domainStrength: number;
  let domainWhy: string;
  if (domainInTitle > 0) {
    domainStrength = 1;
    domainWhy = "titulo del area";
  } else if (domainInBody >= 3) {
    // Tres o más términos ya no es una mención de pasada: es una
    // descripción que de verdad habla del área.
    domainStrength = 0.7;
    domainWhy = `${domainInBody} senales del area en la descripcion`;
  } else if (domainInBody === 2) {
    domainStrength = 0.45;
    domainWhy = "dos menciones en la descripcion";
  } else if (domainInBody > 0) {
    // UNA mención suelta es la evidencia más débil que existe, y es
    // justamente la que tenía el trainee de consultoría financiera. Tan
    // baja que ni sumando todos los bonos alcanza el piso.
    domainStrength = 0.2;
    domainWhy = "solo una mencion suelta en la descripcion";
  } else {
    domainStrength = 0;
    domainWhy = "ninguna senal del area";
  }

  // --- 2. Ruido -----------------------------------------------------------
  // El ruido REDUCE la fuerza del dominio en vez de restar puntos: "Asesor
  // Comercial de Software" tiene un término del área en el título, y restar
  // puntos lo dejaba compitiendo. Bajando el factor, no compite.
  //
  // El del título es casi siempre definitivo; el del cuerpo puede ser
  // incidental (un dev que menciona al equipo comercial). De ahí la
  // diferencia de castigo.
  const noiseInTitle = countTerms(title, NOISE_TERMS);
  const noiseInBody = countTerms(body, NOISE_TERMS);
  if (noiseInTitle > 0) {
    domainStrength *= 0.1;
    reasons.push(`ruido en el titulo (x0.1)`);
  }
  if (noiseInBody > 0) {
    domainStrength *= Math.max(0.5, 1 - Math.min(noiseInBody, 3) * 0.15);
    reasons.push(`ruido en la descripcion`);
  }

  reasons.push(`dominio: ${domainWhy} (x${domainStrength.toFixed(2)})`);

  // --- 3. Perfil: pasantía / junior / senior ------------------------------
  const kind = detectKind(job, title, body);
  const seniority = detectSeniority(title, body, kind);

  // Este es el sesgo CENTRAL del módulo y la razón de que exista: la app es
  // de una asociación de ESTUDIANTES. Una pasantía mediocre le sirve más a
  // un estudiante de sexto semestre que la mejor vacante de Staff Engineer.
  if (kind === "INTERNSHIP") {
    score += 30;
    reasons.push("pasantia/practicas (+30)");
  }
  if (seniority === "JUNIOR") {
    score += 18;
    reasons.push("perfil junior (+18)");
  }
  if (seniority === "SENIOR") {
    score -= 22;
    reasons.push("perfil senior (-22)");
  }

  // --- 4. Ubicación -------------------------------------------------------
  const workMode = detectWorkMode(job, all);
  const inQuito = QUITO_TERMS.some((t) => containsTerm(all, t));
  const inEcuador = ECUADOR_TERMS.some((t) => containsTerm(all, t));

  // Estar en el país pesa más que cualquier otra señal de ubicación — es
  // lo que separa "puedo postular a esto" de "esto es interesante de leer".
  if (inQuito) {
    score += 26;
    reasons.push("en Quito (+26)");
  } else if (inEcuador) {
    score += 16;
    reasons.push("en Ecuador (+16)");
  }

  // ¿El remoto es de verdad alcanzable desde Ecuador?
  //
  // "Remote — Munich" o "Full Remote aus Bayern" NO quieren decir que
  // contraten desde acá: quieren decir "desde tu casa, en Alemania". Piden
  // permiso de trabajo local y casi siempre el idioma. Contarlos como
  // alcanzables llenaba el listado de vacantes imposibles — medido en
  // producción, 10 de las remotas estaban atadas a una ciudad alemana o al
  // Reino Unido.
  //
  // Sin ubicación se asume abierto: las bolsas de remoto puro (Remote OK)
  // no la publican justamente porque no aplica.
  const remoteAbierto =
    place.trim() === "" ||
    inEcuador ||
    GLOBAL_REMOTE_TERMS.some((t) => containsTerm(place, t));

  // Remoto suma, pero POCO y siempre lo mismo — nunca más que estar en el
  // país.
  //
  // Antes el bono era mayor justamente cuando la oferta NO era local (+16
  // contra +8), con la idea de que lo remoto "rescata" a la vacante
  // extranjera. El efecto real, medido contra producción, fue que el
  // listado se llenó de vacantes remotas internacionales (26 de 42) que en
  // la práctica no le sirven a un estudiante de la EPN: piden inglés
  // fluido, años de experiencia y contratación en otro país. Las de acá,
  // que son las que de verdad puede tomar, quedaban debajo.
  //
  // Con un bono plano y chico, lo remoto sigue apareciendo — que es
  // correcto, alguna sí sirve — pero ya nunca le gana a una vacante
  // ecuatoriana comparable.
  if (workMode === "REMOTE" && remoteAbierto) {
    score += 6;
    reasons.push("remoto (+6)");
  } else if (workMode === "REMOTE" && !remoteAbierto) {
    // Mismo castigo que una presencial en el extranjero, porque en la
    // práctica es lo mismo: no se puede tomar desde acá.
    score -= 25;
    reasons.push("remoto pero atado a otro pais (-25)");
  } else if (!inEcuador) {
    // Presencial y fuera del país: para un estudiante de la EPN esto es
    // ruido casi puro, sin importar lo buena que sea la vacante.
    score -= 25;
    reasons.push("presencial fuera de Ecuador (-25)");
  }

  // --- 5. Frescura --------------------------------------------------------
  // "Tiempo real" fue el pedido explícito. Una oferta de hace 30 días
  // probablemente ya se llenó, así que la antigüedad descuenta de forma
  // continua en vez de con escalones (que producían saltos raros en el
  // orden justo al cruzar el día 7).
  const ageDays = job.postedAt ? daysBetween(job.postedAt, now) : null;
  if (ageDays !== null) {
    if (ageDays <= 2) {
      score += 15;
      reasons.push("publicada hace <=2 dias (+15)");
    } else if (ageDays <= 7) {
      score += 8;
      reasons.push("publicada esta semana (+8)");
    } else if (ageDays > 21) {
      const pts = Math.min(Math.round((ageDays - 21) * 0.8), 20);
      score -= pts;
      reasons.push(`oferta antigua, ${Math.round(ageDays)}d (-${pts})`);
    }
  } else {
    // Sin fecha no se castiga fuerte: varias fuentes simplemente no la
    // mandan, y penalizar eso equivaldría a penalizar a la fuente, no a la
    // oferta.
    score -= 3;
    reasons.push("sin fecha de publicacion (-3)");
  }

  const tags = extractTags(all);
  if (tags.length > 0) {
    const pts = Math.min(tags.length, 5) * 2;
    score += pts;
    reasons.push(`${tags.length} tecnologias identificadas (+${pts})`);
  }

  // Acá se aplica el multiplicador: todo lo de arriba son méritos que solo
  // cuentan en la medida en que la oferta sea del área.
  const clamped = clamp(Math.round(score * domainStrength), 0, 100);
  return {
    relevant: clamped >= RELEVANCE_FLOOR && domainStrength > 0,
    score: clamped,
    kind,
    seniority,
    workMode,
    tags,
    reasons,
  };
}

/**
 * Tipo de contrato.
 *
 * El tipo declarado por la fuente gana sobre el texto SALVO para pasantías:
 * en Indeed/LinkedIn es habitual que una vacante venga marcada `fulltime`
 * con el título "Pasante de Desarrollo" — la empresa la publica como tiempo
 * completo porque son 40h semanales, pero para el estudiante es una
 * pasantía. Confiar ciegamente en el campo declarado escondía justo las
 * ofertas que este módulo existe para mostrar.
 */
function detectKind(job: ScorableJob, title: string, body: string): JobKind {
  if (countTerms(title, INTERNSHIP_TERMS) > 0) return "INTERNSHIP";
  if (job.declaredKind) return job.declaredKind;
  if (countTerms(body, INTERNSHIP_TERMS) > 0) return "INTERNSHIP";
  return "FULL_TIME";
}

function detectSeniority(title: string, body: string, kind: JobKind): JobSeniority {
  if (kind === "INTERNSHIP") return "INTERN";
  // El título manda sobre el cuerpo: casi toda descripción de vacante
  // menciona "senior" en algún lado (el equipo, a quién reporta, el
  // "senior manager" que entrevista). Mirar el cuerpo primero marcaba como
  // SENIOR a la mitad de las vacantes junior.
  if (countTerms(title, SENIOR_TERMS) > 0) return "SENIOR";
  if (countTerms(title, JUNIOR_TERMS) > 0) return "JUNIOR";
  if (countTerms(body, JUNIOR_TERMS) > 0) return "JUNIOR";
  if (countTerms(body, SENIOR_TERMS) > 0) return "SENIOR";
  return "UNKNOWN";
}

/**
 * Modalidad.
 *
 * Híbrido se evalúa ANTES que remoto porque toda oferta híbrida dice
 * "híbrido (2 días remoto)" — buscar "remoto" primero las clasificaba a
 * todas como 100% remotas, y un estudiante que se postulaba creyendo eso se
 * encontraba con que tenía que ir a la oficina.
 */
function detectWorkMode(job: ScorableJob, all: string): JobWorkMode {
  if (countTerms(all, HYBRID_TERMS) > 0) return "HYBRID";
  if (job.declaredRemote === true) return "REMOTE";
  if (countTerms(all, REMOTE_TERMS) > 0) return "REMOTE";
  return "ONSITE";
}

/**
 * Tags de stack, deduplicados.
 *
 * El orden de inserción de STACK_TAGS importa y es intencional: "react
 * native" va antes que "react" para que una vacante de móvil no salga
 * etiquetada como React web. Como varias claves mapean al mismo tag
 * ("node"/"nodejs"/"node.js" → "Node.js"), el Set colapsa los duplicados.
 */
export function extractTags(normalizedText: string): string[] {
  const found = new Set<string>();
  for (const [term, tag] of STACK_TAGS) {
    if (containsTerm(normalizedText, term)) found.add(tag);
  }
  return [...found];
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
