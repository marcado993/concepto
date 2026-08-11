<script lang="ts">
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category, LockerStatus } from "./data";

  interface Props {
    category: Category;
    // A separate, always-the-same reference to the Seguridad category —
    // NOT just `category` when it happens to be active. See the note by
    // the map block below for why this exists.
    securityCategory?: Category | null;
    securityRisk?: number;
    /** true si fetchSecurityIndicators() falló — distingue "cargando" de "no se pudo". */
    securityIndicatorsError?: boolean;
    /** true si fetchVentures() falló — mismo patrón que securityIndicatorsError. */
    venturesError?: boolean;
    /** true si fetchLockers() falló — mismo patrón que securityIndicatorsError. */
    lockersError?: boolean;
    /** Desktop full-screen layout: let grids breathe into more columns. */
    wide?: boolean;
    // Only wired up by the mobile sliding sheet, so its header doubles as a
    // drag handle — the desktop panel just omits these.
    onheaderpointerdown?: (e: PointerEvent) => void;
    onheaderpointermove?: (e: PointerEvent) => void;
    onheaderpointerup?: (e: PointerEvent) => void;
    /** Se llama tras un alquiler exitoso, para que App.svelte vuelva a pedir /lockers. */
    onlockerrented?: () => void;
  }

  let {
    category,
    securityCategory = null,
    securityRisk = 0.5,
    securityIndicatorsError = false,
    venturesError = false,
    lockersError = false,
    wide = false,
    onheaderpointerdown,
    onheaderpointermove,
    onheaderpointerup,
    onlockerrented,
  }: Props = $props();

  // SecurityMap se importa de forma estática — mapWarm.ts ya arrancó el
  // mapa durante el splash, así que el componente puede usarlo de inmediato.
  import SecurityMapComp from "./SecurityMap.svelte";
  import RentLockerModal from "./RentLockerModal.svelte";

  let rentingLockerCode = $state<string | null>(null);

  let mapReady = $state(false);

  // Cuando el sheet se abre y el mapa ya está listo, forzamos resize
  // para que llene el contenedor correctamente (el tamaño cambia al
  // animarse el slide del sheet).
  $effect(() => {
    if (isSecurityActive && mapReady) {
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 420);
    }
  });

  const isSecurityActive = $derived(category.id === "security");

  const riskLabel: Record<"low" | "moderate" | "high", string> = {
    low: "Bajo",
    moderate: "Moderado",
    high: "Alto",
  };

  const statusLabel: Record<LockerStatus, string> = {
    available: "Libre",
    occupied: "Ocupado",
    reserved: "Reservado",
  };

  function initials(name: string) {
    return name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  // Un tono por categoría, no una paleta fija a mano — el estudiante que
  // sube un emprendimiento puede escribir cualquier texto en "categoría",
  // así que un mapa hardcodeado ("Alimentos" → naranja) se rompería con la
  // primera categoría nueva. Un hash determinístico da el mismo color
  // siempre para la misma palabra, sin mantenimiento, y sigue cumpliendo
  // el objetivo real: que el ojo agrupe tarjetas de la misma categoría por
  // color al escanear la grilla (categorización rápida, efecto Von
  // Restorff — una grilla monocroma se vuelve ruido visual).
  function categoryHue(category: string): number {
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = (hash * 31 + category.charCodeAt(i)) % 360;
    }
    return hash;
  }

  const theme = $derived(category.theme);
  const wrapStyle = $derived(
    `--sheet-accent: ${theme.accent}; --sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep}; --sheet-glow: ${theme.glow}; --sheet-hue: ${theme.hue}deg;`
  );
</script>

