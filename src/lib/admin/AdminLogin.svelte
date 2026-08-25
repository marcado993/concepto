<script lang="ts">
  // Login del panel — correo + contraseña, propio de AdminAccount (ver
  // backend/src/admin/admin-auth/). Deliberadamente simple: sin OAuth, sin
  // OTP, sin pasos — el panel ya vive detrás de Tailscale (ver Caddyfile),
  // esta es la segunda puerta.
  import { adminLogin, AdminLoginError } from "./adminAuth.svelte";

  let email = $state("");
  let password = $state("");
  let sending = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!email.trim() || !password || sending) return;
    sending = true;
    error = null;
    try {
      await adminLogin(email.trim(), password);
      // La sesión ya quedó guardada — AdminApp.svelte reacciona solo a
      // isAdminAuthenticated() cambiando de pantalla.
    } catch (err) {
      error = err instanceof AdminLoginError ? err.message : "No se pudo iniciar sesión — intenta de nuevo";
    } finally {
      sending = false;
    }
  }
</script>

<div class="page">
  <div class="panel">
    <div class="brand-row">
      <span class="brand-dot"></span>
      <span class="brand-name">AEIS · Administración</span>
    </div>
    <h1>Inicia sesión</h1>
    <p class="subtitle">Acceso restringido a la directiva de AEIS.</p>

    {#if error}
      <p class="login-error">{error}</p>
    {/if}

    <form onsubmit={submit}>
      <label class="field-label" for="admin-email">Correo</label>
      <input id="admin-email" class="field-input" type="email" autocomplete="username" bind:value={email} />

      <label class="field-label" for="admin-password">Contraseña</label>
      <input id="admin-password" class="field-input" type="password" autocomplete="current-password" bind:value={password} />

      <button class="cta" type="submit" disabled={!email.trim() || !password || sending}>
        {sending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  </div>
</div>

<style>
  .page {
    height: 100dvh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-void);
    padding: 20px;
  }

  .panel {
    width: min(360px, 100%);
    background: linear-gradient(180deg, rgba(20, 26, 40, 0.9), rgba(6, 9, 16, 0.94));
    border: 1px solid var(--line-strong);
    border-radius: 22px;
    padding: 32px 24px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 18px;
  }

  .brand-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
  }

  .brand-name {
    font-family: var(--font-heading);
    font-size: 11px;
    letter-spacing: 0.2em;
    color: var(--ink-1);
  }

  h1 {
    font-family: var(--font-heading);
    font-size: 20px;
    letter-spacing: 0.03em;
    margin: 0 0 6px;
    color: var(--ink-0);
  }

  .subtitle {
    font-size: 13px;
    color: var(--ink-1);
    margin: 0 0 20px;
  }

  .login-error {
    font-size: 12.5px;
    line-height: 1.5;
    color: #ff8a8a;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 10px;
    padding: 9px 12px;
    margin: 0 0 16px;
  }

  .field-label {
    display: block;
    font-size: 11px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--ink-1);
    margin-bottom: 6px;
  }

  .field-input {
    width: 100%;
    padding: 11px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--ink-0);
    font-size: 13.5px;
    margin-bottom: 14px;
    font-family: inherit;
  }

  .field-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .cta {
    width: 100%;
    padding: 12px 16px;
    border-radius: 999px;
    border: none;
    background: var(--accent);
    color: #04150d;
    font-weight: 700;
    font-size: 13.5px;
    cursor: pointer;
    margin-top: 4px;
  }

  .cta:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
