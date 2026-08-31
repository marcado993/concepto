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

<section class="mb-9 max-w-[900px]">
  <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">
    Resumen del semestre{data ? ` · ${data.periodLabel}` : ""}
  </h2>
  <p class="mb-3.5 text-[13px] leading-relaxed text-ink-1">Solo cuenta pagos ya confirmados por PayPhone — nunca reservas pendientes.</p>

  {#if loading}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
      <span class="admin-skeleton h-[110px]"></span>
      <span class="admin-skeleton h-[110px]"></span>
    </div>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if data}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
      <div class="relative overflow-hidden rounded-2xl border border-line-soft bg-panel/60 p-5 backdrop-blur-xl">
        <div class="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-accent/10 blur-3xl"></div>
        <span class="relative text-[12.5px] text-ink-1">Ingresos confirmados (total)</span>
        <div class="relative font-heading text-[34px] tracking-[0.01em] text-ink-0 tabular-nums">
          {money(data.totalRevenueConfirmed)}
        </div>
        <span class="relative flex flex-wrap items-center gap-1.5 text-xs text-ink-1">
          Casilleros {money(data.lockers.revenueConfirmed)} · Aportaciones {money(data.subscriptions.revenueConfirmed)}
        </span>
      </div>

      <div class="relative overflow-hidden rounded-2xl border border-line-soft bg-panel/60 p-5 backdrop-blur-xl">
        <span class="text-[12.5px] text-ink-1">Ocupación de casilleros</span>
        <div class="font-heading text-[34px] tracking-[0.01em] text-ink-0 tabular-nums">
          {occupiedCount}<span class="text-xl text-ink-1">/{data.lockers.total}</span>
        </div>
        <div
          class="relative my-1 h-2 overflow-hidden rounded-full bg-line-soft"
          role="img"
          aria-label={`${occupiedCount} de ${data.lockers.total} casilleros ocupados o reservados`}
        >
          <span class="absolute top-0 left-0 h-full bg-accent" style={`width: ${(data.lockers.rented / data.lockers.total) * 100}%`}
          ></span>
          <span
            class="absolute top-0 h-full bg-[#f2c94c]"
            style={`width: ${(data.lockers.reserved / data.lockers.total) * 100}%; left: ${(data.lockers.rented / data.lockers.total) * 100}%`}
          ></span>
        </div>
        <span class="flex flex-wrap items-center gap-1.5 text-xs text-ink-1">
          <i class="inline-block size-2 rounded-full bg-accent"></i>{data.lockers.rented} alquilados
          <i class="ml-1.5 inline-block size-2 rounded-full bg-[#f2c94c]"></i>{data.lockers.reserved} reservados
          <i class="ml-1.5 inline-block size-2 rounded-full bg-ink-2"></i>{data.lockers.available} libres
        </span>
      </div>
    </div>

    {#if data.subscriptions.tiers.length > 0}
      <h3 class="mt-6 mb-3 font-heading text-sm tracking-[0.04em] text-ink-1 uppercase">Aportaciones por tier</h3>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
        {#each data.subscriptions.tiers as tier (tier.id)}
          <div class="flex flex-col gap-1 rounded-2xl border border-line-soft bg-panel/60 p-4 backdrop-blur-xl">
            <span class="text-[12.5px] text-ink-1">{tier.name}</span>
            <span class="font-heading text-2xl text-ink-0 tabular-nums">{tier.subscriberCount}</span>
            <span class="text-xs text-ink-1">aportantes · {money(tier.amount)} c/u</span>
            <span class="text-xs text-accent">{money(tier.revenueConfirmed)} confirmado</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

{#if data}
  <section class="mb-9 max-w-[900px]">
    <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">Simulador — ¿cuánto se ganaría con este precio?</h2>
    <p class="mb-3.5 text-[13px] leading-relaxed text-ink-1">
      Proyección, no dato real: multiplica el precio que escribas por la ocupación actual y por la capacidad total ({data.lockers
        .total} casilleros).
    </p>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <span class="text-[13px] text-ink-1">$</span>
      <input
        class="w-[120px] rounded-lg border border-line-strong bg-panel px-2.5 py-2 font-[inherit] text-[13.5px] text-ink-0 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        type="number"
        step="0.01"
        min="0"
        bind:value={simInput}
      />
      <span class="text-[13px] text-ink-1">por casillero</span>
    </div>

    {#if simPrice !== null}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
        <div class="flex flex-col gap-1 rounded-2xl border border-dashed border-line-strong bg-panel/60 p-4 backdrop-blur-xl">
          <span class="text-[12.5px] text-ink-1">Con la ocupación de hoy ({occupiedCount} casilleros)</span>
          <span class="font-heading text-2xl text-ink-0 tabular-nums">{money(simAtCurrentOccupancy ?? 0)}</span>
          {#if simDeltaVsActual !== null}
            <span class="text-xs {simDeltaVsActual >= 0 ? 'text-accent' : 'text-[#ffb4b4]'}">
              {simDeltaVsActual >= 0 ? "+" : ""}{money(simDeltaVsActual)} vs. lo ya confirmado en casilleros
            </span>
          {/if}
        </div>
        <div class="flex flex-col gap-1 rounded-2xl border border-dashed border-line-strong bg-panel/60 p-4 backdrop-blur-xl">
          <span class="text-[12.5px] text-ink-1">Si se llenaran los {data.lockers.total} casilleros</span>
          <span class="font-heading text-2xl text-ink-0 tabular-nums">{money(simAtFullCapacity ?? 0)}</span>
          <span class="text-xs text-ink-1">capacidad completa, escenario optimista</span>
        </div>
      </div>
    {:else}
      <p class="admin-error">Escribe un número válido.</p>
    {/if}
  </section>
{/if}
