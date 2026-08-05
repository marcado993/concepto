export type IconKind = "lockers" | "events" | "resources" | "community" | "security";
export type LockerStatus = "available" | "occupied" | "reserved";

export interface LockerUnit {
  id: string;
  number: string;
  status: LockerStatus;
  zone: string;
}

export interface EventItem {
  id: string;
  day: string;
  month: string;
  title: string;
  time: string;
  tag: string;
}

export interface ResourceItem {
  id: string;
  name: string;
  description: string;
  tag: string;
  stat1Label: string;
  stat1: number;
  stat2Label: string;
  stat2: number;
  updated: string;
}

export interface NewsItem {
  id: string;
  tag: string;
  title: string;
  excerpt: string;
  time: string;
  author: string;
}

export type RiskLevel = "low" | "moderate" | "high";

export interface SecurityIndicator {
  id: string;
  label: string;
  value: string;
  unit: string;
  risk: RiskLevel;
  /** Prior-period comparison, e.g. "248 en 2024" — shown as context. */
  note: string;
  /** Direction vs the prior period; drives the ▲/▼ marker. */
  trend?: "up" | "down" | "flat";
}

/** Every section stays inside the AEIS identity (navy + circuit green) —
 *  these are hue-rotated siblings of the same accent, not arbitrary colors. */
export interface CategoryTheme {
  accent: string;
  accentDim: string;
  deep: string;
  glow: string;
  hue: number;
}

export interface Category {
  id: "lockers" | "events" | "resources" | "community" | "security";
  label: string;
  sublabel: string;
  prompt: string;
  icon: IconKind;
  detailTitle: string;
  theme: CategoryTheme;
  lockers?: LockerUnit[];
  events?: EventItem[];
  resources?: ResourceItem[];
  news?: NewsItem[];
  security?: SecurityIndicator[];
}

function makeLockers(zone: string, count: number, seed: number): LockerUnit[] {
  const statuses: LockerStatus[] = ["available", "occupied", "reserved"];
  return Array.from({ length: count }, (_, i) => ({
    id: `${zone}-${i}`,
    number: `${zone}${String(i + 1).padStart(2, "0")}`,
    status: statuses[(i + seed) % statuses.length],
    zone,
  }));
}

