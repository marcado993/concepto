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

<div
  class="relative flex h-dvh w-full items-center justify-center overflow-hidden bg-[radial-gradient(120%_120%_at_50%_0%,#10131d_0%,#04050a_70%)] p-5"
>
  <!-- Resplandor detrás de la tarjeta — el mismo verde de marca, muy tenue,
       para que el login no se sienta como un formulario genérico sobre
       fondo negro plano. -->
  <div class="pointer-events-none absolute top-1/2 left-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[100px]"></div>

  <div class="relative w-full max-w-[380px] rounded-3xl border border-line-strong bg-panel/60 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
    <div class="mb-5 flex items-center gap-2">
      <span class="size-2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)]"></span>
      <span class="font-heading text-[11px] tracking-[0.2em] text-ink-1">AEIS · ADMINISTRACIÓN</span>
    </div>
    <h1 class="mb-1.5 font-heading text-[22px] tracking-[0.03em] text-ink-0">Inicia sesión</h1>
    <p class="mb-6 text-[13px] text-ink-1">Acceso restringido a la directiva de AEIS.</p>

    {#if error}
      <p class="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#ff8a8a]">
        {error}
      </p>
    {/if}

    <form onsubmit={submit} class="flex flex-col gap-4">
      <div>
        <label class="mb-1.5 block text-[11px] tracking-[0.03em] text-ink-1 uppercase" for="admin-email">Correo</label>
        <input
          id="admin-email"
          class="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 font-[inherit] text-[13.5px] text-ink-0 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          type="email"
          autocomplete="username"
          bind:value={email}
        />
      </div>

      <div>
        <label class="mb-1.5 block text-[11px] tracking-[0.03em] text-ink-1 uppercase" for="admin-password">Contraseña</label>
        <input
          id="admin-password"
          class="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 font-[inherit] text-[13.5px] text-ink-0 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          type="password"
          autocomplete="current-password"
          bind:value={password}
        />
      </div>

      <button
        class="mt-1 w-full rounded-full bg-gradient-to-b from-accent to-accent-dim py-3 text-[13.5px] font-bold text-[#04150d] shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] transition-[filter,transform] disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:brightness-110 enabled:active:scale-[0.98]"
        type="submit"
        disabled={!email.trim() || !password || sending}
      >
        {sending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  </div>
</div>
