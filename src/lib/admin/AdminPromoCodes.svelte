<script lang="ts">
  // Códigos promocionales de casillero.
  //
  // Reemplazan al descuento automático por tier de aportación. El motivo es
  // de alcance, no técnico: las aportaciones no se cobran dentro de la app,
  // así que la app no puede confirmar quién aportó de verdad. Mantener un
  // descuento automático sobre esa tabla era prometer un beneficio sobre un
  // dato no verificable.
  //
  // Acá la directiva genera los códigos y los reparte por su cuenta a quien
  // corresponda. La app solo valida y canjea.
  import {
    fetchPromoCodes,
    fetchPromoCodesSummary,
    createPromoCodes,
    AdminApiError,
    type PromoCodePublic,
  } from "./adminApi";

  let codes = $state<PromoCodePublic[] | null>(null);
  let summary = $state<{ total: number; disponibles: number; canjeados: number } | null>(null);
  let loadError = $state<string | null>(null);

  function recargar() {
    loadError = null;
    Promise.all([fetchPromoCodes(), fetchPromoCodesSummary()])
      .then(([lista, resumen]) => {
        codes = lista;
        summary = resumen;
      })
      .catch((err) => {
        loadError = err instanceof AdminApiError ? err.message : "No se pudieron cargar los códigos.";
      });
  }
  $effect(recargar);

  // --- Generación ---
  let cantidad = $state(10);
  let discountPercent = $state(50);
  let note = $state("");
  let expiresAt = $state("");
  let busy = $state(false);
  let createError = $state<string | null>(null);
  /** Lote recién generado — se muestra aparte para copiarlo de una vez. */
  let recienCreados = $state<PromoCodePublic[] | null>(null);

  async function generar() {
    if (busy) return;
    busy = true;
    createError = null;
    recienCreados = null;
    try {
      recienCreados = await createPromoCodes({
        cantidad,
        discountPercent,
        note: note.trim() || undefined,
        expiresAt: expiresAt || undefined,
      });
      note = "";
      recargar();
    } catch (err) {
      createError = err instanceof AdminApiError ? err.message : "No se pudieron generar los códigos.";
    } finally {
      busy = false;
    }
  }

  let copiado = $state(false);
  async function copiarLote() {
    if (!recienCreados) return;
    // Solo los códigos, uno por línea: es lo que se pega en un correo o un
    // mensaje. Incluir el porcentaje o la nota obligaría a limpiarlo a mano.
    const texto = recienCreados.map((c) => c.code).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      copiado = true;
      setTimeout(() => (copiado = false), 2000);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) — los códigos están a la
      // vista igual, así que no hace falta un error: solo no confirmar algo
      // que no pasó.
      copiado = false;
    }
  }

  const PRESETS = [
    { label: "20%", value: 20 },
    { label: "50%", value: 50 },
    { label: "Gratis", value: 100 },
  ];

  function fecha(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
  }

  const ESTADO_CLASE: Record<string, string> = {
    disponible: "bg-accent/15 text-accent",
    canjeado: "bg-white/10 text-ink-3",
    vencido: "bg-danger/15 text-[#ff8a8a]",
  };
</script>

