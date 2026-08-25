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
  <h2>Registro de actividad</h2>
  <p class="hint">{total} eventos — cada pago, alquiler, aportación y cambio de precio queda acá con quién, cuándo y desde qué IP. Útil para investigar cualquier inconveniente reportado. (Los logs crudos del servidor son otra cosa — esto es el rastro de negocio, no la consola del contenedor.)</p>

  <form class="admin-search-row" onsubmit={onFilterSubmit}>
    <input class="admin-search-input" type="search" placeholder="Filtrar por acción (ej. locker, subscription, admin)…" bind:value={actionFilter} />
    <button class="admin-btn admin-btn-ghost" type="submit">Filtrar</button>
  </form>

  {#if loading}
    <div class="log-list skeleton-log">
      {#each { length: 8 } as _}
        <span class="admin-skeleton skeleton-row"></span>
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
    <div class="log-list">
      {#each logs as log (log.id)}
        <button class="log-row" onclick={() => toggleExpanded(log.id)}>
          <span class="log-action">{log.action}</span>
          <span class="log-actor">{log.actorName}</span>
          <span class="log-entity">{log.entityType}</span>
          <span class="log-time">{fmtDateTime(log.createdAt)}</span>
        </button>
        {#if expandedId === log.id}
          <div class="log-detail">
            <div><strong>Entidad:</strong> {log.entityType} · {log.entityId}</div>
            <div><strong>IP:</strong> {log.ipAddress ?? "—"}</div>
            {#if log.metadata}
              <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
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

<style>
  h2 {
    font-family: var(--font-heading);
    font-size: 18px;
    letter-spacing: 0.03em;
    margin: 0 0 4px;
  }

  .hint {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--ink-1);
    line-height: 1.5;
    max-width: 640px;
  }


  .log-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .log-row {
    display: grid;
    grid-template-columns: minmax(160px, 1.4fr) minmax(120px, 1fr) minmax(100px, 0.8fr) minmax(110px, 0.8fr);
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line-soft);
    color: var(--ink-0);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }

  .log-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .log-action {
    color: var(--accent);
    font-family: "Courier New", monospace;
  }

  .log-actor,
  .log-entity {
    color: var(--ink-1);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .log-time {
    color: var(--ink-2);
    text-align: right;
  }

  .log-detail {
    padding: 10px 14px 14px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--line-soft);
    font-size: 12px;
    color: var(--ink-1);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .log-detail pre {
    margin: 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: var(--radius-sm);
    overflow-x: auto;
    font-size: 11.5px;
    color: var(--ink-0);
  }

  .skeleton-log {
    padding: 4px;
  }

  .skeleton-log .admin-skeleton {
    height: 40px;
    margin-bottom: 1px;
  }
</style>
