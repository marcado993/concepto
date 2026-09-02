<script lang="ts">
  // Dashboard de administración — app COMPLETAMENTE aparte de la del
  // estudiante: build propio (ver admin.html/src/admin-main.ts/
  // vite.admin.config.ts), servido por Caddy SOLO en la red Tailscale
  // (panel.aeis-app.online, ver Caddyfile) — no vive en aeis.app/Vercel ni
  // es alcanzable desde el internet público. Login propio de correo+
  // contraseña (AdminLogin.svelte / adminAuth.svelte.ts), completamente
  // aparte de Logto/User — pedido explícito: que el mismo correo real de
  // un directivo no termine controlando la sesión de administrador Y la de
  // estudiante con el mismo login/token.
  import AdminLogin from "./AdminLogin.svelte";
  import AdminOverview from "./AdminOverview.svelte";
  import AdminPricing from "./AdminPricing.svelte";
  import AdminUsers from "./AdminUsers.svelte";
  import AdminAuditLog from "./AdminAuditLog.svelte";
  import AdminNavigation from "./AdminNavigation.svelte";
  import AdminDangerZone from "./AdminDangerZone.svelte";
  import AdminJobs from "./AdminJobs.svelte";
  import { isAdminAuthenticated, adminLogout } from "./adminAuth.svelte";
  import { fetchAdminMe, AdminApiError, type AdminMe } from "./adminApi";

  const authed = $derived(isAdminAuthenticated());

  let me = $state<AdminMe | null>(null);
  let meError = $state<string | null>(null);
  $effect(() => {
    if (!authed) return;
    fetchAdminMe()
      .then((data) => (me = data))
      .catch((err) => {
        // Token vencido/inválido — mismo efecto que cerrar sesión: vuelve
        // a mostrar AdminLogin en vez de quedarse en un estado a medias.
        meError = err instanceof AdminApiError ? err.message : "No se pudo verificar tu sesión.";
        adminLogout();
      });
  });

  type Tab = "resumen" | "precios" | "usuarios" | "empleos" | "actividad" | "navegacion" | "peligro";
  let tab = $state<Tab>("resumen");

  // Menú lateral en vez de pestañas horizontales — con solo 5 secciones ya
  // cabían arriba, pero un ícono + etiqueta se reconoce más rápido que un
  // texto suelto entre otros cinco (heurística: reconocimiento sobre
  // recuerdo), y deja espacio para crecer sin apretar más pestañas en una
  // fila que además competía por ancho con el contenido en pantallas chicas.
  const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
    { id: "resumen", label: "Resumen", icon: "chart" },
    { id: "precios", label: "Precios", icon: "tag" },
    { id: "usuarios", label: "Usuarios", icon: "users" },
    { id: "empleos", label: "Empleos", icon: "briefcase" },
    { id: "actividad", label: "Actividad", icon: "clock" },
    { id: "navegacion", label: "Navegación", icon: "compass" },
    { id: "peligro", label: "Zona de riesgo", icon: "warning" },
  ];
</script>

