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