<section class="flex flex-col gap-6">
  <header>
    <h2 class="font-heading text-xl text-ink">Códigos promocionales</h2>
    <p class="mt-1 max-w-prose text-sm text-ink-2">
      Descuento de casillero para quien aporta. Genera los códigos acá y envíaselos tú a los aportantes — la app
      no cobra las aportaciones, así que no puede saber por su cuenta quién aportó.
    </p>
  </header>

  {#if summary}
    <div class="grid grid-cols-3 gap-3">
      {#each [{ label: "Generados", value: summary.total }, { label: "Sin usar", value: summary.disponibles }, { label: "Canjeados", value: summary.canjeados }] as stat (stat.label)}
        <div class="rounded-xl border border-line-soft/70 bg-panel/30 p-4">
          <p class="font-heading text-2xl text-ink tabular-nums">{stat.value}</p>
          <p class="mt-0.5 text-xs text-ink-3">{stat.label}</p>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Generación -->
  <div class="rounded-2xl border border-line-soft/70 bg-panel/20 p-5">
    <h3 class="font-heading text-base text-ink">Generar códigos</h3>

    <div class="mt-4 flex flex-col gap-4">
      <div>
        <span class="mb-2 block text-xs uppercase tracking-wide text-ink-3">Descuento</span>
        <div class="flex flex-wrap gap-2">
          {#each PRESETS as p (p.value)}
            <button
              class="rounded-xl border px-4 py-2 text-sm transition
                {discountPercent === p.value
                ? 'border-accent bg-accent/15 font-semibold text-accent'
                : 'border-line-soft/70 text-ink-2 hover:border-accent/50'}"
              onclick={() => (discountPercent = p.value)}
            >
              {p.label}
            </button>
          {/each}
          <label class="flex items-center gap-2 text-sm text-ink-2">
            <span class="text-xs uppercase tracking-wide text-ink-3">Otro</span>
            <input
              class="w-20 rounded-lg border border-line-soft/70 bg-panel/40 px-2 py-1.5 text-sm text-ink tabular-nums"
              type="number"
              min="1"
              max="100"
              bind:value={discountPercent}
            />
            <span class="text-ink-3">%</span>
          </label>
        </div>
        {#if discountPercent === 100}
          <!-- El 100% es válido y deliberado, pero conviene que quien lo
               elige lo lea antes de generar 50 de golpe. -->
          <p class="mt-2 text-xs text-[#f0d18a]">
            Al 100% el casillero sale gratis: no se cobra nada y queda entregado apenas se usa el código.
          </p>
        {/if}
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs uppercase tracking-wide text-ink-3">Cantidad</span>
          <input
            class="rounded-lg border border-line-soft/70 bg-panel/40 px-3 py-2 text-sm text-ink tabular-nums"
            type="number"
            min="1"
            max="200"
            bind:value={cantidad}
          />
        </label>

        <label class="flex flex-col gap-1.5 sm:col-span-2">
          <span class="text-xs uppercase tracking-wide text-ink-3">Para quién (opcional)</span>
          <input
            class="rounded-lg border border-line-soft/70 bg-panel/40 px-3 py-2 text-sm text-ink"
            type="text"
            maxlength="120"
            placeholder="Aportantes Platino · semestre 2026-B"
            bind:value={note}
          />
        </label>
      </div>

      <label class="flex flex-col gap-1.5 sm:max-w-xs">
        <span class="text-xs uppercase tracking-wide text-ink-3">Vence el (opcional)</span>
        <input
          class="rounded-lg border border-line-soft/70 bg-panel/40 px-3 py-2 text-sm text-ink"
          type="date"
          bind:value={expiresAt}
        />
      </label>

      {#if createError}
        <p class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ff8a8a]">{createError}</p>
      {/if}

      <button
        class="self-start rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[#04150d] transition
               hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        onclick={generar}
        disabled={busy || cantidad < 1 || discountPercent < 1 || discountPercent > 100}
      >
        {busy ? "Generando…" : `Generar ${cantidad} ${cantidad === 1 ? "código" : "códigos"}`}
      </button>
    </div>
  </div>

  <!-- Lote recién creado, listo para copiar -->
  {#if recienCreados}
    <div class="rounded-2xl border border-accent/40 bg-accent/5 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-heading text-base text-ink">
          {recienCreados.length}
          {recienCreados.length === 1 ? "código listo" : "códigos listos"} · {recienCreados[0].discountPercent}%
        </h3>
        <button
          class="rounded-lg border border-accent/50 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10"
          onclick={copiarLote}
        >
          {copiado ? "Copiado ✓" : "Copiar todos"}
        </button>
      </div>
      <!-- Fuente monoespaciada: estos códigos se leen carácter por carácter
           al dictarlos o teclearlos, y una proporcional hace más difícil
           distinguirlos. -->
      <div class="mt-3 flex flex-wrap gap-2 font-mono text-sm text-ink">
        {#each recienCreados as c (c.id)}
          <span class="rounded-lg bg-panel/50 px-3 py-1.5">{c.code}</span>
        {/each}
      </div>
      <p class="mt-3 text-xs text-ink-3">
        Quedan guardados en la lista de abajo — puedes volver a consultarlos si alguien pierde el suyo.
      </p>
    </div>
  {/if}

  <!-- Listado -->
  <div>
    <h3 class="mb-3 font-heading text-base text-ink">Todos los códigos</h3>
    {#if loadError}
      <p class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ff8a8a]">{loadError}</p>
    {:else if !codes}
      <p class="text-sm text-ink-3">Cargando…</p>
    {:else if codes.length === 0}
      <p class="rounded-xl border border-line-soft/70 bg-panel/30 px-4 py-3 text-sm text-ink-2">
        Todavía no hay códigos generados.
      </p>
    {:else}
      <div class="overflow-x-auto rounded-xl border border-line-soft/70">
        <table class="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-line-soft/70 bg-panel/40 text-left text-xs uppercase tracking-wide text-ink-3">
              <th class="px-4 py-3 font-medium">Código</th>
              <th class="px-4 py-3 font-medium">Descuento</th>
              <th class="px-4 py-3 font-medium">Para quién</th>
              <th class="px-4 py-3 font-medium">Estado</th>
              <th class="px-4 py-3 font-medium">Canjeado por</th>
            </tr>
          </thead>
          <tbody>
            {#each codes as c (c.id)}
              <tr class="border-b border-line-soft/40 last:border-0">
                <td class="px-4 py-3 font-mono text-ink">{c.code}</td>
                <td class="px-4 py-3 tabular-nums text-ink-2">
                  {c.discountPercent === 100 ? "Gratis" : `${c.discountPercent}%`}
                </td>
                <td class="px-4 py-3 text-xs text-ink-3">{c.note || "—"}</td>
                <td class="px-4 py-3">
                  <span class="rounded-md px-2 py-0.5 text-xs font-semibold {ESTADO_CLASE[c.status]}">
                    {c.status}
                  </span>
                  {#if c.status === "vencido"}
                    <span class="block text-[10px] text-ink-3">venció {fecha(c.expiresAt)}</span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-xs text-ink-2">
                  {#if c.redeemedAt}
                    {c.redeemedBy || "—"}
                    <span class="block text-[10px] text-ink-3">{fecha(c.redeemedAt)}</span>
                  {:else}
                    —
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>
