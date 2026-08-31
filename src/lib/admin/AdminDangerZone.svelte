<script lang="ts">
  // Reemplaza los scripts .ps1 manuales (wipe-all-to-zero.ps1,
  // free-stuck-lockers.ps1) que antes había que pedir por chat cada vez —
  // mismo alcance exacto, ver backend/src/admin/danger-zone.service.ts.
  //
  // Cada acción exige escribir la frase EXACTA antes de habilitar el botón
  // — no es un simple "¿estás seguro? Sí/No", porque eso se toca sin leer.
  // Escribir la frase completa (mismo patrón que GitHub al borrar un repo)
  // fuerza a leer lo que dice arriba primero.
  import {
    fetchDangerZonePreview,
    wipeTestData,
    freeLockers,
    AdminApiError,
    type DangerZonePreview,
  } from "./adminApi";

  const WIPE_PHRASE = "BORRAR DATOS DE PRUEBA";
  const FREE_PHRASE = "LIBERAR CASILLEROS";

  let preview = $state<DangerZonePreview | null>(null);
  let previewError = $state<string | null>(null);
  let previewLoading = $state(true);

  function loadPreview() {
    previewLoading = true;
    previewError = null;
    fetchDangerZonePreview()
      .then((data) => (preview = data))
      .catch((err) => {
        previewError = err instanceof AdminApiError ? err.message : "No se pudo cargar la zona de riesgo.";
      })
      .finally(() => (previewLoading = false));
  }
  $effect(loadPreview);

  let wipeInput = $state("");
  let wipeBusy = $state(false);
  let wipeError = $state<string | null>(null);
  let wipeResult = $state<Awaited<ReturnType<typeof wipeTestData>> | null>(null);

  async function doWipe() {
    if (wipeInput !== WIPE_PHRASE || wipeBusy) return;
    wipeBusy = true;
    wipeError = null;
    wipeResult = null;
    try {
      wipeResult = await wipeTestData(wipeInput);
      wipeInput = "";
      loadPreview();
    } catch (err) {
      wipeError = err instanceof AdminApiError ? err.message : "No se pudo completar el borrado.";
    } finally {
      wipeBusy = false;
    }
  }

  let freeInput = $state("");
  let freeBusy = $state(false);
  let freeError = $state<string | null>(null);
  let freeResult = $state<{ freed: number } | null>(null);

  async function doFree() {
    if (freeInput !== FREE_PHRASE || freeBusy) return;
    freeBusy = true;
    freeError = null;
    freeResult = null;
    try {
      freeResult = await freeLockers(freeInput);
      freeInput = "";
      loadPreview();
    } catch (err) {
      freeError = err instanceof AdminApiError ? err.message : "No se pudo liberar los casilleros.";
    } finally {
      freeBusy = false;
    }
  }
</script>

