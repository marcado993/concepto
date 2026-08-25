<script lang="ts">
  import type { Category } from "../data";
  import LoadingSpinner from "../atoms/LoadingSpinner.svelte";

  const riskLabel: Record<"low" | "moderate" | "high", string> = {
    low: "Bajo",
    moderate: "Moderado",
    high: "Alto",
  };

  // import() dinámico — SecurityMap importa mapWarm.ts → maplibre-gl
  // (~1MB). Separarlo en su propio chunk evita que bloquee el bundle de
  // arranque. Es una promesa a nivel de módulo, así que se pide una sola
  // vez aunque el organism se monte/desmonte varias veces.
  const securityMapModule = import("../SecurityMap.svelte");

  interface Props {
    securityCategory: Category | null;
    securityRisk?: number;
    securityIndicatorsError?: boolean;
    isActive: boolean;
  }
  let {
    securityCategory,
    securityRisk = 0.5,
    securityIndicatorsError = false,
    isActive,
  }: Props = $props();

  let mapReady = $state(false);

  // Una sola vez true, nunca vuelve a false — a propósito no es
  // `isActive` directo. {#if isActive} desmontaba SecurityMapComp cada
  // vez que se navegaba fuera (fetch nuevo + setData() completo del
  // heatmap en GPU en cada visita). Con este flag, el mapa se monta una
  // sola vez al primer enter y queda montado.
  let hasOpenedSecurity = $state(false);
  $effect(() => {
    if (!isActive || hasOpenedSecurity) return;
    // Montar el mapa en el MISMO frame en que se entra a Seguridad traba
    // la pantalla: crear el contexto WebGL, pedir estilo/sprites/glyphs/
    // tiles a un tercero y teselar el heatmap (~500 puntos) cae justo
    // encima de la animación de entrada. Se deja pintar la sección
    // primero y el mapa se monta después.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (idle) {
      const id = idle(() => (hasOpenedSecurity = true), { timeout: 900 });
      return () => (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => (hasOpenedSecurity = true), 320);
    return () => clearTimeout(t);
  });
</script>

<!-- display:none en vez de {#if} — mismo razonamiento que LockersSection:
     evita destruir el contexto WebGL del mapa al navegar fuera y
     volverlo a crear en cada regreso (hallazgo de rendimiento). -->
<div class="sec-panel" style:display={isActive ? "flex" : "none"}>
  {#if securityCategory}
    <div class="sec-map-frame">
      <!-- Overlay fade-out cuando mapReady=true -->
      <div class="sec-map-overlay" class:sec-map-overlay--hidden={mapReady}>
        <span class="sec-map-icon spin">◎</span>
        cargando mapa 3d…
      </div>
      {#if hasOpenedSecurity}
        {#await securityMapModule then { default: SecurityMapComp }}
          <SecurityMapComp
            risk={securityRisk}
            accent={securityCategory.theme.accent}
            onready={() => (mapReady = true)}
          />
        {/await}
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
        <LoadingSpinner label="Cargando indicadores…" />
      {/if}
    </div>

    <p class="sec-src-note">
      Distrito Metropolitano de Quito · cierre 2025. Fuente: Observatorio Metropolitano de Seguridad
      Ciudadana (Policía Nacional y Fiscalía).
    </p>
    <a class="sec-source" href="https://observatorioseguridad.quito.gob.ec" target="_blank" rel="noreferrer">
      Cifras oficiales actualizadas → observatorioseguridad.quito.gob.ec
    </a>
  {/if}
</div>

<style>
  .sec-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 20px 24px;
  }

  :global(.content-wrap.wide) .sec-panel {
    padding: 20px 28px 32px;
  }

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

  :global(.content-wrap.wide) .sec-grid {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
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
    font-family: var(--font-heading);
    font-size: 22px;
    font-weight: 500;
    color: #eafff5;
  }

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

  :global(.content-wrap.wide) .sec-map-frame {
    height: min(46vh, 420px);
  }

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
    font-family: var(--font-heading);
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
    font-family: var(--font-heading);
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

