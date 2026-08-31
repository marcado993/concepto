<script lang="ts">
  import {
    fetchAdminLockerPricing,
    updateAdminLockerPricing,
    fetchAdminSubscriptionTiers,
    updateAdminSubscriptionTier,
    AdminApiError,
    type AdminSubscriptionTier,
  } from "./adminApi";

  // Pedido explícito: quien usa este panel no sabe qué es JSON — "solo
  // cajas y guarda". Los beneficios siguen siendo JSON libre por debajo
  // (schema.prisma: SubscriptionTier.benefits, a propósito sin tipar), pero
  // acá se traducen a 3 campos simples — los ÚNICOS tipos de beneficio que
  // existen hoy (ver prisma/seed.ts). Cualquier tipo de beneficio que no
  // sea uno de estos tres (si algún día se agrega uno nuevo directo en la
  // base) se conserva tal cual al guardar — nunca se borra por edición
  // desde acá, solo no se muestra un campo para él.
  const BENEFIT_TYPE_CASILLERO = "descuento_casillero";
  const BENEFIT_TYPE_BILLAR = "descuento_billar";
  const BENEFIT_TYPE_PS4 = "acceso_ps4";

  interface BenefitFields {
    casilleroPercent: number;
    casilleroOn: boolean;
    billarPercent: number;
    billarOn: boolean;
    ps4: boolean;
    otros: unknown[];
  }

  function parseBenefits(raw: unknown): BenefitFields {
    const arr = Array.isArray(raw) ? raw : [];
    const known = new Set([BENEFIT_TYPE_CASILLERO, BENEFIT_TYPE_BILLAR, BENEFIT_TYPE_PS4]);
    const find = (type: string) => arr.find((b) => b && typeof b === "object" && (b as { type?: unknown }).type === type) as
      | Record<string, unknown>
      | undefined;
    const casilleroPercent = Number(find(BENEFIT_TYPE_CASILLERO)?.percent ?? 0);
    const billarPercent = Number(find(BENEFIT_TYPE_BILLAR)?.percent ?? 0);
    return {
      casilleroPercent,
      casilleroOn: casilleroPercent > 0,
      billarPercent,
      billarOn: billarPercent > 0,
      ps4: find(BENEFIT_TYPE_PS4)?.included === true,
      otros: arr.filter((b) => !(b && typeof b === "object" && known.has((b as { type?: unknown }).type as string))),
    };
  }

  // La casilla ES el beneficio (on/off); si está apagada, el % se manda en
  // 0 sin importar qué número haya quedado en el input oculto detrás.
  function buildBenefits(fields: BenefitFields): unknown[] {
    return [
      ...fields.otros,
      { type: BENEFIT_TYPE_CASILLERO, percent: fields.casilleroOn ? fields.casilleroPercent : 0 },
      { type: BENEFIT_TYPE_BILLAR, percent: fields.billarOn ? fields.billarPercent : 0 },
      ...(fields.ps4 ? [{ type: BENEFIT_TYPE_PS4, included: true }] : []),
    ];
  }

  // ── Precio del casillero ────────────────────────────────────────────────
  let lockerPeriodLabel = $state("");
  let lockerBasePrice = $state<number | null>(null);
  let lockerInput = $state("");
  let lockerLoading = $state(true);
  let lockerError = $state<string | null>(null);
  let lockerSaving = $state(false);
  let lockerSavedAt = $state<number | null>(null);
  // Guarda el valor exacto que se guardó — el "tag" de Guardado solo se
  // muestra si el input SIGUE igual a eso. Antes se quedaba pegado
  // indefinidamente aunque el admin ya hubiera cambiado el número de nuevo
  // sin volver a guardar (heurística: visibilidad del estado del sistema —
  // "Guardado" tiene que significar "esto de acá ya está guardado", no
  // "algo se guardó alguna vez").
  let lockerSavedValue = $state<string | null>(null);
  const lockerShowSaved = $derived(lockerSavedAt !== null && lockerInput === lockerSavedValue);

  function loadLockerPricing() {
    lockerLoading = true;
    lockerError = null;
    fetchAdminLockerPricing()
      .then((data) => {
        lockerPeriodLabel = data.periodLabel;
        lockerBasePrice = data.basePrice;
        lockerInput = String(data.basePrice);
      })
      .catch((err) => {
        lockerError = err instanceof AdminApiError ? err.message : "No se pudo cargar el precio del casillero.";
      })
      .finally(() => (lockerLoading = false));
  }
  $effect(loadLockerPricing);

  async function saveLockerPrice() {
    const value = Number(lockerInput);
    if (!Number.isFinite(value)) {
      lockerError = "Escribe un número válido.";
      return;
    }
    lockerSaving = true;
    lockerError = null;
    try {
      const updated = await updateAdminLockerPricing(value);
      lockerBasePrice = updated.basePrice;
      lockerInput = String(updated.basePrice);
      lockerSavedValue = lockerInput;
      lockerSavedAt = Date.now();
    } catch (err) {
      lockerError = err instanceof AdminApiError ? err.message : "No se pudo guardar el precio.";
    } finally {
      lockerSaving = false;
    }
  }

  // ── Tiers de aportaciones ───────────────────────────────────────────────
  let tiersPeriodLabel = $state("");
  let tiers = $state<AdminSubscriptionTier[]>([]);
  let tiersLoading = $state(true);
  let tiersError = $state<string | null>(null);

  // Estado de edición por tier — texto para el monto (no pelear con el
  // cursor mientras se escribe) y los campos de beneficio ya separados.
  let amountDrafts = $state<Record<string, string>>({});
  let benefitDrafts = $state<Record<string, BenefitFields>>({});
  let tierSaving = $state<Record<string, boolean>>({});
  let tierError = $state<Record<string, string | null>>({});
  let tierSavedAt = $state<Record<string, number>>({});
  // Mismo criterio que lockerSavedValue arriba: guarda una "foto" de lo que
  // se guardó para poder distinguir "esto ya está guardado" de "se guardó
  // hace rato pero ya lo cambiaste".
  let tierSavedSnapshot = $state<Record<string, string>>({});
  function tierIsSaved(tierId: string): boolean {
    return tierSavedAt[tierId] !== undefined && JSON.stringify([amountDrafts[tierId], benefitDrafts[tierId]]) === tierSavedSnapshot[tierId];
  }

  function loadTiers() {
    tiersLoading = true;
    tiersError = null;
    fetchAdminSubscriptionTiers()
      .then((data) => {
        tiersPeriodLabel = data.periodLabel;
        tiers = data.tiers;
        for (const t of data.tiers) {
          amountDrafts[t.id] = String(t.amount);
          benefitDrafts[t.id] = parseBenefits(t.benefits);
        }
      })
      .catch((err) => {
        tiersError = err instanceof AdminApiError ? err.message : "No se pudo cargar las aportaciones.";
      })
      .finally(() => (tiersLoading = false));
  }
  $effect(loadTiers);

  async function saveTier(tier: AdminSubscriptionTier) {
    const amountValue = Number(amountDrafts[tier.id]);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      tierError[tier.id] = "El monto debe ser un número mayor a 0.";
      return;
    }
    const fields = benefitDrafts[tier.id];
    if (fields.casilleroPercent < 0 || fields.casilleroPercent > 100 || fields.billarPercent < 0 || fields.billarPercent > 100) {
      tierError[tier.id] = "Los descuentos deben estar entre 0 y 100.";
      return;
    }

    tierSaving[tier.id] = true;
    tierError[tier.id] = null;
    try {
      const updated = await updateAdminSubscriptionTier(tier.id, { amount: amountValue, benefits: buildBenefits(fields) });
      tiers = tiers.map((t) => (t.id === tier.id ? updated : t));
      amountDrafts[tier.id] = String(updated.amount);
      benefitDrafts[tier.id] = parseBenefits(updated.benefits);
      tierSavedSnapshot[tier.id] = JSON.stringify([amountDrafts[tier.id], benefitDrafts[tier.id]]);
      tierSavedAt[tier.id] = Date.now();
    } catch (err) {
      tierError[tier.id] = err instanceof AdminApiError ? err.message : "No se pudo guardar este tier.";
    } finally {
      tierSaving[tier.id] = false;
    }
  }
