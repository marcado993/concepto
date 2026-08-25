<script lang="ts">
  // Dashboard de administración — completamente separado de la app del
  // estudiante (rueda/wheel), pensado para escritorio: tablas y formularios,
  // no gestos táctiles. Vive en su propia ruta ("/admin", ver App.svelte)
  // para no arrastrar ningún riesgo hacia la UI ya afinada del estudiante.
  //
  // Reutiliza la MISMA sesión (token en localStorage, Login.svelte) que el
  // resto de la app — no hay un login aparte para administración — pero
  // exige el rol PRESIDENTE/DIRECTOR contra el backend antes de mostrar
  // nada (RolesGuard ya lo exige en cada endpoint /admin/*; esta pantalla
  // solo evita el parpadeo de "cargando" seguido de puros 403).
  import Login from "../Login.svelte";
  import AdminPricing from "./AdminPricing.svelte";
  import AdminUsers from "./AdminUsers.svelte";
  import AdminAuditLog from "./AdminAuditLog.svelte";
  import { isAuthenticated, logout } from "../auth.svelte";
  import { fetchMe, ApiError, type MeResponse } from "../api";

  const authed = $derived(isAuthenticated());

  let me = $state<MeResponse | null>(null);
  let meError = $state<string | null>(null);
  $effect(() => {
    if (!authed) return;
    fetchMe()
      .then((data) => (me = data))
      .catch((err) => {
        meError = err instanceof ApiError ? err.message : "No se pudo verificar tu sesión.";
      });
  });

  const isAdmin = $derived(me?.role === "PRESIDENTE" || me?.role === "DIRECTOR");

  type Tab = "precios" | "usuarios" | "actividad";
  let tab = $state<Tab>("precios");
</script>

{#if !authed}
  <Login onclose={() => {}} showBack={false} errorMessage={null} />
{:else if meError}
  <div class="gate">
    <p>{meError}</p>
    <a href="/">Volver a AEIS-APP</a>
  </div>
{:else if !me}
  <div class="gate">
    <p>Verificando acceso…</p>
  </div>
{:else if !isAdmin}
  <div class="gate">
    <p>Esta sección es solo para la directiva de AEIS.</p>
    <a href="/">Volver a AEIS-APP</a>
  </div>
{:else}
  <div class="admin-shell">
    <header class="admin-header">
      <div class="brand">
        <span class="brand-dot"></span>
        <span>AEIS · Administración</span>
      </div>
      <div class="header-right">
        <span class="whoami">{me.fullName}</span>
        <button class="link-btn" onclick={() => logout()}>Cerrar sesión</button>
      </div>
    </header>

    <nav class="admin-tabs" aria-label="Secciones del dashboard">
      <button class:active={tab === "precios"} onclick={() => (tab = "precios")}>Precios</button>
      <button class:active={tab === "usuarios"} onclick={() => (tab = "usuarios")}>Usuarios</button>
      <button class:active={tab === "actividad"} onclick={() => (tab = "actividad")}>Registro de actividad</button>
    </nav>

    <main class="admin-content">
      {#if tab === "precios"}
        <AdminPricing />
      {:else if tab === "usuarios"}
        <AdminUsers />
      {:else}
        <AdminAuditLog />
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

  .gate a {
    color: var(--accent);
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
