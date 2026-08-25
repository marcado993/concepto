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

  type Tab = "precios" | "usuarios" | "actividad" | "navegacion";
  let tab = $state<Tab>("precios");
</script>

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
        <button class="link-btn" onclick={() => adminLogout()}>Cerrar sesión</button>
      </div>
    </header>

    <nav class="admin-tabs" aria-label="Secciones del dashboard">
      <button class:active={tab === "precios"} onclick={() => (tab = "precios")}>Precios</button>
      <button class:active={tab === "usuarios"} onclick={() => (tab = "usuarios")}>Usuarios</button>
      <button class:active={tab === "actividad"} onclick={() => (tab = "actividad")}>Registro de actividad</button>
      <button class:active={tab === "navegacion"} onclick={() => (tab = "navegacion")}>Navegación</button>
    </nav>

    <main class="admin-content">
      {#if tab === "precios"}
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
    background: var(--bg-void);
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

  .link-btn {
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    background: rgba(255, 255, 255, 0.04);
    color: var(--ink-1);
    font-size: 12.5px;
    cursor: pointer;
  }

  .link-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .admin-tabs {
    display: flex;
    gap: 4px;
    padding: 0 20px;
    border-bottom: 1px solid var(--line-soft);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .admin-tabs button {
    padding: 12px 16px;
    font-size: 13.5px;
    color: var(--ink-1);
    border-bottom: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .admin-tabs button.active {
    color: var(--ink-0);
    border-bottom-color: var(--accent);
  }

  .admin-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
  }

  @media (max-width: 640px) {
    .admin-content {
      padding: 16px;
    }
  }
</style>
