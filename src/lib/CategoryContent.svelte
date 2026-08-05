<script lang="ts">
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category, LockerStatus } from "./data";

  interface Props {
    category: Category;
    securityRisk?: number;
    // Only wired up by the mobile sliding sheet, so its header doubles as a
    // drag handle — the desktop panel just omits these.
    onheaderpointerdown?: (e: PointerEvent) => void;
    onheaderpointermove?: (e: PointerEvent) => void;
    onheaderpointerup?: (e: PointerEvent) => void;
  }

  let { category, securityRisk = 0.5, onheaderpointerdown, onheaderpointermove, onheaderpointerup }: Props =
    $props();

  let mapModule: typeof import("./SecurityMap.svelte") | null = $state(null);
  let loadingMap = $state(false);

  async function loadMap() {
    if (mapModule || loadingMap) return;
    loadingMap = true;
    mapModule = await import("./SecurityMap.svelte");
    loadingMap = false;
  }

  // Preloads the (code-split) map bundle the moment Seguridad becomes the
  // selected category — on the wheel that's well before the sheet opens,
  // on desktop it's the instant the panel needs it — instead of waiting
  // for a second interaction and making the visitor watch it fetch.
  $effect(() => {
    if (category.id === "security") loadMap();
  });

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

  const theme = $derived(category.theme);
  const wrapStyle = $derived(
    `--sheet-accent: ${theme.accent}; --sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep}; --sheet-glow: ${theme.glow}; --sheet-hue: ${theme.hue}deg;`
  );
</script>

<div class="content-wrap" style={wrapStyle}>
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
      <div class="grid">
        {#each category.lockers as unit (unit.id)}
          <div class="unit" class:dim={unit.status !== "available"}>
            <IsoIcon unit status={unit.status} size={64} />
            <span class="unit-number">{unit.number}</span>
            <span class="unit-status status-{unit.status}">{statusLabel[unit.status]}</span>
          </div>
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
    {:else if category.id === "community" && category.news}
      <div class="news-list">
        {#each category.news as n (n.id)}
          <div class="news-card">
            <div class="news-top">
              <span class="news-tag">{n.tag}</span>
              <span class="news-time">{n.time}</span>
            </div>
            <h3 class="news-title">{n.title}</h3>
            <p class="news-excerpt">{n.excerpt}</p>
            <div class="news-author">
              <span class="avatar">{initials(n.author)}</span>
              {n.author}
            </div>
          </div>
        {/each}
      </div>
    {:else if category.id === "security" && category.security}
      <div class="sec-panel">
        <div class="sec-map-frame">
          {#if mapModule}
            {@const SecurityMapComp = mapModule.default}
            <SecurityMapComp risk={securityRisk} accent={theme.accent} />
          {:else}
            <div class="sec-map-cta">
              <span class="sec-map-icon spin">◎</span>
              cargando mapa 3d…
            </div>
          {/if}
        </div>

        <div class="sec-grid">
          {#each category.security as ind (ind.id)}
            <div class="sec-card">
              <span class="sec-label">{ind.label}</span>
              <span class="sec-value">{ind.value}</span>
              <span class="sec-unit">{ind.unit}</span>
              <span class="sec-risk risk-{ind.risk}">{riskLabel[ind.risk]}</span>
            </div>
          {/each}
        </div>

        <a class="sec-source" href="https://miq.quito.gob.ec/indicadores" target="_blank" rel="noreferrer">
          Cifras oficiales vigentes → miq.quito.gob.ec/indicadores
        </a>
      </div>
    {/if}
  </div>
</div>

<style>
  .content-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
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
  }

  .unit:active {
    transform: scale(0.95);
  }

  .unit.dim {
    background: rgba(0, 0, 0, 0.18);
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

  .sec-value {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 500;
    color: #eafff5;
    margin-top: 2px;
  }

  .sec-unit {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.5);
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
    width: 100%;
    height: 260px;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.25);
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
