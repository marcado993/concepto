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
  <h2 class="mb-1 font-heading text-lg tracking-[0.03em]">Estudiantes registrados</h2>
  <p class="mb-3.5 text-[13px] text-ink-1">
    {total} en total — nunca se muestra el identificador interno de Logto, solo lo que ya ve el propio estudiante en su perfil.
  </p>

  <form class="admin-search-row" onsubmit={onSearchSubmit}>
    <input class="admin-search-input" type="search" placeholder="Buscar por nombre, correo o código único…" bind:value={search} />
    <button class="admin-btn admin-btn-ghost" type="submit">Buscar</button>
  </form>

  {#if loading}
    <div class="flex flex-col gap-px rounded-2xl border border-line-soft bg-panel/40 p-2 backdrop-blur-xl">
      {#each { length: 6 } as _}
        <span class="admin-skeleton h-[34px]"></span>
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
    <div class="overflow-x-auto rounded-2xl border border-line-soft bg-panel/40 backdrop-blur-xl">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Nombre</th>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Correo</th>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Código único</th>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Cédula</th>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Celular</th>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Rol</th>
            <th class="border-b border-line-soft px-3.5 py-2.5 text-left text-xs font-semibold tracking-[0.04em] text-ink-1 uppercase">Registrado</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.id)}
            <tr class="odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04]">
              <td class="px-3.5 py-2.5 whitespace-nowrap">{u.fullName}</td>
              <td class="px-3.5 py-2.5 whitespace-nowrap">{u.email ?? "—"}</td>
              <td class="px-3.5 py-2.5 whitespace-nowrap">{u.uniqueCode.startsWith("PENDIENTE-") ? "—" : u.uniqueCode}</td>
              <td class="px-3.5 py-2.5 whitespace-nowrap">{u.cedula ?? "—"}</td>
              <td class="px-3.5 py-2.5 whitespace-nowrap">{u.phone ?? "—"}</td>
              <td class="px-3.5 py-2.5 whitespace-nowrap">
                <span
                  class="inline-block rounded-full px-2.5 py-0.5 text-[11.5px] {u.role !== 'ESTUDIANTE'
                    ? 'border border-accent-dim bg-accent-ghost text-accent'
                    : 'bg-white/[0.06] text-ink-1'}"
                >
                  {u.role}
                </span>
              </td>
              <td class="px-3.5 py-2.5 whitespace-nowrap">{fmtDate(u.createdAt)}</td>
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
