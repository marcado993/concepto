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
    billarPercent: number;
    ps4: boolean;
    otros: unknown[];
  }

  function parseBenefits(raw: unknown): BenefitFields {
    const arr = Array.isArray(raw) ? raw : [];
    const known = new Set([BENEFIT_TYPE_CASILLERO, BENEFIT_TYPE_BILLAR, BENEFIT_TYPE_PS4]);
    const find = (type: string) => arr.find((b) => b && typeof b === "object" && (b as { type?: unknown }).type === type) as
      | Record<string, unknown>
      | undefined;
    return {
      casilleroPercent: Number(find(BENEFIT_TYPE_CASILLERO)?.percent ?? 0),
      billarPercent: Number(find(BENEFIT_TYPE_BILLAR)?.percent ?? 0),
      ps4: find(BENEFIT_TYPE_PS4)?.included === true,
      otros: arr.filter((b) => !(b && typeof b === "object" && known.has((b as { type?: unknown }).type as string))),
    };
  }

  function buildBenefits(fields: BenefitFields): unknown[] {
    return [
      ...fields.otros,
      { type: BENEFIT_TYPE_CASILLERO, percent: fields.casilleroPercent },
      { type: BENEFIT_TYPE_BILLAR, percent: fields.billarPercent },
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

<section class="block">
  <h2>Precio del casillero</h2>
  <p class="hint">Se aplica al semestre activo{lockerPeriodLabel ? ` (${lockerPeriodLabel})` : ""}. Rango permitido: $5.50 – $9.00.</p>

  {#if lockerLoading}
    <div class="row"><span class="admin-skeleton skeleton-input"></span><span class="admin-skeleton skeleton-btn"></span></div>
  {:else}
    <div class="row">
      <span class="prefix">$</span>
      <input class="amount-input" type="number" step="0.01" min="5.5" max="9" bind:value={lockerInput} />
      <button class="admin-btn admin-btn-primary" disabled={lockerSaving} onclick={saveLockerPrice}>
        {lockerSaving ? "Guardando…" : "Guardar"}
      </button>
      {#if lockerShowSaved}
        <span class="admin-saved-tag">Guardado</span>
      {/if}
    </div>
    {#if lockerError}<p class="admin-error">{lockerError}</p>{/if}
    {#if lockerBasePrice !== null}<p class="admin-muted small">Precio actual: ${lockerBasePrice.toFixed(2)}</p>{/if}
  {/if}
</section>

<section class="block">
  <h2>Aportaciones — precio y beneficios</h2>
  <p class="hint">Tiers del semestre activo{tiersPeriodLabel ? ` (${tiersPeriodLabel})` : ""}. Cambia el monto y los descuentos, y toca Guardar.</p>

  {#if tiersLoading}
    <div class="tiers-grid">
      {#each { length: 3 } as _}
        <div class="tier-card"><span class="admin-skeleton skeleton-card"></span></div>
      {/each}
    </div>
  {:else if tiersError}
    <p class="admin-error">{tiersError}</p>
  {:else}
    <div class="tiers-grid">
      {#each tiers as tier (tier.id)}
        <div class="tier-card">
          <h3>{tier.name}</h3>

          <label class="field-label" for={`amt-${tier.id}`}>Monto (USD)</label>
          <div class="row">
            <span class="prefix">$</span>
            <input id={`amt-${tier.id}`} class="amount-input" type="number" step="0.01" min="0.01" bind:value={amountDrafts[tier.id]} />
          </div>

          {#if benefitDrafts[tier.id]}
            <label class="field-label" for={`casillero-${tier.id}`}>Descuento en casillero (%)</label>
            <div class="row">
              <input
                id={`casillero-${tier.id}`}
                class="amount-input"
                type="number"
                step="1"
                min="0"
                max="100"
                bind:value={benefitDrafts[tier.id].casilleroPercent}
              />
              <span class="suffix">%</span>
            </div>

            <label class="field-label" for={`billar-${tier.id}`}>Descuento en billar (%)</label>
            <div class="row">
              <input
                id={`billar-${tier.id}`}
                class="amount-input"
                type="number"
                step="1"
                min="0"
                max="100"
                bind:value={benefitDrafts[tier.id].billarPercent}
              />
              <span class="suffix">%</span>
            </div>

            <label class="checkbox-row" for={`ps4-${tier.id}`}>
              <input id={`ps4-${tier.id}`} type="checkbox" bind:checked={benefitDrafts[tier.id].ps4} />
              Incluye acceso a PS4
            </label>
          {/if}

          <div class="row save-row">
            <button class="admin-btn admin-btn-primary" disabled={tierSaving[tier.id]} onclick={() => saveTier(tier)}>
              {tierSaving[tier.id] ? "Guardando…" : "Guardar"}
            </button>
            {#if tierIsSaved(tier.id)}<span class="admin-saved-tag">Guardado</span>{/if}
          </div>
          {#if tierError[tier.id]}<p class="admin-error">{tierError[tier.id]}</p>{/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .block {
    max-width: 720px;
    margin-bottom: 36px;
  }

  h2 {
    font-family: var(--font-heading);
    font-size: 18px;
    letter-spacing: 0.03em;
    margin: 0 0 4px;
  }

  h3 {
    font-family: var(--font-heading);
    font-size: 15px;
    letter-spacing: 0.03em;
    margin: 0 0 10px;
    color: var(--accent);
  }

  .hint {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--ink-1);
    line-height: 1.5;
  }

  .small {
    margin-top: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .save-row {
    margin-top: 16px;
  }

  .prefix,
  .suffix {
    color: var(--ink-1);
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

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--ink-1);
    margin: 14px 0 6px;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 16px 0 0;
    font-size: 13.5px;
    color: var(--ink-0);
    cursor: pointer;
  }

  .checkbox-row input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .tiers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .tier-card {
    background: var(--bg-panel);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-md);
    padding: 16px;
  }

  .skeleton-input {
    display: block;
    width: 120px;
    height: 34px;
  }

  .skeleton-btn {
    display: block;
    width: 88px;
    height: 34px;
    border-radius: 999px;
  }

  .skeleton-card {
    display: block;
    width: 100%;
    height: 160px;
  }
</style>
