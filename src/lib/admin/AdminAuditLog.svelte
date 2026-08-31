<script lang="ts">
  import { fetchAdminAuditLogs, AdminApiError, type AdminAuditLogEntry } from "./adminApi";

  let logs = $state<AdminAuditLogEntry[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 30;
  let actionFilter = $state("");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let expandedId = $state<string | null>(null);

  function load() {
    loading = true;
    error = null;
    fetchAdminAuditLogs(page, actionFilter.trim() || undefined)
      .then((data) => {
        logs = data.logs;
        total = data.total;
      })
      .catch((err) => {
        error = err instanceof AdminApiError ? err.message : "No se pudo cargar el registro de actividad.";
      })
      .finally(() => (loading = false));
  }
  $effect(load);

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  function onFilterSubmit(e: Event) {
    e.preventDefault();
    page = 1;
    load();
  }

  function fmtDateTime(iso: string): string {
    return new Date(iso).toLocaleString("es-EC", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Guayaquil",
    });
  }

  function toggleExpanded(id: string) {
    expandedId = expandedId === id ? null : id;
  }
</script>

<section>
  <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">Registro de actividad</h2>
  <p class="mb-3.5 max-w-[640px] text-[13px] leading-relaxed text-ink-1">
    {total} eventos — cada pago, alquiler, aportación y cambio de precio queda acá con quién, cuándo y desde qué IP. Útil para
    investigar cualquier inconveniente reportado. (Los logs crudos del servidor son otra cosa — esto es el rastro de negocio, no
    la consola del contenedor.)
  </p>

  <form class="admin-search-row" onsubmit={onFilterSubmit}>
    <input class="admin-search-input" type="search" placeholder="Filtrar por acción (ej. locker, subscription, admin)…" bind:value={actionFilter} />
    <button class="admin-btn admin-btn-ghost" type="submit">Filtrar</button>
  </form>

  {#if loading}
    <div class="flex flex-col gap-px overflow-hidden rounded-2xl border border-line-soft bg-panel/40 p-1 backdrop-blur-xl">
      {#each { length: 8 } as _}
        <span class="admin-skeleton h-10"></span>
      {/each}
    </div>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if logs.length === 0}
    <div class="admin-empty">
      <svg width="32" height="32" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 5.5V10l3 2" />
      </svg>
      <p>{actionFilter.trim() ? `No hay eventos que coincidan con "${actionFilter.trim()}".` : "Todavía no hay ningún evento registrado."}</p>
    </div>
  {:else}
    <div class="flex flex-col overflow-hidden rounded-2xl border border-line-soft bg-panel/40 backdrop-blur-xl">
      {#each logs as log (log.id)}
        <button
          class="grid w-full grid-cols-[minmax(160px,1.4fr)_minmax(120px,1fr)_minmax(100px,0.8fr)_minmax(110px,0.8fr)] items-center gap-2.5 border-b border-line-soft px-3.5 py-2.5 text-left font-[inherit] text-[12.5px] text-ink-0 hover:bg-white/[0.03]"
          onclick={() => toggleExpanded(log.id)}
        >
          <span class="font-mono text-accent">{log.action}</span>
          <span class="overflow-hidden text-ellipsis text-ink-1">{log.actorName}</span>
          <span class="overflow-hidden text-ellipsis text-ink-1">{log.entityType}</span>
          <span class="text-right text-ink-2">{fmtDateTime(log.createdAt)}</span>
        </button>
        {#if expandedId === log.id}
          <div class="flex flex-col gap-1.5 border-b border-line-soft bg-panel px-3.5 py-2.5 text-xs text-ink-1">
            <div><strong>Entidad:</strong> {log.entityType} · {log.entityId}</div>
            <div><strong>IP:</strong> {log.ipAddress ?? "—"}</div>
            {#if log.metadata}
              <pre class="overflow-x-auto rounded-lg bg-black/30 px-2.5 py-2 text-[11.5px] text-ink-0">{JSON.stringify(log.metadata, null, 2)}</pre>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <div class="admin-pager">
      <button class="admin-btn admin-btn-ghost" disabled={page <= 1} onclick={() => { page -= 1; load(); }}>‹ Anterior</button>
      <span>Página {page} de {totalPages}</span>
      <button class="admin-btn admin-btn-ghost" disabled={page >= totalPages} onclick={() => { page += 1; load(); }}>Siguiente ›</button>
    </div>
  {/if}
</section>
