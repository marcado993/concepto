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

<section class="max-w-[640px]">
  <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">Navegación principal</h2>
  <p class="mb-4 text-[13px] leading-relaxed text-ink-1">
    Cómo eligen los estudiantes una sección (Casilleros, Aportaciones, etc.) al abrir la app. El cambio aplica a
    quien entre de ahora en adelante — no necesita redeploy.
  </p>

  {#if loading}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
      <span class="admin-skeleton h-[78px]"></span>
      <span class="admin-skeleton h-[78px]"></span>
    </div>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
      <button
        class="flex flex-col gap-1 rounded-2xl border p-4 text-left backdrop-blur-xl disabled:cursor-default disabled:opacity-60
          {variant === 'A' ? 'border-accent bg-accent-ghost' : 'border-line-soft bg-panel/60'}"
        disabled={saving}
        onclick={() => choose("A")}
      >
        <span class="font-heading text-[15px] tracking-[0.03em] {variant === 'A' ? 'text-accent' : 'text-ink-0'}">Rueda</span>
        <span class="text-[12.5px] leading-snug text-ink-1">El disco que se gira arrastrando — la versión original.</span>
      </button>
      <button
        class="flex flex-col gap-1 rounded-2xl border p-4 text-left backdrop-blur-xl disabled:cursor-default disabled:opacity-60
          {variant === 'B' ? 'border-accent bg-accent-ghost' : 'border-line-soft bg-panel/60'}"
        disabled={saving}
        onclick={() => choose("B")}
      >
        <span class="font-heading text-[15px] tracking-[0.03em] {variant === 'B' ? 'text-accent' : 'text-ink-0'}">Fila</span>
        <span class="text-[12.5px] leading-snug text-ink-1">Lista simple con botones — la que está activa hoy por defecto.</span>
      </button>
    </div>
    {#if savedAt}<p class="admin-saved-tag mt-3">Guardado</p>{/if}
  {/if}
</section>
