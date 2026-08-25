<script lang="ts">
  import {
    fetchAdminLockerPricing,
    updateAdminLockerPricing,
    fetchAdminSubscriptionTiers,
    updateAdminSubscriptionTier,
    ApiError,
    type AdminSubscriptionTier,
  } from "../api";

  // ── Precio del casillero ────────────────────────────────────────────────
  let lockerPeriodLabel = $state("");
  let lockerBasePrice = $state<number | null>(null);
  let lockerInput = $state("");
  let lockerLoading = $state(true);
  let lockerError = $state<string | null>(null);
  let lockerSaving = $state(false);
  let lockerSavedAt = $state<number | null>(null);

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
        lockerError = err instanceof ApiError ? err.message : "No se pudo cargar el precio del casillero.";
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
      lockerSavedAt = Date.now();
    } catch (err) {
      lockerError = err instanceof ApiError ? err.message : "No se pudo guardar el precio.";
    } finally {
      lockerSaving = false;
    }
  }

  // ── Tiers de aportaciones ───────────────────────────────────────────────
  let tiersPeriodLabel = $state("");
  let tiers = $state<AdminSubscriptionTier[]>([]);
  let tiersLoading = $state(true);
  let tiersError = $state<string | null>(null);

  // Estado de edición por tier — se guarda como texto (input de monto,
  // textarea de JSON de beneficios) hasta que se confirma, para no pelear
  // con el cursor mientras el estudiante-admin sigue escribiendo.
  let amountDrafts = $state<Record<string, string>>({});
  let benefitsDrafts = $state<Record<string, string>>({});
  let tierSaving = $state<Record<string, boolean>>({});
  let tierError = $state<Record<string, string | null>>({});
  let tierSavedAt = $state<Record<string, number>>({});

  function loadTiers() {
    tiersLoading = true;
    tiersError = null;
    fetchAdminSubscriptionTiers()
      .then((data) => {
        tiersPeriodLabel = data.periodLabel;
        tiers = data.tiers;
        for (const t of data.tiers) {
          amountDrafts[t.id] = String(t.amount);
          benefitsDrafts[t.id] = JSON.stringify(t.benefits, null, 2);
        }
      })
      .catch((err) => {
        tiersError = err instanceof ApiError ? err.message : "No se pudo cargar las aportaciones.";
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
    let benefitsValue: unknown;
    try {
      benefitsValue = JSON.parse(benefitsDrafts[tier.id]);
    } catch {
      tierError[tier.id] = "Los beneficios no son un JSON válido — revisa comas/llaves.";
      return;
    }
    if (!Array.isArray(benefitsValue)) {
      tierError[tier.id] = 'Los beneficios deben ser un array, ej. [{ "type": "descuento_casillero", "percent": 10 }].';
      return;
    }

    tierSaving[tier.id] = true;
    tierError[tier.id] = null;
    try {
      const updated = await updateAdminSubscriptionTier(tier.id, { amount: amountValue, benefits: benefitsValue as unknown[] });
      tiers = tiers.map((t) => (t.id === tier.id ? updated : t));
      amountDrafts[tier.id] = String(updated.amount);
      benefitsDrafts[tier.id] = JSON.stringify(updated.benefits, null, 2);
      tierSavedAt[tier.id] = Date.now();
    } catch (err) {
      tierError[tier.id] = err instanceof ApiError ? err.message : "No se pudo guardar este tier.";
    } finally {
      tierSaving[tier.id] = false;
    }
  }
</script>

<section class="block">
  <h2>Precio del casillero</h2>
  <p class="hint">Se aplica al semestre activo{lockerPeriodLabel ? ` (${lockerPeriodLabel})` : ""}. Rango permitido: $5.50 – $9.00.</p>

  {#if lockerLoading}
    <p class="muted">Cargando…</p>
  {:else}
    <div class="row">
      <span class="prefix">$</span>
      <input class="amount-input" type="number" step="0.01" min="5.5" max="9" bind:value={lockerInput} />
      <button class="save-btn" disabled={lockerSaving} onclick={saveLockerPrice}>
        {lockerSaving ? "Guardando…" : "Guardar"}
      </button>
      {#if lockerSavedAt}
        <span class="saved-tag">Guardado</span>
      {/if}
    </div>
    {#if lockerError}<p class="error">{lockerError}</p>{/if}
    {#if lockerBasePrice !== null}<p class="muted small">Precio actual: ${lockerBasePrice.toFixed(2)}</p>{/if}
  {/if}
</section>

<section class="block">
  <h2>Aportaciones — precio y beneficios</h2>
  <p class="hint">Tiers del semestre activo{tiersPeriodLabel ? ` (${tiersPeriodLabel})` : ""}. Los beneficios son JSON libre — el tipo "descuento_casillero" ya lo interpreta el sistema para calcular el precio del casillero.</p>

  {#if tiersLoading}
    <p class="muted">Cargando…</p>
  {:else if tiersError}
    <p class="error">{tiersError}</p>
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

          <label class="field-label" for={`ben-${tier.id}`}>Beneficios (JSON)</label>
          <textarea id={`ben-${tier.id}`} class="benefits-input" rows="6" bind:value={benefitsDrafts[tier.id]}></textarea>

          <div class="row">
            <button class="save-btn" disabled={tierSaving[tier.id]} onclick={() => saveTier(tier)}>
              {tierSaving[tier.id] ? "Guardando…" : "Guardar"}
            </button>
            {#if tierSavedAt[tier.id]}<span class="saved-tag">Guardado</span>{/if}
          </div>
          {#if tierError[tier.id]}<p class="error">{tierError[tier.id]}</p>{/if}
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

  .muted {
    color: var(--ink-1);
    font-size: 13px;
  }

  .muted.small {
    margin-top: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .prefix {
    color: var(--ink-1);
  }

  .amount-input,
  .benefits-input {
    background: var(--bg-panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    color: var(--ink-0);
    font-family: inherit;
    padding: 8px 10px;
    font-size: 13.5px;
  }

  .amount-input {
    width: 120px;
  }

  .benefits-input {
    width: 100%;
    font-family: "Courier New", monospace;
    font-size: 12.5px;
    resize: vertical;
    margin: 6px 0 10px;
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--ink-1);
    margin: 14px 0 6px;
  }

  .save-btn {
    padding: 8px 16px;
    border-radius: 999px;
    background: linear-gradient(165deg, var(--accent) 0%, var(--accent-dim) 100%);
    color: #010805;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .saved-tag {
    font-size: 12px;
    color: var(--accent);
  }

  .error {
    margin: 8px 0 0;
    color: #ffb4b4;
    font-size: 12.5px;
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
</style>
