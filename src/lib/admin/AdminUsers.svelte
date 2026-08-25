<script lang="ts">
  import { fetchAdminUsers, AdminApiError, type AdminUser } from "./adminApi";

  let users = $state<AdminUser[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 30;
  let search = $state("");
  let loading = $state(true);
  let error = $state<string | null>(null);

  function load() {
    loading = true;
    error = null;
    fetchAdminUsers(page, search.trim() || undefined)
      .then((data) => {
        users = data.users;
        total = data.total;
      })
      .catch((err) => {
        error = err instanceof AdminApiError ? err.message : "No se pudo cargar la lista de estudiantes.";
      })
      .finally(() => (loading = false));
  }
  $effect(load);

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  function onSearchSubmit(e: Event) {
    e.preventDefault();
    page = 1;
    load();
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" });
  }
</script>

<section>
  <h2>Estudiantes registrados</h2>
  <p class="hint">{total} en total — nunca se muestra el identificador interno de Logto, solo lo que ya ve el propio estudiante en su perfil.</p>

  <form class="admin-search-row" onsubmit={onSearchSubmit}>
    <input class="admin-search-input" type="search" placeholder="Buscar por nombre, correo o código único…" bind:value={search} />
    <button class="admin-btn admin-btn-ghost" type="submit">Buscar</button>
  </form>

  {#if loading}
    <div class="table-wrap skeleton-table">
      {#each { length: 6 } as _}
        <span class="admin-skeleton skeleton-row"></span>
      {/each}
    </div>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if users.length === 0}
    <div class="admin-empty">
      <svg width="32" height="32" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="7.5" cy="6.5" r="2.5" />
        <path d="M2.5 17c0-3 2.2-5 5-5s5 2 5 5" />
      </svg>
      <p>{search.trim() ? `No hay estudiantes que coincidan con "${search.trim()}".` : "Todavía no hay ningún estudiante registrado."}</p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Correo</th>
            <th>Código único</th>
            <th>Cédula</th>
            <th>Celular</th>
            <th>Rol</th>
            <th>Registrado</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.id)}
            <tr>
              <td>{u.fullName}</td>
              <td>{u.email ?? "—"}</td>
              <td>{u.uniqueCode.startsWith("PENDIENTE-") ? "—" : u.uniqueCode}</td>
              <td>{u.cedula ?? "—"}</td>
              <td>{u.phone ?? "—"}</td>
              <td><span class="role-pill" class:elevated={u.role !== "ESTUDIANTE"}>{u.role}</span></td>
              <td>{fmtDate(u.createdAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
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
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-md);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    text-align: left;
    padding: 10px 14px;
    white-space: nowrap;
  }

  thead th {
    background: var(--bg-panel);
    color: var(--ink-1);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line-soft);
  }

  tbody tr:nth-child(even) {
    background: rgba(255, 255, 255, 0.02);
  }

  .role-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    font-size: 11.5px;
    color: var(--ink-1);
  }

  .role-pill.elevated {
    background: var(--accent-ghost);
    color: var(--accent);
    border: 1px solid var(--accent-dim);
  }

  .skeleton-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px;
  }

  .skeleton-row {
    height: 34px;
  }
</style>
