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
  // --- Datos: ciencia, ingenieria, analitica, BI, gobernanza ---
  // La carrera de Sistemas de la EPN no es solo desarrollo. Antes el
  // vocabulario cubria casi puro "developer" y dejaba fuera areas enteras
  // en las que sus egresados si trabajan — por eso esta seccion y las tres
  // de abajo existen.
  "data engineer", "data scientist", "cientifico de datos", "cientifica de datos",
  "analista de datos", "data analyst", "ingeniero de datos", "ingeniera de datos",
  "ciencia de datos", "analitica de datos", "analitica", "big data",
  "business intelligence", "inteligencia de negocios", "power bi", "tableau",
  "data warehouse", "datamart", "etl", "elt", "pipeline de datos",
  "gobernanza de datos", "calidad de datos", "gobierno de datos",
  "machine learning", "aprendizaje automatico", "inteligencia artificial",
  "deep learning", "mlops", "modelos predictivos", "estadistica aplicada",
  "base de datos", "bases de datos", "administrador de base de datos", "dba",
  // --- Ciberseguridad ---
  "cybersecurity", "ciberseguridad", "seguridad informatica",
  "seguridad de la informacion", "seguridad ofensiva", "seguridad defensiva",
  "pentester", "pentesting", "ethical hacking", "hacking etico",
  // "soc" a secas NO va: en Ecuador las empresas se escriben "Acme Soc.
  // Anonima" y el nombre de la empresa entra al texto que se evalua, asi
  // que cualquier vacante de esa empresa habria hecho match. Mismo criterio
  // que "tester" y "redes".
  "analista de seguridad", "ingeniero de seguridad", "siem",
  "analista soc", "centro de operaciones de seguridad",
  "respuesta a incidentes", "forense digital", "informatica forense",
  "gestion de vulnerabilidades", "iso 27001", "owasp", "blue team", "red team",
  // --- Gobernanza / gestion de TI ---
  "gobernanza de ti", "gobierno de ti", "gobernanza it", "gestion de ti",
  "auditoria de sistemas", "auditor de sistemas", "auditoria informatica",
  "cobit", "itil", "gestion de riesgos tecnologicos", "continuidad del negocio",
  "cumplimiento normativo", "jefe de tecnologia", "coordinador de ti",
  "analista de procesos", "mejora de procesos", "bpm",
  "gestion de proyectos de ti", "scrum master", "product owner",
  // --- Computacion, sistemas, infraestructura ---
  "computacion", "ingenieria en computacion", "ciencias de la computacion",
  "sysadmin", "administrador de sistemas", "administrador de servidores",
  "soporte tecnico", "help desk", "mesa de ayuda", "service desk",
  "analista de sistemas", "ingeniero de sistemas", "ingeniera de sistemas",
  "ingeniero en sistemas", "ingeniera en sistemas", "tecnologias de la informacion",
  // "tecnologia"/"tecnologias" a secas SI entran: "Trainee de Tecnologia" y
  // "Pasante de Tecnologia" son titulos reales y frecuentes en Ecuador, y
  // sin esto el motor los detectaba como pasantia, les daba 71 puntos y aun
  // asi los descartaba por no encontrar ni una senal del area. Lo comercial
  // ("Vendedor de tecnologia", "Asesor comercial de tecnologia") ya lo
  // frena el ruido del titulo, que castiga mucho mas de lo que suma esto.
  "tecnologia", "tecnologias",
  // "sistemas" SUELTO. Es EL titulo del area en Ecuador ("Pasante de
  // Sistemas", "Auxiliar de Sistemas", "Tecnico en Sistemas") y la carrera
  // se llama asi. Estaba solo calificado ("analista de sistemas",
  // "ingeniero de sistemas"...), y como las bolsas locales no publican
  // descripcion, un "Pasante de Sistemas" de Computrabajo se quedaba sin
  // UNA sola senal del area y puntuaba 0. Los choques reales
  // ("sistemas de gestion", "sistemas contables") van a NOISE_TERMS.
  "sistemas",
  // "ti" NUNCA va suelto: en espanol es un pronombre ("un plan pensado para
  // ti") y aparece en cualquier descripcion de beneficios. Solo calificado
  // por el rol que lo acompana.
  "trainee ti", "pasante ti", "practicante ti", "analista ti", "soporte ti",
  "coordinador ti", "coordinadora ti", "jefe de ti", "gerente de ti",
  "area de ti", "departamento de ti", "auxiliar ti", "asistente ti",
  // "desarrollo" tampoco va suelto: "desarrollo organizacional",
  // "desarrollo comercial" y "desarrollo humano" son puestos de RRHH y
  // ventas muy comunes aca. Van las formas que si son inequivocas.
  "desarrollo de software", "desarrollo web", "desarrollo movil",
  "desarrollo de aplicaciones", "desarrollo de sistemas", "desarrollo backend",
  "desarrollo frontend", "desarrollo full stack",
  // "servidores" a secas tampoco: "servidor publico" / "servidores
  // publicos" es como se llama a los funcionarios del Estado en Ecuador, y
  // toda convocatoria publica lo usa. Va solo calificado (arriba ya esta
  // "administrador de servidores").
  "virtualizacion", "vmware", "windows server", "active directory",
  "mobile developer", "desarrollador movil", "android", "ios",
  // Vistos en avisos REALES de Computrabajo que se caian por no tener ni
  // una senal: "Pasante de Aplicaciones", "Tecnico de Computadoras",
  // "Web master", "Disenador web wordpress". Son del area y el titulo era
  // lo unico que el motor podia leer, porque esa bolsa no publica
  // descripcion en el listado (verificado abriendo sus tarjetas: solo
  // traen empresa, ciudad y fecha).
  //
  // "web" NO va suelto: es la mitad de "marketing web" y "pagina web" en
  // avisos comerciales. Va en las formas que si son del area.
  "aplicaciones", "aplicaciones web", "aplicaciones moviles",
  "computadoras", "computadores",
  "web master", "webmaster", "diseno web", "sitio web", "wordpress",
  // --- Redes y telecomunicaciones ---
  // "redes" AHORA VA SUELTO, y antes no. Enumerar cada forma ("administrador
  // de redes", "ingeniero de redes"...) fallaba con la variedad real de los
  // avisos: medido en produccion, "Administrador/a de redes" quedaba fuera
  // solo por la barra de la forma inclusiva, y "Tecnico auxiliar en redes,
  // pc, impresoras" tambien. El unico choque real es "redes sociales", y ese
  // se resuelve mejor desde NOISE_TERMS — ahi rebaja la oferta entera en vez
  // de obligar a adivinar de antemano todas las formas de escribir un puesto.
  "redes",
  "cloud", "infraestructura ti", "infraestructura tecnologica",
  "redes de datos", "administrador de redes", "ingeniero de redes",
  "analista de redes", "soporte de redes", "networking", "telecomunicaciones",
  "cisco", "ccna", "mikrotik", "fortinet", "firewall", "vpn", "lan", "wan",
  "cableado estructurado", "fibra optica", "noc",
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
  // Puestos de RRHH y ventas que llevan "desarrollo" o "tecnologia" en el
  // titulo. Se agregan junto con esos terminos: sin ellos, ampliar el
  // vocabulario habria dejado entrar justo estos.
  "desarrollo organizacional", "desarrollo humano", "desarrollo comercial",
  "desarrollo social", "desarrollo de negocio", "desarrollo de negocios",
  "desarrollo de mercado", "desarrollo de proveedores",
  // Choques directos de los terminos sueltos "redes" y "sistemas", que se
  // abrieron a proposito (ver DOMAIN_TERMS). Aca rebajan la oferta entera,
  // que es mas fiable que intentar enumerar de antemano todas las formas
  // validas de escribir un puesto del area.
  "redes sociales", "community manager", "gestion de redes sociales",
  "sistemas de gestion", "sistema de gestion", "sistemas contables",
  "sistemas integrados de gestion", "sistemas de calidad",
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
 * Señales de que un puesto remoto está ABIERTO al mundo, no encerrado en
 * un país.
 *
 * Distinguirlo importa más de lo que parece: "Remote — Munich" o
 * "Full Remote aus Bayern" NO significan que contraten desde Ecuador,
 * significan "trabajás desde tu casa, en Alemania". Piden permiso de
 * trabajo local y casi siempre el idioma. Contarlos como alcanzables
 * llenaba el listado de vacantes a las que un estudiante de la EPN no
 * puede postular — medido en producción: 10 de las remotas venían atadas
 * a una ciudad alemana o al Reino Unido.
 *
 * "latam" y "america latina" entran porque ahí Ecuador SÍ está incluido.
 */