</script>

<section class="mb-9 max-w-[720px]">
  <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">Precio del casillero</h2>
  <p class="mb-3.5 text-[13px] leading-relaxed text-ink-1">
    Se aplica al semestre activo{lockerPeriodLabel ? ` (${lockerPeriodLabel})` : ""}. Rango permitido: $5.50 – $9.00.
  </p>

  {#if lockerLoading}
    <div class="flex flex-wrap items-center gap-2">
      <span class="admin-skeleton block h-[38px] w-[120px]"></span>
      <span class="admin-skeleton block h-[38px] w-[88px] rounded-full"></span>
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-ink-1">$</span>
      <input
        class="w-[120px] rounded-lg border border-line-strong bg-panel px-2.5 py-2 font-[inherit] text-[13.5px] text-ink-0 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        type="number"
        step="0.01"
        min="5.5"
        max="9"
        bind:value={lockerInput}
      />
      <button class="admin-btn admin-btn-primary" disabled={lockerSaving} onclick={saveLockerPrice}>
        {lockerSaving ? "Guardando…" : "Guardar"}
      </button>
      {#if lockerShowSaved}
        <span class="admin-saved-tag">Guardado</span>
      {/if}
    </div>
    {#if lockerError}<p class="admin-error mt-2">{lockerError}</p>{/if}
    {#if lockerBasePrice !== null}<p class="admin-muted mt-2">Precio actual: ${lockerBasePrice.toFixed(2)}</p>{/if}
  {/if}
</section>

<section class="mb-9 max-w-[720px]">
  <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">Aportaciones — precio y beneficios</h2>
  <p class="mb-3.5 text-[13px] leading-relaxed text-ink-1">
    Tiers del semestre activo{tiersPeriodLabel ? ` (${tiersPeriodLabel})` : ""}. Cambia el monto y los descuentos, y toca Guardar.
  </p>

  {#if tiersLoading}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {#each { length: 3 } as _}
        <div class="rounded-2xl border border-line-soft bg-panel/60 p-4 backdrop-blur-xl">
          <span class="admin-skeleton block h-40 w-full"></span>
        </div>
      {/each}
    </div>
  {:else if tiersError}
    <p class="admin-error">{tiersError}</p>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {#each tiers as tier (tier.id)}
        <div class="rounded-2xl border border-line-soft bg-panel/60 p-4 backdrop-blur-xl">
          <h3 class="mb-2.5 font-heading text-[15px] tracking-[0.03em] text-accent">{tier.name}</h3>

          <label class="mt-3.5 mb-1.5 block text-xs text-ink-1" for={`amt-${tier.id}`}>Monto (USD)</label>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-ink-1">$</span>
            <input
              id={`amt-${tier.id}`}
              class="w-[120px] rounded-lg border border-line-strong bg-panel px-2.5 py-2 font-[inherit] text-[13.5px] text-ink-0 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              type="number"
              step="0.01"
              min="0.01"
              bind:value={amountDrafts[tier.id]}
            />
          </div>

          {#if benefitDrafts[tier.id]}
            <span class="mt-4 mb-1.5 block text-xs text-ink-1">Beneficios</span>
            <!-- Estilo Google Forms: casilla a la izquierda + etiqueta, sin
                 cajas ni bordes por fila. La casilla ES el beneficio
                 (on/off); el % de abajo solo afina cuánto una vez activado —
                 pedido explícito, más fácil de escanear de un vistazo que
                 tres pares de label+input sueltos. -->
            <ul class="mt-1.5 flex list-none flex-col gap-0.5 p-0">
              <li class="flex items-center justify-between gap-2.5 py-1.5">
                <label class="checkbox-row" for={`casillero-${tier.id}`}>
                  <input
                    id={`casillero-${tier.id}`}
                    class="admin-checkbox"
                    type="checkbox"
                    bind:checked={benefitDrafts[tier.id].casilleroOn}
                    onchange={() => {
                      if (benefitDrafts[tier.id].casilleroOn && !benefitDrafts[tier.id].casilleroPercent) benefitDrafts[tier.id].casilleroPercent = 10;
                    }}
                  />
                  <span>Descuento en casillero</span>
                </label>
                {#if benefitDrafts[tier.id].casilleroOn}
                  <div class="flex flex-shrink-0 items-center gap-1.5">
                    <input
                      class="w-14 rounded-lg border border-line-strong bg-panel-2 px-1.5 py-1 text-right font-[inherit] text-[13px] text-ink-0 outline-none focus:border-accent"
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      bind:value={benefitDrafts[tier.id].casilleroPercent}
                    />
                    <span class="text-ink-1">%</span>
                  </div>
                {/if}
              </li>
              <li class="flex items-center justify-between gap-2.5 py-1.5">
                <label class="checkbox-row" for={`billar-${tier.id}`}>
                  <input
                    id={`billar-${tier.id}`}
                    class="admin-checkbox"
                    type="checkbox"
                    bind:checked={benefitDrafts[tier.id].billarOn}
                    onchange={() => {
                      if (benefitDrafts[tier.id].billarOn && !benefitDrafts[tier.id].billarPercent) benefitDrafts[tier.id].billarPercent = 10;
                    }}
                  />
                  <span>Descuento en billar</span>
                </label>
                {#if benefitDrafts[tier.id].billarOn}
                  <div class="flex flex-shrink-0 items-center gap-1.5">
                    <input
                      class="w-14 rounded-lg border border-line-strong bg-panel-2 px-1.5 py-1 text-right font-[inherit] text-[13px] text-ink-0 outline-none focus:border-accent"
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      bind:value={benefitDrafts[tier.id].billarPercent}
                    />
                    <span class="text-ink-1">%</span>
                  </div>
                {/if}
              </li>
              <li class="flex items-center justify-between gap-2.5 py-1.5">
                <label class="checkbox-row" for={`ps4-${tier.id}`}>
                  <input id={`ps4-${tier.id}`} class="admin-checkbox" type="checkbox" bind:checked={benefitDrafts[tier.id].ps4} />
                  <span>Acceso a PS4</span>
                </label>
              </li>
            </ul>
          {/if}

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button class="admin-btn admin-btn-primary" disabled={tierSaving[tier.id]} onclick={() => saveTier(tier)}>
              {tierSaving[tier.id] ? "Guardando…" : "Guardar"}
            </button>
            {#if tierIsSaved(tier.id)}<span class="admin-saved-tag">Guardado</span>{/if}
          </div>
          {#if tierError[tier.id]}<p class="admin-error mt-2">{tierError[tier.id]}</p>{/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  /* Único trozo que se queda como CSS a mano — el checkmark dibujado con
     clip-path en :checked::before no tiene un equivalente directo y limpio
     en utilidades de Tailwind. Todo lo demás de este archivo (layout,
     espaciado, color) sí es Tailwind. */
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    color: var(--ink-0);
    cursor: pointer;
  }

  .admin-checkbox {
    appearance: none;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border: 1.5px solid var(--line-strong);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    display: grid;
    place-content: center;
    transition:
      border-color 0.12s ease,
      background 0.12s ease;
  }

  .admin-checkbox::before {
    content: "";
    width: 10px;
    height: 10px;
    transform: scale(0);
    transition: transform 0.1s ease;
    clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
    background: #010805;
  }

  .admin-checkbox:checked {
    background: var(--accent);
    border-color: var(--accent);
  }

  .admin-checkbox:checked::before {
    transform: scale(1);
  }
</style>