<section class="max-w-[760px]">
  <div class="mb-1 flex items-center justify-between gap-3">
    <h2 class="font-heading text-lg tracking-[0.03em]">Zona de riesgo</h2>
    <button class="admin-btn admin-btn-ghost" onclick={loadPreview} disabled={previewLoading}>
      {previewLoading ? "Actualizando…" : "Actualizar conteos"}
    </button>
  </div>
  <p class="mb-4.5 text-[13px] leading-relaxed text-ink-1">
    Acciones que borran datos reales del servidor — sin deshacer desde acá (solo con un respaldo manual). Pensadas
    para limpiar datos de PRUEBA antes de un lanzamiento, no para uso normal.
  </p>

  {#if previewLoading && !preview}
    <div class="mb-5 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
      {#each Array(7) as _}<span class="admin-skeleton h-[62px]"></span>{/each}
    </div>
  {:else if previewError}
    <p class="admin-error">{previewError}</p>
  {:else if preview}
    <div class="mb-5 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
      <div class="count-tile"><span class="count-value">{preview.aeisApp.users}</span><span class="count-label">Usuarios</span></div>
      <div class="count-tile"><span class="count-value">{preview.aeisApp.payments}</span><span class="count-label">Pagos</span></div>
      <div class="count-tile"><span class="count-value">{preview.aeisApp.lockerRentals}</span><span class="count-label">Alquileres</span></div>
      <div class="count-tile"><span class="count-value">{preview.aeisApp.subscriptions}</span><span class="count-label">Aportaciones</span></div>
      <div class="count-tile"><span class="count-value">{preview.aeisApp.ventures}</span><span class="count-label">Emprendimientos</span></div>
      <div class="count-tile"><span class="count-value">{preview.aeisApp.studentAuditLogs}</span><span class="count-label">Auditoría (estudiante)</span></div>
      <div class="count-tile">
        <span class="count-value">
          {preview.logtoDefaultTenantUsers ?? "—"}
        </span>
        <span class="count-label">Usuarios Logto</span>
      </div>
    </div>
    {#if preview.logtoError}
      <p class="admin-error mb-2">No se pudo consultar Logto: {preview.logtoError}</p>
    {/if}

    <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
      <div class="rounded-2xl border border-red-500/30 bg-[linear-gradient(165deg,rgba(255,92,92,0.07),transparent_60%)] bg-panel p-[18px]">
        <h3 class="mb-2 font-heading text-[14.5px] tracking-[0.02em] text-[#ff8a8a]">Borrar datos de prueba</h3>
        <p class="mb-2.5 text-[12.5px] leading-relaxed text-ink-1">
          Borra <strong>todos</strong> los usuarios, pagos, alquileres, aportaciones, emprendimientos y auditoría de
          estudiante — de <strong>aeis_app</strong> y del tenant <strong>default</strong> de Logto. Los casilleros
          vuelven a estar disponibles.
        </p>
        <p class="mb-2.5 rounded-lg border border-line-soft bg-white/[0.03] px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-1">
          NUNCA toca: periodos, precios de tiers, tu propia cuenta de admin, configuración de la app, ni tu cuenta
          de consola de Logto (tenant admin).
        </p>
        <label class="mb-1.5 block text-[11.5px] text-ink-1" for="wipe-confirm">
          Escribe <code class="font-mono text-[#ff8a8a]">{WIPE_PHRASE}</code> para habilitar el botón
        </label>
        <input
          id="wipe-confirm"
          class="admin-search-input mb-2.5 box-border w-full"
          type="text"
          autocomplete="off"
          bind:value={wipeInput}
          disabled={wipeBusy}
        />
        {#if wipeError}<p class="admin-error mb-2">{wipeError}</p>{/if}
        {#if wipeResult}
          <p class="admin-saved-tag mb-2">
            Listo — {wipeResult.wiped.users} usuarios, {wipeResult.wiped.lockerRentals} alquileres borrados.
            {#if wipeResult.logtoDeleted !== null}Logto: {wipeResult.logtoDeleted} usuarios borrados.{/if}
            {#if wipeResult.logtoError}<span class="admin-error"> Logto falló: {wipeResult.logtoError}</span>{/if}
          </p>
        {/if}
        <button class="admin-btn admin-btn-danger w-full" disabled={wipeInput !== WIPE_PHRASE || wipeBusy} onclick={doWipe}>
          {wipeBusy ? "Borrando…" : "Borrar datos de prueba"}
        </button>
      </div>

      <div class="rounded-2xl border border-red-500/30 bg-[linear-gradient(165deg,rgba(255,92,92,0.07),transparent_60%)] bg-panel p-[18px]">
        <h3 class="mb-2 font-heading text-[14.5px] tracking-[0.02em] text-[#ff8a8a]">Liberar casilleros</h3>
        <p class="mb-2.5 text-[12.5px] leading-relaxed text-ink-1">
          Pone en <strong>AVAILABLE</strong> cualquier casillero que quedó marcado como ocupado pero SIN un alquiler
          real detrás (huérfanos de un reset parcial anterior). No toca un casillero con un alquiler real activo.
        </p>
        <label class="mb-1.5 block text-[11.5px] text-ink-1" for="free-confirm">
          Escribe <code class="font-mono text-[#ff8a8a]">{FREE_PHRASE}</code> para habilitar el botón
        </label>
        <input
          id="free-confirm"
          class="admin-search-input mb-2.5 box-border w-full"
          type="text"
          autocomplete="off"
          bind:value={freeInput}
          disabled={freeBusy}
        />
        {#if freeError}<p class="admin-error mb-2">{freeError}</p>{/if}
        {#if freeResult}<p class="admin-saved-tag mb-2">Listo — {freeResult.freed} casilleros liberados.</p>{/if}
        <button class="admin-btn admin-btn-danger w-full" disabled={freeInput !== FREE_PHRASE || freeBusy} onclick={doFree}>
          {freeBusy ? "Liberando…" : "Liberar casilleros"}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  /* count-tile se queda como clase compartida por repetirse 7 veces arriba
     — Tailwind puro habría significado repetir la misma tira larga de
     utilidades 7 veces en el markup, esto es más legible sin perder nada
     (usa los mismos tokens de tema vía las utilidades de abajo). */
  .count-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 12px 8px;
    border-radius: var(--radius-md);
    background: var(--bg-panel);
    border: 1px solid var(--line-soft);
  }

  .count-value {
    font-family: var(--font-heading);
    font-size: 20px;
    color: var(--ink-0);
  }

  .count-label {
    font-size: 10.5px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--ink-1);
    text-align: center;
  }
</style>