export const GLOBAL_REMOTE_TERMS: readonly string[] = [
  "worldwide", "anywhere", "global", "globally", "international",
  "latam", "america latina", "latinoamerica", "latin america",
  "cualquier lugar", "sin importar", "any country", "remote first",
];

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
  ["deep learning", "Machine Learning"], ["mlops", "MLOps"],
  ["ciberseguridad", "Ciberseguridad"], ["cybersecurity", "Ciberseguridad"],
  ["seguridad informatica", "Ciberseguridad"], ["pentesting", "Pentesting"],
  ["ethical hacking", "Pentesting"], ["siem", "SIEM"],
  ["centro de operaciones de seguridad", "SOC"], ["analista soc", "SOC"],
  ["iso 27001", "ISO 27001"], ["owasp", "OWASP"],
  ["devops", "DevOps"], ["qa", "QA"],
  // Datos y BI — el estudiante que busca "datos" filtra por estos chips,
  // asi que las variantes ("business intelligence"/"inteligencia de
  // negocios") colapsan al mismo tag, igual que node/nodejs/node.js.
  ["ciencia de datos", "Ciencia de Datos"], ["data science", "Ciencia de Datos"],
  ["big data", "Big Data"], ["power bi", "Power BI"], ["tableau", "Tableau"],
  ["business intelligence", "BI"], ["inteligencia de negocios", "BI"],
  ["data warehouse", "Data Warehouse"], ["etl", "ETL"],
  ["gobernanza de datos", "Gobernanza de Datos"],
  ["gobierno de datos", "Gobernanza de Datos"],
  // Gobernanza y gestion de TI
  ["gobernanza de ti", "Gobernanza TI"], ["gobierno de ti", "Gobernanza TI"],
  ["cobit", "COBIT"], ["itil", "ITIL"],
  ["auditoria de sistemas", "Auditoria TI"], ["auditoria informatica", "Auditoria TI"],
  ["scrum master", "Scrum"],
  // Redes e infraestructura
  ["cisco", "Cisco"], ["ccna", "Cisco"], ["fortinet", "Fortinet"],
  ["mikrotik", "MikroTik"], ["telecomunicaciones", "Redes"],
  ["redes de datos", "Redes"], ["administrador de redes", "Redes"],
  ["ingeniero de redes", "Redes"], ["networking", "Redes"],
  ["vmware", "VMware"], ["active directory", "Active Directory"],
  ["windows server", "Windows Server"],
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
