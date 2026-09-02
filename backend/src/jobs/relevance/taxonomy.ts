// Vocabulario del motor de relevancia — la única fuente de verdad sobre
// "qué cuenta como una oferta útil para un estudiante de Ingeniería de
// Sistemas de la EPN".
//
// Está en un archivo aparte, y NO dentro del motor, por una razón concreta:
// el vocabulario cambia mucho más seguido que la lógica de puntaje (aparece
// un stack nuevo, una empresa usa un título raro, una bolsa ecuatoriana
// escribe "practicante" en vez de "pasante"). Separarlo permite corregir
// falsos positivos sin volver a razonar el algoritmo.
//
// TODO el vocabulario se compara contra texto YA normalizado por
// `normalizeForMatch()` (minúsculas, sin tildes) — por eso acá se escribe
// "pasantia" y no "pasantía". Escribirlo con tilde sería un bug silencioso:
// nunca haría match.

// \p{Mn} (Mark, nonspacing) en vez de un rango [U+0300-U+036F] escrito a
// mano: el rango obliga a poner caracteres combinantes literales en el
// código fuente, que sobreviven mal a cambios de codificación (este repo ya
// se quemó con eso en los .ps1 bajo la codepage de Windows). Con la
// propiedad Unicode el archivo queda 100% ASCII y hace exactamente lo mismo.
const DIACRITICS = /\p{Mn}/gu;

/**
 * Minúsculas + sin tildes + espacios colapsados.
 *
 * Sin esto, "Pasantía" y "pasantia" son dos cadenas distintas y media
 * bolsa ecuatoriana se escapa del filtro. NFD descompone la letra acentuada
 * en letra + marca combinante, y DIACRITICS borra esa marca — sin tener que
 * mantener a mano una tabla á→a.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Señales de que la oferta es del dominio de Sistemas/Software.
 *
 * Se busca por palabra completa (ver `containsTerm`), no por substring:
 * "go" como substring haría match dentro de "Bogotá", "abogado" y
 * "Santiago". Ese fue el motivo real de exigir límites de palabra.
 */
export const DOMAIN_TERMS: readonly string[] = [
  // Roles
  "desarrollador", "desarrolladora", "programador", "programadora",
  "developer", "engineer", "ingeniero de software", "ingeniera de software",
  "software", "fullstack", "full stack", "frontend", "front end", "backend", "back end",
  // "tester" a secas NO está acá, y es deliberado: contra datos reales
  // hizo match con "Professional PAT Tester" (revisión eléctrica de
  // aparatos) y "MOT Tester" (revisión vehicular), que puntuaron 44 y 41 y
  // se colaban al top del listado. Solo entra calificado.
  "devops", "sre", "qa", "qa tester", "software tester", "tester de software",
  "automation tester", "arquitecto de software",
  "data engineer", "data scientist", "cientifico de datos", "analista de datos",
  "data analyst", "machine learning", "inteligencia artificial",
  "cybersecurity", "ciberseguridad", "seguridad informatica", "pentester",
  "sysadmin", "administrador de sistemas", "administrador de base de datos", "dba",
  "soporte tecnico", "help desk", "mesa de ayuda",
  "analista de sistemas", "ingeniero de sistemas", "ingeniera de sistemas",
  "mobile developer", "desarrollador movil", "android", "ios",
  // Mismo motivo que "tester": "redes" a secas es la mitad de "redes
  // sociales", y una vacante de Community Manager no es una vacante de
  // Sistemas. Va calificado.
  "cloud", "infraestructura ti", "redes de datos", "administrador de redes",
  "ingeniero de redes", "networking",
  // Stacks y herramientas (también sirven de tags, ver STACK_TAGS)
  "javascript", "typescript", "python", "java", "kotlin", "swift",
  "csharp", "c#", ".net", "dotnet", "php", "laravel", "ruby", "rails",
  "golang", "rust", "scala", "elixir",
  "react", "angular", "vue", "svelte", "next.js", "nextjs", "nuxt",
  "node", "nodejs", "node.js", "express", "nestjs", "django", "flask",
  "spring", "spring boot", "flutter", "react native",
  "sql", "postgresql", "postgres", "mysql", "oracle", "mongodb", "redis",
  "docker", "kubernetes", "aws", "azure", "gcp", "terraform",
  "git", "linux", "api rest", "graphql", "microservicios", "microservices",
];

