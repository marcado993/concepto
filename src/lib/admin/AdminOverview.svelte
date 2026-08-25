<script lang="ts">
  // Pestaña de inicio del panel — pedido real: antes no había ningún lugar
  // que respondiera "¿cómo vamos?" de un vistazo, solo pantallas sueltas de
  // Precios/Usuarios/Actividad (heurística de Nielsen "reconocimiento antes
  // que recuerdo", ver admin.service.ts:getOverview). Mitad datos reales
  // (ingresos YA confirmados, ocupación real), mitad proyección: un
  // simulador de "¿cuánto se ganaría con este precio?" — 100% cliente, no
  // pega al backend, solo multiplica el precio hipotético por la ocupación
  // real ya cargada.
  import { fetchAdminOverview, AdminApiError, type AdminOverview } from "./adminApi";

  let data = $state<AdminOverview | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    loading = true;
    error = null;
    fetchAdminOverview()
      .then((d) => {
        data = d;
        simInput = String(d.lockers.basePrice);
      })
      .catch((err) => {
        error = err instanceof AdminApiError ? err.message : "No se pudo cargar el resumen.";
      })
      .finally(() => (loading = false));
  });

  function money(n: number): string {
    return `$${n.toFixed(2)}`;
  }

  // ── Simulador de precio de casillero ────────────────────────────────────
  let simInput = $state("");
  const simPrice = $derived.by(() => {
    const n = Number(simInput);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });

  const occupiedCount = $derived(data ? data.lockers.rented + data.lockers.reserved : 0);

  const simAtCurrentOccupancy = $derived(simPrice !== null ? simPrice * occupiedCount : null);
  const simAtFullCapacity = $derived(simPrice !== null && data ? simPrice * data.lockers.total : null);
  const simDeltaVsActual = $derived(
    simAtCurrentOccupancy !== null && data ? simAtCurrentOccupancy - data.lockers.revenueConfirmed : null
  );
</script>