export const categories: Category[] = [
  {
    id: "lockers",
    label: "Casilleros",
    sublabel: "Bloque A · Ingeniería",
    prompt: "Elige esto para consultar tus casilleros",
    icon: "lockers",
    detailTitle: "Casilleros disponibles",
    theme: { accent: "#21e0a0", accentDim: "#0f6a52", deep: "#08301f", glow: "rgba(33, 224, 160, 0.45)", hue: 0 },
    lockers: makeLockers("A", 9, 0),
  },
  {
    id: "events",
    label: "Eventos",
    sublabel: "Actividades AEIS",
    prompt: "Elige esto para ver los próximos eventos",
    icon: "events",
    detailTitle: "Fechas importantes",
    theme: { accent: "#2fb8e0", accentDim: "#114b5f", deep: "#08222f", glow: "rgba(47, 184, 224, 0.45)", hue: 35 },
    events: [
      { id: "ev1", day: "24", month: "MAR", title: "Hackathon AEIS 2026", time: "09:00 · Auditorio principal", tag: "Hackathon" },
      { id: "ev2", day: "02", month: "ABR", title: "Charla: IA en Sistemas", time: "17:00 · Aula 301", tag: "Charla" },
      { id: "ev3", day: "15", month: "ABR", title: "Taller de Redes", time: "14:00 · Laboratorio 2", tag: "Taller" },
      { id: "ev4", day: "28", month: "ABR", title: "Asamblea general", time: "18:00 · Auditorio principal", tag: "Asamblea" },
      { id: "ev5", day: "10", month: "MAY", title: "Torneo de programación", time: "10:00 · Sala de cómputo", tag: "Competencia" },
    ],
  },
  {
    id: "resources",
    label: "Recursos",
    sublabel: "Racks y equipos",
    prompt: "Elige esto para reservar recursos y equipos",
    icon: "resources",
    detailTitle: "Recursos disponibles",
    theme: { accent: "#35d6b4", accentDim: "#0f6658", deep: "#082b26", glow: "rgba(53, 214, 180, 0.4)", hue: 5 },
    resources: [
      {
        id: "r1",
        name: "lab-inteligencia-artificial",
        description: "Equipos con GPU para proyectos de machine learning y visión por computador.",
        tag: "Hardware",
        stat1Label: "Disponibles",
        stat1: 4,
        stat2Label: "En uso",
        stat2: 2,
        updated: "hace 3 días",
      },
      {
        id: "r2",
        name: "sala-servidores",
        description: "Rack de servidores para desplegar proyectos y prácticas estudiantiles.",
        tag: "Infraestructura",
        stat1Label: "Nodos",
        stat1: 8,
        stat2Label: "Activos",
        stat2: 6,
        updated: "hace 1 semana",
      },
      {
        id: "r3",
        name: "kit-electronica",
        description: "Componentes, sensores y placas de desarrollo para prototipado.",
        tag: "Electrónica",
        stat1Label: "Kits",
        stat1: 12,
        stat2Label: "Prestados",
        stat2: 5,
        updated: "hace 2 días",
      },
      {
        id: "r4",
        name: "biblioteca-tecnica",
        description: "Libros, papers y guías de ingeniería de sistemas.",
        tag: "Material",
        stat1Label: "Títulos",
        stat1: 56,
        stat2Label: "Nuevos",
        stat2: 3,
        updated: "hace 5 días",
      },
    ],
  },
  {
    id: "community",
    label: "Comunidad",
    sublabel: "Miembros AEIS",
    prompt: "Elige esto para conectar con la comunidad",
    icon: "community",
    detailTitle: "Noticias de la comunidad",
    theme: { accent: "#5b8def", accentDim: "#1c2f66", deep: "#0a1230", glow: "rgba(91, 141, 239, 0.4)", hue: 57 },
    news: [
      {
        id: "n1",
        tag: "Logro",
        title: "Equipo AEIS gana hackathon regional",
        excerpt: "Tres estudiantes representaron a la asociación y obtuvieron el primer lugar.",
        time: "hace 2 días",
        author: "Comité AEIS",
      },
      {
        id: "n2",
        tag: "Bienvenida",
        title: "Nuevos miembros se unen este semestre",
        excerpt: "Más de 40 estudiantes se inscribieron en la jornada de afiliación.",
        time: "hace 4 días",
        author: "Secretaría",
      },
      {
        id: "n3",
        tag: "Alianza",
        title: "Convenio con empresa de tecnología local",
        excerpt: "Se abrirán pasantías exclusivas para miembros activos de AEIS.",
        time: "hace 1 semana",
        author: "Comité AEIS",
      },
      {
        id: "n4",
        tag: "Recordatorio",
        title: "Actualiza tu perfil en la plataforma",
        excerpt: "Es necesario para acceder a casilleros y recursos este semestre.",
        time: "hace 1 semana",
        author: "Soporte",
      },
    ],
  },
  {
    id: "security",
    label: "Seguridad",
    sublabel: "Alarma · Zona campus",
    prompt: "Elige esto para ver el estado de seguridad de tu zona",
    icon: "security",
    detailTitle: "Alarma",
    // Placeholder — App.svelte overrides this with themeForRisk(currentHour)
    // so the module's tone tracks the clock instead of sitting fixed.
    theme: { accent: "#f5b942", accentDim: "#4d3a12", deep: "#241c0a", glow: "rgba(245, 185, 66, 0.4)", hue: 0 },
    // Real published figures for the Distrito Metropolitano de Quito, close
    // of 2025, from the Observatorio Metropolitano de Seguridad Ciudadana
    // (Policía Nacional + Fiscalía), as reported by Primicias in Jan 2026.
    // These are annual totals, not a live feed — the DMQ's own per-month
    // DataHub sits behind a login, so anything auto-refreshing would be
    // guesswork. Values are labelled with their period for that reason.
    security: [
      {
        id: "s1",
        label: "Tasa de homicidios",
        value: "9",
        unit: "por 100.000 hab. · 2025",
        risk: "moderate",
        note: "8 en 2024",
        trend: "up",
      },
      {
        id: "s2",
        label: "Homicidios intencionales",
        value: "264",
        unit: "casos · 2025",
        risk: "moderate",
        note: "248 en 2024",
        trend: "up",
      },
      {
        id: "s3",
        label: "Violencia criminal",
        value: "204",
        unit: "casos · 2025",
        risk: "high",
        note: "179 en 2024",
        trend: "up",
      },
      {
        id: "s4",
        label: "Riñas interpersonales",
        value: "60",
        unit: "casos · 2025",
        risk: "low",
        note: "69 en 2024",
        trend: "down",
      },
      {
        id: "s5",
        label: "Con arma de fuego",
        value: "163",
        unit: "casos · 2025",
        risk: "high",
        note: "143 en 2024",
        trend: "up",
      },
      {
        id: "s6",
        label: "Incidentes Centro Histórico",
        value: "14.842",
        unit: "convivencia · 2025",
        risk: "moderate",
        note: "17.449 en 2024",
        trend: "down",
      },
    ],
  },
];