/**
 * Ruido: ofertas que hacen match con algún término del dominio pero NO son
 * del área. Restan mucho puntaje.
 *
 * El caso real que motivó esto: "Ejecutivo Comercial — venta de software
 * contable" hace match con "software" y se colaba primero en el listado.
 * También "Docente de computación" y las de reclutamiento puro.
 */
export const NOISE_TERMS: readonly string[] = [
  "ejecutivo comercial", "asesor comercial", "asesora comercial",
  "vendedor", "vendedora", "ventas de", "fuerza de ventas",
  "call center", "telemercadeo", "cobranzas", "cajero", "cajera",
  "guardia de seguridad", "seguridad fisica", "vigilancia",
  "chofer", "conductor", "mensajero", "motorizado",
  "enfermero", "enfermera", "medico", "odontologo",
  "docente", "profesor", "profesora", "capacitador",
  "reclutador", "reclutamiento", "seleccion de personal",
  "auxiliar contable", "contador", "contadora",
  "limpieza", "conserje", "bodeguero",
  // Encontrados en datos REALES de Remote OK/Arbeitnow al probar la
  // ingesta end-to-end: oficios que llevan "tester" o "redes" en el título
  // y no tienen nada que ver con software. Están acá además de haber
  // quitado el término genérico de DOMAIN_TERMS, por si la descripción sí
  // menciona algún stack de pasada.
  "pat tester", "mot tester", "redes sociales", "community manager",
  "produce clerk", "delivery driver", "kitchen porter", "store manager",
];

/**
 * Señales de pasantía / prácticas.
 *
 * "practicas preprofesionales" es el término legal ecuatoriano (Reglamento
 * de Régimen Académico) y es EL que usan Multitrabajos y las convocatorias
 * de la EPN — omitirlo dejaba fuera justo las ofertas más relevantes para
 * un estudiante, que es el caso de uso central de este módulo.
 */
export const INTERNSHIP_TERMS: readonly string[] = [
  "pasantia", "pasantias", "pasante", "pasantes",
  "practicante", "practicantes",
  "practicas preprofesionales", "practicas pre profesionales",
  "practicas profesionales", "practica preprofesional",
  "intern", "internship", "trainee", "aprendiz",
  "estudiante universitario", "ultimos semestres", "egresado",
];

/** Señales de junior — el otro perfil que sí le sirve a un estudiante. */
export const JUNIOR_TERMS: readonly string[] = [
  "junior", "jr", "trainee", "sin experiencia", "primer empleo",
  "nivel inicial", "entry level", "recien graduado", "graduado reciente",
];

/**
 * Señales de senior. No descalifican la oferta (un estudiante de último
 * semestre puede aplicar y aprender del anuncio), pero sí la bajan: el
 * listado tiene que abrir con lo que de verdad puede tomar hoy.
 */
export const SENIOR_TERMS: readonly string[] = [
  "senior", "sr", "lead", "principal", "staff engineer",
  "arquitecto", "gerente", "jefe de", "director de", "manager",
  "head of", "5 anos de experiencia", "6 anos de experiencia",
  "7 anos de experiencia", "8 anos de experiencia", "10 anos de experiencia",
];

/** Señales de modalidad remota. */
export const REMOTE_TERMS: readonly string[] = [
  "remoto", "remota", "remote", "teletrabajo", "work from home",
  "desde casa", "100% remoto", "fully remote", "anywhere",
];

/** Señales de modalidad híbrida — se evalúan ANTES que las de remoto. */
export const HYBRID_TERMS: readonly string[] = [
  "hibrido", "hibrida", "hybrid", "semipresencial", "mixto",
];

/**
 * Señales de que la oferta es alcanzable desde Ecuador.
 *
 * Quito pesa aparte porque es donde está la EPN: una pasantía presencial en
 * Guayaquil es correcta pero inútil para la mayoría de estudiantes, y el
 * motor tiene que poder distinguir esos dos casos.
 */
export const ECUADOR_TERMS: readonly string[] = [
  "ecuador", "quito", "guayaquil", "cuenca", "ambato", "loja",
  "manta", "portoviejo", "machala", "riobamba", "ibarra", "esmeraldas",
];

export const QUITO_TERMS: readonly string[] = ["quito", "pichincha"];

/**
 * Mapa término→tag para las etiquetas de stack que ve el estudiante.
 *
 * Es un mapa y no la lista cruda de DOMAIN_TERMS porque varios términos
 * distintos son el MISMO stack ("node", "nodejs", "node.js") y mostrar los
 * tres como tres chips separados se veía roto en la UI.
 */
