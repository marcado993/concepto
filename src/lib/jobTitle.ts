// Los portales publican muchos títulos ENTEROS EN MAYÚSCULAS
// ("PASANTE BUSINESS INTELLIGENCE", "DESARROLLADOR JUNIOR PARA QUITO").
//
// Eso no es solo estética: el texto en mayúsculas elimina la silueta de la
// palabra — las ascendentes y descendentes que hacen que "pasante" se
// reconozca de un vistazo sin deletrearla — y es de las cosas que más
// entorpecen la lectura a alguien con dislexia. Por eso los títulos gritados
// se pasan a Capitalización de Título ANTES de mostrarlos.
//
// Solo se toca lo que de verdad viene gritado: un título escrito
// normalmente no se altera, porque reescribir algo bien escrito es tan malo
// como dejar el grito.

/**
 * Siglas que DEBEN quedar en mayúsculas.
 *
 * Sin esta lista, "PASANTE TI" terminaba como "Pasante Ti" y "ANALISTA SQL"
 * como "Analista Sql" — que se lee peor que el original, porque una sigla en
 * minúscula deja de parecer una sigla.
 *
 * Es una lista explícita y no una heurística a propósito. Lo tentador sería
 * "toda palabra de 2-3 letras es una sigla", pero eso convierte "Web", "App"
 * y "Red" en "WEB", "APP" y "RED" — o sea, vuelve a gritar justo lo que este
 * archivo existe para dejar de gritar. El costo de la lista es que una sigla
 * desconocida sale como "Sgi" en vez de "SGI": legible igual, solo un poco
 * torpe, y se arregla agregándola acá.
 */
const SIGLAS = new Set([
  "TI", "IT", "QA", "BI", "SQL", "API", "UX", "UI", "PHP", "SAP", "ERP", "CRM",
  "RRHH", "NOC", "SOC", "AWS", "GCP", "SEO", "SEM", "ETL", "BPM", "PMO", "CTO",
  "CEO", "CI", "CD", "ML", "IA", "AI", "QAA", "SRE", "DBA", "VPN", "LAN", "WAN",
  "HTML", "CSS", "JS", "PHP", "NET", "SAAS", "B2B", "B2C", "EPN", "UIO", "GYE",
  // Siglas frecuentes en avisos ecuatorianos, vistas en datos reales:
  // sistemas de gestión, normativa y entidades del país.
  "SGI", "SGC", "SGA", "SST", "SSO", "TIC", "TICS", "SIG", "ISO", "IESS",
  "SRI", "MSP", "POS", "PDV", "GYE", "PYME", "PYMES",
]);

/**
 * Palabras que van en minúscula dentro de un título, salvo al inicio.
 *
 * Es lo que separa "Pasante De Sistemas De La Empresa" (que se lee a
 * tropezones) de "Pasante de Sistemas de la Empresa".
 */
const MINUSCULAS = new Set([
  "de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "en", "para",
  "por", "con", "sin", "a", "al", "un", "una", "the", "of", "and", "for", "in",
]);

/** Proporción de letras en mayúscula a partir de la cual se considera gritado. */
const UMBRAL_GRITADO = 0.6;

function estaGritado(texto: string): boolean {
  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  // Menos de 4 letras no alcanza para juzgar: "QA" o "TI" son siglas
  // legítimas, no un grito.
  if (letras.length < 4) return false;
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
  return mayus / letras.length >= UMBRAL_GRITADO;
}

function capitalizarPalabra(palabra: string, esPrimera: boolean): string {
  // Se compara la parte alfabética para no fallar con "TI:" o "(QA)".
  const soloLetras = palabra.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  if (SIGLAS.has(soloLetras.toUpperCase())) return palabra.toUpperCase();

  const baja = palabra.toLowerCase();
  if (!esPrimera && MINUSCULAS.has(baja)) return baja;

  // Se capitaliza la primera LETRA, no el primer carácter: así "(pasante"
  // queda "(Pasante" y no "(pasante".
  return baja.replace(/[a-záéíóúüñ]/, (c) => c.toUpperCase());
}

/**
 * Deja el título legible.
 *
 * Si viene gritado lo pasa a Capitalización de Título; si ya viene bien
 * escrito lo devuelve intacto.
 */
export function tituloLegible(titulo: string): string {
  const limpio = (titulo ?? "").trim().replace(/\s+/g, " ");
  if (!limpio || !estaGritado(limpio)) return limpio;

  return limpio
    .split(" ")
    .map((p, i) => capitalizarPalabra(p, i === 0))
    .join(" ");
}
