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

  type Tab = "resumen" | "precios" | "usuarios" | "actividad" | "navegacion";
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
    { id: "actividad", label: "Actividad", icon: "clock" },
    { id: "navegacion", label: "Navegación", icon: "compass" },
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
  {:else if name === "clock"}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  {:else}
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M13.3 6.7 11.4 11.4 6.7 13.3l1.9-4.7Z" />
    </svg>
  {/if}
{/snippet}

{#if !authed}
  <AdminLogin />
{:else if meError}
  <div class="gate">
    <p>{meError}</p>
  </div>
{:else if !me}
  <div class="gate">
    <p>Verificando acceso…</p>
  </div>
{:else}
  <div class="admin-shell">
    <header class="admin-header">
      <div class="brand">
        <span class="brand-dot"></span>
        <span>AEIS · Administración</span>
      </div>
      <div class="header-right">
        <span class="whoami">{me.email}</span>
        <button class="admin-btn admin-btn-ghost" onclick={() => adminLogout()}>Cerrar sesión</button>
      </div>
    </header>

    <div class="admin-body">
      <nav class="admin-sidebar" aria-label="Secciones del dashboard">
        {#each NAV_ITEMS as item (item.id)}
          <button class="nav-item" class:active={tab === item.id} onclick={() => (tab = item.id)}>
            <span class="nav-icon">{@render icon(item.icon)}</span>
            <span class="nav-label">{item.label}</span>
          </button>
        {/each}
      </nav>

      <main class="admin-content">
        {#if tab === "resumen"}
          <AdminOverview />
        {:else if tab === "precios"}
          <AdminPricing />
        {:else if tab === "usuarios"}
          <AdminUsers />
        {:else if tab === "actividad"}
          <AdminAuditLog />
        {:else}
          <AdminNavigation />
        {/if}
      </main>
    </div>
  </div>
{/if}

<style>
  .gate {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: var(--bg-void);
    color: var(--ink-1);
    text-align: center;
    padding: 24px;
  }

  .admin-shell {
    height: 100dvh;
    width: 100%;
    display: flex;
    flex-direction: column;
    /* Mismo degradado radial que el marco de escritorio de la app
       estudiantil (App.svelte, .phone-frame) — antes esto era un
       --bg-void plano, así que el panel se sentía más "dashboard
       genérico" que el resto de AEIS-APP. */
    background: radial-gradient(120% 120% at 50% 0%, #10131d 0%, #04050a 70%);
    color: var(--ink-0);
    user-select: text;
  }

  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--line-soft);
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-heading);
    letter-spacing: 0.08em;
    font-size: 14px;
  }

  .brand-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .whoami {
    font-size: 13px;
    color: var(--ink-1);
  }

  .admin-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .admin-sidebar {
    flex-shrink: 0;
    width: 208px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 16px 12px;
    border-right: 1px solid var(--line-soft);
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    color: var(--ink-1);
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
    border-left: 2px solid transparent;
  }

  .nav-item:hover {
    color: var(--ink-0);
    background: rgba(255, 255, 255, 0.03);
  }

  .nav-item.active {
    color: var(--accent);
    background: var(--accent-ghost);
    border-left-color: var(--accent);
  }

  .nav-icon {
    display: flex;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
  }

  .nav-icon :global(svg) {
    width: 100%;
    height: 100%;
  }

  .nav-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .admin-content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 32px;
  }

  @media (max-width: 720px) {
    .admin-body {
      flex-direction: column;
    }

    .admin-sidebar {
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--line-soft);
      padding: 8px 12px;
    }

    .nav-item {
      flex-shrink: 0;
      border-left: none;
      border-bottom: 2px solid transparent;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    }

    .nav-item.active {
      border-bottom-color: var(--accent);
    }

    .admin-content {
      padding: 16px;
    }
  }
</style>
