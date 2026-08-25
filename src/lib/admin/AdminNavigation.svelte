<script lang="ts">
  import { fetchAdminUiVariant, updateAdminUiVariant, AdminApiError, type UiVariant } from "./adminApi";

  let variant = $state<UiVariant | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);
  let savedAt = $state<number | null>(null);

  function load() {
    loading = true;
    error = null;
    fetchAdminUiVariant()
      .then((data) => (variant = data.variant))
      .catch((err) => {
        error = err instanceof AdminApiError ? err.message : "No se pudo cargar la navegación actual.";
      })
      .finally(() => (loading = false));
  }
  $effect(load);

  async function choose(next: UiVariant) {
    if (variant === next || saving) return;
    saving = true;
    error = null;
    try {
      const updated = await updateAdminUiVariant(next);
      variant = updated.variant;
      savedAt = Date.now();
    } catch (err) {
      error = err instanceof AdminApiError ? err.message : "No se pudo guardar el cambio.";
    } finally {
      saving = false;
    }
  }
</script>

<section class="block">
  <h2>Navegación principal</h2>
  <p class="hint">
    Cómo eligen los estudiantes una sección (Casilleros, Aportaciones, etc.) al abrir la app. El cambio aplica a
    quien entre de ahora en adelante — no necesita redeploy.
  </p>

  {#if loading}
    <p class="muted">Cargando…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <div class="choice-grid">
      <button class="choice-card" class:active={variant === "A"} disabled={saving} onclick={() => choose("A")}>
        <span class="choice-title">Rueda</span>
        <span class="choice-desc">El disco que se gira arrastrando — la versión original.</span>
      </button>
      <button class="choice-card" class:active={variant === "B"} disabled={saving} onclick={() => choose("B")}>
        <span class="choice-title">Fila</span>
        <span class="choice-desc">Lista simple con botones — la que está activa hoy por defecto.</span>
      </button>
    </div>
    {#if savedAt}<p class="saved-tag">Guardado</p>{/if}
  {/if}
</section>

<style>
  .block {
    max-width: 640px;
  }

  h2 {
    font-family: var(--font-heading);
    font-size: 18px;
    letter-spacing: 0.03em;
    margin: 0 0 4px;
  }

  .hint {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--ink-1);
    line-height: 1.5;
  }

  .muted {
    color: var(--ink-1);
    font-size: 13px;
  }

  .error {
    color: #ffb4b4;
    font-size: 13px;
  }

  .choice-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .choice-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--bg-panel);
    border: 1px solid var(--line-soft);
    cursor: pointer;
  }

  .choice-card:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .choice-card.active {
    border-color: var(--accent);
    background: var(--accent-ghost);
  }

  .choice-title {
    font-family: var(--font-heading);
    font-size: 15px;
    letter-spacing: 0.03em;
    color: var(--ink-0);
  }

  .choice-card.active .choice-title {
    color: var(--accent);
  }

  .choice-desc {
    font-size: 12.5px;
    color: var(--ink-1);
    line-height: 1.4;
  }

  .saved-tag {
    margin-top: 12px;
    font-size: 12px;
    color: var(--accent);
  }
</style>