<section class="block">
  <h2>Resumen del semestre{data ? ` · ${data.periodLabel}` : ""}</h2>
  <p class="hint">Solo cuenta pagos ya confirmados por PayPhone — nunca reservas pendientes.</p>

  {#if loading}
    <div class="hero-row">
      <span class="admin-skeleton skeleton-hero"></span>
      <span class="admin-skeleton skeleton-hero"></span>
    </div>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if data}
    <div class="hero-row">
      <div class="hero-card">
        <span class="hero-label">Ingresos confirmados (total)</span>
        <span class="hero-number">{money(data.totalRevenueConfirmed)}</span>
        <span class="hero-sub">Casilleros {money(data.lockers.revenueConfirmed)} · Aportaciones {money(data.subscriptions.revenueConfirmed)}</span>
      </div>

      <div class="hero-card">
        <span class="hero-label">Ocupación de casilleros</span>
        <span class="hero-number">{occupiedCount}<span class="hero-of">/{data.lockers.total}</span></span>
        <div class="occ-bar" role="img" aria-label={`${occupiedCount} de ${data.lockers.total} casilleros ocupados o reservados`}>
          <span class="occ-fill occ-rented" style={`width: ${(data.lockers.rented / data.lockers.total) * 100}%`}></span>
          <span
            class="occ-fill occ-reserved"
            style={`width: ${(data.lockers.reserved / data.lockers.total) * 100}%; left: ${(data.lockers.rented / data.lockers.total) * 100}%`}
          ></span>
        </div>
        <span class="hero-sub">
          <i class="dot dot-rented"></i>{data.lockers.rented} alquilados
          <i class="dot dot-reserved"></i>{data.lockers.reserved} reservados
          <i class="dot dot-available"></i>{data.lockers.available} libres
        </span>
      </div>
    </div>

    {#if data.subscriptions.tiers.length > 0}
      <h3 class="section-title">Aportaciones por tier</h3>
      <div class="tiers-grid">
        {#each data.subscriptions.tiers as tier (tier.id)}
          <div class="stat-card">
            <span class="stat-name">{tier.name}</span>
            <span class="stat-number">{tier.subscriberCount}</span>
            <span class="stat-sub">aportantes · {money(tier.amount)} c/u</span>
            <span class="stat-sub accent">{money(tier.revenueConfirmed)} confirmado</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

{#if data}
  <section class="block">
    <h2>Simulador — ¿cuánto se ganaría con este precio?</h2>
    <p class="hint">Proyección, no dato real: multiplica el precio que escribas por la ocupación actual y por la capacidad total ({data.lockers.total} casilleros).</p>

    <div class="row">
      <span class="prefix">$</span>
      <input class="amount-input" type="number" step="0.01" min="0" bind:value={simInput} />
      <span class="suffix">por casillero</span>
    </div>

    {#if simPrice !== null}
      <div class="sim-grid">
        <div class="stat-card proj">
          <span class="stat-name">Con la ocupación de hoy ({occupiedCount} casilleros)</span>
          <span class="stat-number">{money(simAtCurrentOccupancy ?? 0)}</span>
          {#if simDeltaVsActual !== null}
            <span class="stat-sub" class:positive={simDeltaVsActual >= 0} class:negative={simDeltaVsActual < 0}>
              {simDeltaVsActual >= 0 ? "+" : ""}{money(simDeltaVsActual)} vs. lo ya confirmado en casilleros
            </span>
          {/if}
        </div>
        <div class="stat-card proj">
          <span class="stat-name">Si se llenaran los {data.lockers.total} casilleros</span>
          <span class="stat-number">{money(simAtFullCapacity ?? 0)}</span>
          <span class="stat-sub">capacidad completa, escenario optimista</span>
        </div>
      </div>
    {:else}
      <p class="admin-error">Escribe un número válido.</p>
    {/if}
  </section>
{/if}

<style>
  .block {
    max-width: 900px;
    margin-bottom: 36px;
  }

  h2 {
    font-family: var(--font-heading);
    font-size: 18px;
    letter-spacing: 0.03em;
    margin: 0 0 4px;
  }

  .section-title {
    font-family: var(--font-heading);
    font-size: 14px;
    letter-spacing: 0.04em;
    color: var(--ink-1);
    margin: 24px 0 12px;
    text-transform: uppercase;
  }

  .hint {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--ink-1);
    line-height: 1.5;
  }

  .skeleton-hero {
    height: 106px;
  }

  .hero-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }

  .hero-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-panel);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-md);
    padding: 20px;
  }

  .hero-label {
    font-size: 12.5px;
    color: var(--ink-1);
  }

  .hero-number {
    font-family: var(--font-heading);
    font-size: 34px;
    letter-spacing: 0.01em;
    color: var(--ink-0);
    font-variant-numeric: tabular-nums;
  }

  .hero-of {
    font-size: 20px;
    color: var(--ink-1);
  }

  .hero-sub {
    font-size: 12px;
    color: var(--ink-1);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: 6px;
  }

  .dot:first-child {
    margin-left: 0;
  }

  .dot-rented {
    background: var(--accent);
  }

  .dot-reserved {
    background: #f2c94c;
  }

  .dot-available {
    background: var(--ink-2);
  }

  .occ-bar {
    position: relative;
    height: 8px;
    border-radius: 999px;
    background: var(--line-soft);
    overflow: hidden;
    margin: 4px 0 2px;
  }

  .occ-fill {
    position: absolute;
    top: 0;
    height: 100%;
  }

  .occ-rented {
    left: 0;
    background: var(--accent);
  }

  .occ-reserved {
    background: #f2c94c;
  }

  .tiers-grid,
  .sim-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-md);
    padding: 16px;
  }

  .stat-card.proj {
    border-style: dashed;
    border-color: var(--line-strong);
  }

  .stat-name {
    font-size: 12.5px;
    color: var(--ink-1);
  }

  .stat-number {
    font-family: var(--font-heading);
    font-size: 24px;
    color: var(--ink-0);
    font-variant-numeric: tabular-nums;
  }

  .stat-sub {
    font-size: 12px;
    color: var(--ink-1);
  }

  .stat-sub.accent {
    color: var(--accent);
  }

  .stat-sub.positive {
    color: var(--accent);
  }

  .stat-sub.negative {
    color: #ffb4b4;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .prefix,
  .suffix {
    color: var(--ink-1);
    font-size: 13px;
  }

  .amount-input {
    background: var(--bg-panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    color: var(--ink-0);
    font-family: inherit;
    padding: 8px 10px;
    font-size: 13.5px;
    width: 120px;
  }
</style>