export const STACK_TAGS: ReadonlyMap<string, string> = new Map([
  ["javascript", "JavaScript"], ["typescript", "TypeScript"],
  ["python", "Python"], ["java", "Java"], ["kotlin", "Kotlin"], ["swift", "Swift"],
  ["c#", "C#"], ["csharp", "C#"], [".net", ".NET"], ["dotnet", ".NET"],
  ["php", "PHP"], ["laravel", "Laravel"], ["ruby", "Ruby"], ["rails", "Ruby"],
  ["golang", "Go"], ["rust", "Rust"], ["scala", "Scala"], ["elixir", "Elixir"],
  ["react native", "React Native"], ["react", "React"], ["angular", "Angular"],
  ["vue", "Vue"], ["svelte", "Svelte"], ["next.js", "Next.js"], ["nextjs", "Next.js"],
  ["nuxt", "Nuxt"],
  ["node.js", "Node.js"], ["nodejs", "Node.js"], ["node", "Node.js"],
  ["express", "Express"], ["nestjs", "NestJS"], ["django", "Django"], ["flask", "Flask"],
  ["spring boot", "Spring"], ["spring", "Spring"],
  ["flutter", "Flutter"], ["android", "Android"], ["ios", "iOS"],
  ["postgresql", "PostgreSQL"], ["postgres", "PostgreSQL"], ["mysql", "MySQL"],
  ["oracle", "Oracle"], ["mongodb", "MongoDB"], ["redis", "Redis"], ["sql", "SQL"],
  ["docker", "Docker"], ["kubernetes", "Kubernetes"], ["terraform", "Terraform"],
  ["aws", "AWS"], ["azure", "Azure"], ["gcp", "GCP"],
  ["graphql", "GraphQL"], ["linux", "Linux"], ["git", "Git"],
  ["machine learning", "Machine Learning"], ["inteligencia artificial", "IA"],
  ["ciberseguridad", "Ciberseguridad"], ["cybersecurity", "Ciberseguridad"],
  ["devops", "DevOps"], ["qa", "QA"],
]);

/**
 * ¿Aparece `term` como palabra/frase completa dentro de `haystack`?
 *
 * `haystack` ya viene normalizado. Los límites se calculan a mano en vez de
 * con `\b` porque varios términos contienen caracteres que `\b` trata como
 * frontera y romperían el match: "c#", ".net", "node.js". Con `\b`,
 * buscar "c#" en "c# developer" falla, que es exactamente el caso que hay
 * que soportar.
 */
export function containsTerm(haystack: string, term: string): boolean {
  const idx = indexOfTerm(haystack, term);
  return idx !== -1;
}

function indexOfTerm(haystack: string, term: string): number {
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(term, from);
    if (idx === -1) return -1;
    if (isBoundaryAt(haystack, idx - 1, -1) && isBoundaryAt(haystack, idx + term.length, 1)) {
      return idx;
    }
    from = idx + 1;
  }
}

/**
 * ¿La posición `idx` es una frontera de palabra?
 *
 * `dir` indica hacia dónde sigue el texto que NO es el término (-1 mirando
 * hacia atrás, +1 hacia adelante); hace falta para resolver el punto.
 *
 * El punto es el caso difícil y el que hizo fallar al spec: tratarlo
 * siempre como frontera rompe ".net" y "node.js"; nunca tratarlo como
 * frontera rompe el punto de final de frase ("semipresencial." dejaba de
 * hacer match). La regla correcta es contextual — un punto solo une
 * palabras si del otro lado hay letra o dígito.
 */
function isBoundaryAt(haystack: string, idx: number, dir: -1 | 1): boolean {
  if (idx < 0 || idx >= haystack.length) return true; // inicio/fin del texto
  const ch = haystack[idx];
  if (/[a-z0-9#+]/.test(ch)) return false; // claramente parte de una palabra
  if (ch === ".") {
    const beyond = haystack[idx + dir];
    return beyond === undefined || !/[a-z0-9]/.test(beyond);
  }
  return true;
}

/** Cuenta cuántos términos de la lista aparecen en el texto. */
export function countTerms(haystack: string, terms: readonly string[]): number {
  let n = 0;
  for (const t of terms) if (containsTerm(haystack, t)) n += 1;
  return n;
}

/** El primer término de la lista que aparezca, o null. */
export function firstTerm(haystack: string, terms: readonly string[]): string | null {
  for (const t of terms) if (containsTerm(haystack, t)) return t;
  return null;
}
