export type IconKind = "lockers" | "events" | "resources" | "community" | "security" | "subscriptions";
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

/** Shape que devuelve GET /subscriptions/tiers — coincide con lo que
 *  retorna SubscriptionService.listTiers() (backend/src/subscription/).
 *  `amount` llega como string: Prisma serializa Decimal así por JSON, no
 *  como number nativo. `benefits` es JSON libre en el schema (a propósito,
 *  ver prisma/schema.prisma) — se tipa aquí solo lo que el frontend
 *  necesita leer, sin asumir que es la lista completa de lo que trae. */
export interface SubscriptionBenefit {
  type: string;
  percent?: number;
  included?: boolean;
}

export interface SubscriptionTierPublic {
  id: string;
  name: string;
  amount: string;
  benefits: SubscriptionBenefit[];
}

/** Shape que devuelve GET /ventures — coincide con VenturePublic del
 *  backend (backend/src/venture/venture.service.ts). Nunca trae el número
 *  de WhatsApp crudo ni el ownerId, solo el link ya armado. */
export interface VenturePublic {
  id: string;
  name: string;
  description: string;
  category: string;
  photoUrl: string | null;
  whatsappLink: string;
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
  id: "lockers" | "events" | "resources" | "community" | "security" | "subscriptions";
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
  ventures?: VenturePublic[];
  tiers?: SubscriptionTierPublic[];
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
    label: "Emprendimientos",
    sublabel: "Politécnicos emprendedores",
    prompt: "Elige esto para descubrir emprendimientos de estudiantes",
    icon: "community",
    detailTitle: "Directorio de emprendimientos",
    theme: { accent: "#5b8def", accentDim: "#1c2f66", deep: "#0a1230", glow: "rgba(91, 141, 239, 0.4)", hue: 57 },
    // Reemplaza "Comunidad" (docs/dominio/01-analisis-negocio-mision.md §4)
    // — vitrina + contacto WhatsApp, pedida al backend (fetchVentures en
    // api.ts), igual que security. `news`/NewsItem se dejan sin usar aquí
    // a propósito, no se borra el tipo por si algún día vuelve a hacer
    // falta un feed real de noticias.
  },
  {
    id: "subscriptions",
    label: "Aportaciones",
    sublabel: "Bronce · Platino · Pantera",
    prompt: "Elige esto para apoyar a AEIS y ver tus beneficios",
    icon: "subscriptions",
    detailTitle: "Tiers de aportación",
    theme: { accent: "#e0b23c", accentDim: "#5a4512", deep: "#2a2008", glow: "rgba(224, 178, 60, 0.4)", hue: 45 },
    // `tiers` se pide al backend (fetchSubscriptionTiers en api.ts) — los
    // 3 tiers reales (Bronce/Platino/Pantera) viven en la base de datos
    // (SubscriptionTier), no hardcodeados aquí, porque el precio y los
    // beneficios de cada uno son una decisión de negocio que ya cambió una
    // vez en el histórico real (docs/dominio/03-analisis-financiero-costos.md §3).
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
    // `security` ya NO vive hardcodeado aquí — se pide al backend
    // (fetchSecurityIndicators en api.ts) y App.svelte lo fusiona en tiempo
    // de ejecución. Antes esta misma lista de 6 indicadores estaba
    // duplicada en dos lugares (frontend y, ahora, backend/src/security/
    // indicators.ts); mantenerla en un solo lugar es lo que permite
    // actualizar las cifras reales sin redesplegar el frontend. Ver
    // docs/dominio/05-metodologia-devsecops-pipeline.md §7 (auditoría del
    // mapa) y App.svelte (carga + fusión).
  },
];