<div class="content-wrap" class:wide style={wrapStyle}>
  <header
    class="sheet-header"
    onpointerdown={onheaderpointerdown}
    onpointermove={onheaderpointermove}
    onpointerup={onheaderpointerup}
    onpointercancel={onheaderpointerup}
  >
    <h2>{category.label}</h2>
    <div class="icon-cluster">
      <IsoIcon kind={category.icon} size={128} />
    </div>
    <p class="sheet-sub">{category.detailTitle}</p>
  </header>

  <div class="sheet-body">
    {#if category.id === "lockers" && category.lockers}
      {#if lockersError}
        <p class="fetch-error">No se pudo cargar la disponibilidad real de casilleros — intenta más tarde.</p>
      {/if}
      <div class="grid">
        {#each category.lockers as unit (unit.id)}
          <button
            class="unit"
            class:dim={unit.status !== "available"}
            disabled={unit.status !== "available"}
            onclick={() => (rentingLockerCode = unit.number)}
            aria-label="Alquilar casillero {unit.number}"
          >
            <IsoIcon unit status={unit.status} size={64} />
            <span class="unit-number">{unit.number}</span>
            <span class="unit-status status-{unit.status}">{statusLabel[unit.status]}</span>
          </button>
        {/each}
      </div>
    {:else if category.id === "events" && category.events}
      <div class="timeline">
        {#each category.events as ev (ev.id)}
          <div class="event-row">
            <div class="event-date">
              <span class="event-day">{ev.day}</span>
              <span class="event-month">{ev.month}</span>
            </div>
            <div class="event-line"></div>
            <div class="event-body">
              <span class="event-tag">{ev.tag}</span>
              <h3 class="event-title">{ev.title}</h3>
              <p class="event-time">{ev.time}</p>
            </div>
          </div>
        {/each}
      </div>
    {:else if category.id === "resources" && category.resources}
      <div class="repo-list">
        {#each category.resources as r (r.id)}
          <div class="repo-card">
            <div class="repo-head">
              <span class="repo-dot"></span>
              <h3 class="repo-name">{r.name}</h3>
            </div>
            <p class="repo-desc">{r.description}</p>
            <div class="repo-foot">
              <span class="repo-tag">{r.tag}</span>
              <span class="repo-stat">⬡ {r.stat1} {r.stat1Label}</span>
              <span class="repo-stat">◆ {r.stat2} {r.stat2Label}</span>
              <span class="repo-updated">{r.updated}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else if category.id === "community"}
      <!-- "Comunidad" reemplazado por Emprendimientos — vitrina +
           contacto WhatsApp, sin chat propio (docs/dominio/
           01-analisis-negocio-mision.md §4). El id interno se queda como
           "community" a propósito: renombrarlo tocaría IconKind/ArcMenu/
           IsoIcon sin necesidad real, cuando lo único que cambió es el
           contenido, no la mecánica de navegación. -->
      <div class="news-list venture-grid">
        {#if category.ventures}
          {#each category.ventures as v (v.id)}
            <article class="venture-card" style="--v-hue: {categoryHue(v.category)}">
              <div class="venture-media">
                {#if v.photoUrl}
                  <img src={v.photoUrl} alt={v.name} loading="lazy" />
                {:else}
                  <div class="venture-media-fallback">{initials(v.name)}</div>
                {/if}
                <span class="venture-badge">{v.category}</span>
              </div>
              <div class="venture-body">
                <h3 class="venture-name">{v.name}</h3>
                <p class="venture-desc">{v.description}</p>
                <a class="venture-cta" href={v.whatsappLink} target="_blank" rel="noreferrer">
                  <svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.06-1.36A10 10 0 1 0 12 2Zm0 18.2a8.15 8.15 0 0 1-4.16-1.14l-.3-.18-3 .8.8-2.93-.2-.31A8.2 8.2 0 1 1 12 20.2Zm4.5-6.13c-.24-.12-1.44-.71-1.66-.8-.22-.08-.38-.12-.55.12-.16.24-.63.8-.77.96-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.42-1.33-1.66-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z"
                    />
                  </svg>
                  Escribir por WhatsApp
                </a>
              </div>
            </article>
          {/each}
          {#if category.ventures.length === 0}
            <p class="sec-note">Todavía no hay emprendimientos aprobados en el directorio.</p>
          {/if}
        {:else if venturesError}
          <p class="sec-note">No se pudo cargar el directorio de emprendimientos.</p>
        {:else}
          <p class="sec-note">Cargando emprendimientos…</p>
        {/if}
      </div>
    {/if}

    <!-- Seguridad is NOT in the {#if/:else if} chain above on purpose. It's
         keyed off `securityCategory` — a reference that stays the same
         object whether or not Seguridad is the active section — and only
         hidden with CSS `display: none` while another category shows.
         Branching it like the others (`{:else if category.id === ...}`)
         would tear the whole block down, including the mounted
         <SecurityMapComp>, every single time you navigated away — which
         meant every return trip paid for a brand-new WebGL context plus a
         fresh style/sprite/glyph/tile fetch from a third-party host. On
         localhost that round trip is near-zero; on a real deploy it reads
         as the module hanging for a second on every visit. -->
    {#if securityCategory}
      <!--
        SecurityMap monta/desmonta cuando el usuario navega a/desde Seguridad.
        Con el Map Singleton (mapWarm.ts), el costo es solo un movimiento de DOM
        — no new Map(), no workers. El mapa ya estaba cálido desde el splash.

        `security` (los 6 indicadores) ahora se pide al backend de forma
        asíncrona (App.svelte, fetchSecurityIndicators) — a propósito NO se
        usa como condición de este panel: si se gatilla en `.security`, el
        mapa entero desaparece mientras carga o si el backend no responde.
        El mapa se mantiene siempre montado; solo la grilla de indicadores
        de abajo tiene su propio estado de carga/error.
      -->
      <div class="sec-panel" style:display={isSecurityActive ? "flex" : "none"}>
        <div class="sec-map-frame">
          <!-- Overlay fade-out cuando mapReady=true -->
          <div class="sec-map-overlay" class:sec-map-overlay--hidden={mapReady}>
            <span class="sec-map-icon spin">◎</span>
            cargando mapa 3d…
          </div>
          {#if isSecurityActive}
            <SecurityMapComp
              risk={securityRisk}
              accent={securityCategory.theme.accent}
              onready={() => (mapReady = true)}
            />
          {/if}
        </div>

        <div class="sec-grid">
          {#if securityCategory.security}
            {#each securityCategory.security as ind (ind.id)}
              <div class="sec-card">
                <span class="sec-label">{ind.label}</span>
                <span class="sec-value-row">
                  <span class="sec-value">{ind.value}</span>
                  {#if ind.trend && ind.trend !== "flat"}
                    <span class="sec-trend trend-{ind.trend}">{ind.trend === "up" ? "▲" : "▼"}</span>
                  {/if}
                </span>
                <span class="sec-unit">{ind.unit}</span>
                {#if ind.note}<span class="sec-note">{ind.note}</span>{/if}
                <span class="sec-risk risk-{ind.risk}">{riskLabel[ind.risk]}</span>
              </div>
            {/each}
          {:else if securityIndicatorsError}
            <p class="sec-note">No se pudieron cargar los indicadores del backend.</p>
          {:else}
            <p class="sec-note">Cargando indicadores…</p>
          {/if}
        </div>

        <p class="sec-src-note">
          Distrito Metropolitano de Quito · cierre 2025. Fuente: Observatorio Metropolitano de Seguridad
          Ciudadana (Policía Nacional y Fiscalía).
        </p>
        <a class="sec-source" href="https://observatorioseguridad.quito.gob.ec" target="_blank" rel="noreferrer">
          Cifras oficiales actualizadas → observatorioseguridad.quito.gob.ec
        </a>
      </div>
    {/if}

  </div>
</div>

{#if rentingLockerCode}
  <RentLockerModal
    lockerCode={rentingLockerCode}
    onclose={() => (rentingLockerCode = null)}
    onrented={() => onlockerrented?.()}
  />
{/if}

<style>
  .content-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* Full-screen desktop: the header shrinks (the sidebar already names the
     section) and every list/grid spreads into the extra columns a wide
     viewport affords, instead of staying in a phone-width single file. */
  .content-wrap.wide .sheet-header {
    display: none;
  }

  .content-wrap.wide .grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    padding: 20px 28px 40px;
  }

  .content-wrap.wide .repo-list,
  .content-wrap.wide .news-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
    padding: 20px 28px 40px;
  }

  .content-wrap.wide .timeline {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 0 24px;
    padding: 20px 28px 40px;
  }

  .content-wrap.wide .sec-panel {
    padding: 20px 28px 32px;
  }

  .content-wrap.wide .sec-map-frame {
    height: min(46vh, 420px);
  }

  .content-wrap.wide .sec-grid {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }

  .sheet-header {
    text-align: center;
    padding: 4px 24px 18px;
    flex-shrink: 0;
    touch-action: none;
  }

  .sheet-header h2 {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 22px;
    letter-spacing: 0.08em;
    margin: 0;
    color: #eafff5;
  }

  .icon-cluster {
    margin: 10px 0 6px;
    display: flex;
    justify-content: center;
    filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.35)) hue-rotate(var(--sheet-hue));
  }

  .sheet-sub {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(234, 255, 245, 0.65);
  }

  .sheet-body {
    flex: 1;
    overflow-y: auto;
  }

  /* ---------- Casilleros: grid ---------- */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 8px 22px 40px;
  }

  .unit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 6px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition: transform 0.2s ease;
    /* .unit ahora es un <button> (antes era un <div> decorativo) — reset de
       estilos nativos de botón para que siga viéndose igual que antes. */
    font: inherit;
    color: inherit;
    cursor: pointer;
    width: 100%;
  }

  .unit:active {
    transform: scale(0.95);
  }

  .unit.dim {
    background: rgba(0, 0, 0, 0.18);
  }

  .unit:disabled {
    cursor: not-allowed;
  }

  .fetch-error {
    margin: 0 22px 10px;
    font-size: 12.5px;
    color: #ff8a8a;
  }

  .unit-number {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 0.06em;
    color: #eafff5;
  }

  .unit-status {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .status-available {
    color: #0a1a12;
    background: var(--accent);
  }

  .status-occupied {
    color: rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.08);
  }

  .status-reserved {
    color: var(--ink-1);
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.25);
  }

  /* ---------- Eventos: timeline ---------- */
  .timeline {
    padding: 8px 22px 40px;
    display: flex;
    flex-direction: column;
  }

  .event-row {
    display: grid;
    grid-template-columns: 46px 16px 1fr;
    align-items: start;
  }

  .event-date {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1;
    padding-top: 2px;
  }

  .event-day {
    font-family: var(--font-display);
    font-size: 20px;
    color: #eafff5;
  }

  .event-month {
    margin-top: 2px;
    font-size: 9px;
    letter-spacing: 0.1em;
    color: rgba(234, 255, 245, 0.6);
  }

  .event-line {
    display: flex;
    justify-content: center;
    align-self: stretch;
  }

  .event-line::before {
    content: "";
    width: 2px;
    background: linear-gradient(180deg, var(--sheet-accent) 0%, rgba(255, 255, 255, 0.12) 100%);
    border-radius: 2px;
  }

  .event-row:last-child .event-line::before {
    background: var(--sheet-accent);
    opacity: 0.5;
  }

  .event-body {
    padding: 0 0 26px 4px;
  }

  .event-tag {
    display: inline-block;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #04120c;
    background: var(--sheet-accent);
    padding: 2px 8px;
    border-radius: 999px;
  }

  .event-title {
    margin: 6px 0 2px;
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 15px;
    color: #eafff5;
  }

  .event-time {
    margin: 0;
    font-size: 12px;
    color: rgba(234, 255, 245, 0.6);
  }

  /* ---------- Recursos: repo cards ---------- */
  .repo-list {
    padding: 8px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .repo-card {
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .repo-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .repo-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--sheet-accent);
    box-shadow: 0 0 8px var(--sheet-glow);
    flex-shrink: 0;
  }

  .repo-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 500;
    color: #eafff5;
  }

  .repo-desc {
    margin: 8px 0 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.7);
  }

  .repo-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: rgba(234, 255, 245, 0.55);
  }

  .repo-tag {
    padding: 2px 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--sheet-accent);
    font-size: 10px;
    letter-spacing: 0.03em;
  }

  .repo-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .repo-updated {
    margin-left: auto;
    opacity: 0.7;
  }

  /* ---------- Comunidad: news feed ---------- */
  .news-list {
    padding: 8px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .news-card {
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .news-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .news-tag {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #04120c;
    background: var(--sheet-accent);
    padding: 2px 9px;
    border-radius: 999px;
  }

  .news-time {
    font-size: 11px;
    color: rgba(234, 255, 245, 0.5);
  }

  .news-title {
    margin: 8px 0 4px;
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 14.5px;
    color: #eafff5;
  }

  .news-excerpt {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.7);
  }

  .news-author {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: rgba(234, 255, 245, 0.6);
  }

  /* ---------- Emprendimientos: tarjetas de directorio ---------- */

  /* Grilla, no lista de una columna — un directorio se hojea, no se lee de
     corrido; ver también .content-wrap.wide .news-list para la versión
     de escritorio (ya define columnas ahí). En móvil, una columna angosta
     ya es efectivamente una grilla de 1. */
  .venture-grid {
    padding: 8px 16px 40px;
  }

  .venture-card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md, 18px);
    overflow: hidden;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
    /* La variable por tarjeta (--v-hue) es lo que hace que cada categoría
       "sienta" distinta sin escribir una regla CSS por categoría. */
    transition:
      transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 0.22s ease,
      box-shadow 0.22s ease;
  }

  .venture-card:hover,
  .venture-card:focus-within {
    transform: translateY(-4px);
    border-color: hsl(var(--v-hue) 85% 65% / 0.55);
    box-shadow:
      0 14px 28px -12px hsl(var(--v-hue) 85% 55% / 0.35),
      0 1px 0 rgba(255, 255, 255, 0.06) inset;
  }

  .venture-media {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
  }

  .venture-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .venture-card:hover .venture-media img {
    transform: scale(1.06);
  }

  /* Scrim de abajo hacia arriba — asegura que la insignia de categoría se
     lea sobre CUALQUIER foto, sin depender de que la imagen sea oscura. */
  .venture-media::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(4, 6, 13, 0) 55%, rgba(4, 6, 13, 0.75) 100%);
    pointer-events: none;
  }

  .venture-media-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-size: 28px;
    letter-spacing: 0.08em;
    color: hsl(var(--v-hue) 85% 72%);
    background: hsl(var(--v-hue) 60% 18%);
  }

  .venture-badge {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 1;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    color: hsl(var(--v-hue) 40% 12%);
    background: hsl(var(--v-hue) 85% 68%);
    box-shadow: 0 2px 10px hsl(var(--v-hue) 85% 45% / 0.5);
  }

  .venture-body {
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .venture-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 16px;
    line-height: 1.25;
    color: #f4f9ff;
  }

  .venture-desc {
    margin: 0 0 6px;
    font-size: 12.5px;
    line-height: 1.55;
    color: rgba(234, 255, 245, 0.68);
    /* Recorta a 2 líneas — todas las tarjetas de la grilla quedan del
       mismo alto sin importar cuánto haya escrito cada estudiante. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .venture-cta {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 12px;
    border-radius: 999px;
    background: #25d366;
    color: #04150d;
    font-size: 12.5px;
    font-weight: 700;
    text-decoration: none;
    transition:
      filter 0.15s ease,
      transform 0.15s ease;
  }

  /* Verde real de WhatsApp, no el acento de AEIS — "reconocer, no
     recordar": el ojo ya sabe qué hace este botón antes de leer el texto,
     que es exactamente lo que se busca en el paso de mayor fricción del
     flujo (salir de la app a escribir a un desconocido). */
  .venture-cta:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
  .venture-cta:active {
    transform: translateY(0);
    filter: brightness(0.96);
  }

  .wa-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--sheet-accent);
    color: #04120c;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ---------- Seguridad: indicators + 3D risk map ---------- */
  .sec-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 20px 24px;
  }

  /* Oculta visualmente sin destruir el DOM ni el contexto WebGL.
     visibility:hidden + opacity:0 mantiene el layout y permite que
     MapLibre siga vivo; pointer-events:none bloquea la interacción
     accidental mientras el panel no está activo. */
  .sec-panel--hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .sec-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .sec-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .sec-label {
    font-size: 10.5px;
    letter-spacing: 0.04em;
    color: rgba(234, 255, 245, 0.65);
  }

  .sec-value-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 2px;
  }

  .sec-value {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 500;
    color: #eafff5;
  }

  /* Up is bad and down is good for every indicator here (they're all counts
     of harm), so the arrow can carry a fixed valence colour. */
  .sec-trend {
    font-size: 11px;
    line-height: 1;
  }

  .sec-trend.trend-up {
    color: #ef4444;
  }

  .sec-trend.trend-down {
    color: #21e0a0;
  }

  .sec-unit {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.5);
  }

  .sec-note {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.4);
    margin-top: 2px;
  }

  .sec-src-note {
    margin: 2px 0 0;
    font-size: 10.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.45);
  }

  .sec-risk {
    align-self: flex-start;
    margin-top: 6px;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .sec-risk.risk-low {
    color: #0a1a12;
    background: #21e0a0;
  }

  .sec-risk.risk-moderate {
    color: #241c0a;
    background: #f5b942;
  }

  .sec-risk.risk-high {
    color: #2a0a0a;
    background: #ef4444;
  }

  .sec-source {
    font-size: 11px;
    color: var(--sheet-accent);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
    align-self: flex-start;
    opacity: 0.85;
  }

  .sec-map-frame {
    position: relative;
    width: 100%;
    height: 260px;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.25);
  }

  /* Overlay de carga encima del mapa: cubre el WebGL mientras inicializa
     y hace fade-out suave cuando el mapa dispara su evento 'load'. */
  .sec-map-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 16px;
    background: rgba(4, 6, 13, 0.88);
    color: var(--sheet-accent);
    font-family: var(--font-display);
    font-size: 13px;
    letter-spacing: 0.04em;
    pointer-events: none;
    transition: opacity 0.55s ease;
    opacity: 1;
  }

  .sec-map-overlay--hidden {
    opacity: 0;
  }

  .sec-map-cta {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 16px;
    border: 1px dashed var(--line-strong);
    background: rgba(255, 255, 255, 0.04);
    color: var(--sheet-accent);
    font-family: var(--font-display);
    font-size: 13px;
    letter-spacing: 0.04em;
  }

  .sec-map-icon {
    font-size: 22px;
  }

  .sec-map-icon.spin {
    animation: sec-spin 1.1s linear infinite;
  }

  @keyframes sec-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