{#snippet icon(name: string)}
  {#if name === "chart"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M4 15.5V9M10 15.5V4.5M16 15.5v-6" />
    </svg>
  {:else if name === "tag"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <path d="M10.5 3h5.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-.3.7l-7.9 7.9a1 1 0 0 1-1.4 0l-5.5-5.5a1 1 0 0 1 0-1.4l7.9-7.9a1 1 0 0 1 .7-.3Z" />
      <circle cx="13.75" cy="6.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  {:else if name === "users"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <circle cx="7.5" cy="6.5" r="2.5" />
      <path d="M2.5 17c0-3 2.2-5 5-5s5 2 5 5" />
      <circle cx="14.5" cy="7" r="2" />
      <path d="M13 12.2c1.9.5 3.5 2.2 3.5 4.8" />
    </svg>
  {:else if name === "briefcase"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
      <rect x="2.5" y="6.5" width="15" height="10.5" rx="1.6" />
      <path d="M7.25 6.5V5a1.2 1.2 0 0 1 1.2-1.2h3.1A1.2 1.2 0 0 1 12.75 5v1.5" />
      <path d="M2.5 10.75h15" />
    </svg>
  {:else if name === "clock"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  {:else if name === "warning"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
      <path d="M10 3.2 17.5 16.5H2.5L10 3.2Z" />
      <path d="M10 8.2v3.6" />
      <circle cx="10" cy="14.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  {:else}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M13.3 6.7 11.4 11.4 6.7 13.3l1.9-4.7Z" />
    </svg>
  {/if}
{/snippet}

{#snippet initials(email: string)}
  {email.slice(0, 2).toUpperCase()}
{/snippet}

{#if !authed}
  <AdminLogin />
{:else if meError}
  <div class="flex h-dvh flex-col items-center justify-center gap-3 bg-void px-6 text-center text-ink-1">
    <p>{meError}</p>
  </div>
{:else if !me}
  <div class="flex h-dvh flex-col items-center justify-center gap-3 bg-void px-6 text-center text-ink-1">
    <p>Verificando acceso…</p>
  </div>
{:else}
  <div class="relative flex h-dvh w-full flex-col overflow-hidden text-ink-0 select-text">
    <!-- Fondo — mismo lenguaje que el marco de escritorio de la app de
         estudiantes (degradado radial), fijo detrás de todo lo demás. -->
    <div
      class="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(120%_120%_at_50%_0%,#10131d_0%,#04050a_70%)]"
    ></div>

    <header
      class="sticky top-0 z-20 flex flex-shrink-0 items-center justify-between gap-3 border-b border-line-soft/70 bg-void/60 px-4 py-3 backdrop-blur-xl sm:px-6"
    >
      <div class="flex items-center gap-2.5 font-heading text-sm tracking-[0.08em]">
        <span class="size-2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)]"></span>
        <span>AEIS · Administración</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="hidden text-sm text-ink-1 sm:inline">{me.email}</span>
        <span
          class="flex size-8 items-center justify-center rounded-full border border-line-strong bg-panel font-heading text-[11px] tracking-wide text-accent"
          title={me.email}
        >
          {@render initials(me.email)}
        </span>
        <button class="admin-btn admin-btn-ghost" onclick={() => adminLogout()}>Cerrar sesión</button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:flex-row sm:gap-4 sm:p-4">
      <nav
        class="flex flex-shrink-0 gap-1 overflow-x-auto rounded-2xl border border-line-soft/70 bg-panel/40 p-2 backdrop-blur-xl sm:w-56 sm:flex-col sm:gap-1 sm:overflow-visible sm:p-3"
        aria-label="Secciones del dashboard"
      >
        {#each NAV_ITEMS as item (item.id)}
          {@const active = tab === item.id}
          {@const isDanger = item.id === "peligro"}
          <button
            class="flex flex-shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] whitespace-nowrap text-ink-1 transition-colors sm:whitespace-normal
              {active && !isDanger ? 'bg-accent-ghost text-accent' : ''}
              {active && isDanger ? 'bg-danger-ghost text-[#ff8a8a]' : ''}
              {!active && isDanger ? 'text-[#d98787]' : ''}
              {!active ? 'hover:bg-white/5 hover:text-ink-0' : ''}"
            onclick={() => (tab = item.id)}
          >
            <span
              class="flex size-7 flex-shrink-0 items-center justify-center rounded-lg
                {active && !isDanger ? 'bg-accent/15 text-accent' : ''}
                {active && isDanger ? 'bg-danger/15 text-[#ff8a8a]' : ''}
                {!active ? 'text-current' : ''}"
            >
              <span class="size-[18px] [&>svg]:h-full [&>svg]:w-full">{@render icon(item.icon)}</span>
            </span>
            <span class="overflow-hidden text-ellipsis">{item.label}</span>
          </button>
        {/each}
      </nav>

      <main
        class="min-w-0 flex-1 overflow-y-auto rounded-2xl border border-line-soft/70 bg-panel/20 p-4 backdrop-blur-xl sm:p-7"
      >
        {#if tab === "resumen"}
          <AdminOverview />
        {:else if tab === "precios"}
          <AdminPricing />
        {:else if tab === "usuarios"}
          <AdminUsers />
        {:else if tab === "empleos"}
          <AdminJobs />
        {:else if tab === "actividad"}
          <AdminAuditLog />
        {:else if tab === "navegacion"}
          <AdminNavigation />
        {:else}
          <AdminDangerZone />
        {/if}
      </main>
    </div>
  </div>
{/if}
