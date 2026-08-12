<script lang="ts">
  // Pantalla de login PROPIA de AEIS-APP, en el mismo estilo visual que el
  // resto de la app (glass panel oscuro + acento neón, como
  // RentLockerModal.svelte) — reemplaza el flujo anterior de mandar al
  // estudiante derecho a la pantalla genérica hospedada por Logto en
  // cuanto tocaba "Iniciar sesión". Logto sigue siendo el conector real
  // (backend/src/shared/auth/logto-oidc.client.ts) — solo deja de ser lo
  // primero que el estudiante ve.
  //
  // "Continuar con GitHub" pasa ?connector=github a /auth/login, que el
  // backend traduce a direct_sign_in=social:github — salta el selector de
  // Logto y va directo a la pantalla real de GitHub para autorizar la app.
  import Background from "./Background.svelte";
  import TypeText from "./TypeText.svelte";
  import { login, startEmailLogin, verifyEmailLogin, EmailLoginError } from "./auth.svelte";

  interface Props {
    onclose: () => void;
    showBack?: boolean;
    errorMessage?: string | null;
  }
  let { onclose, showBack = true, errorMessage = null }: Props = $props();

  let institutionalEmail = $state("");
  const EMAIL_RE = /^[^\s@]+@epn\.edu\.ec$/i;
  const isValidInstitutionalEmail = $derived(EMAIL_RE.test(institutionalEmail.trim()));

  // El paso de código nunca sale a la pantalla de Logto — se queda acá
  // mismo (ver startEmailLogin/verifyEmailLogin en auth.svelte.ts, que
  // hablan con la Experience API de Logto por dentro, vía el backend).
  let step = $state<"email" | "code">("email");
  let otpCode = $state("");
  let sending = $state(false);
  let localError = $state<string | null>(null);
  let infoMessage = $state<string | null>(null);

  function continueWithGithub() {
    login("github");
  }

  async function continueWithEmail() {
    if (!isValidInstitutionalEmail || sending) return;
    sending = true;
    localError = null;
    try {
      await startEmailLogin(institutionalEmail.trim());
      step = "code";
    } catch (err) {
      localError = err instanceof EmailLoginError ? err.message : "No se pudo enviar el código — intenta de nuevo";
    } finally {
      sending = false;
    }
  }

  async function confirmCode() {
    if (otpCode.trim().length < 6 || sending) return;
    sending = true;
    localError = null;
    infoMessage = null;
    try {
      const result = await verifyEmailLogin(otpCode.trim());
      if (result.needsNewCode) {
        otpCode = "";
        infoMessage = "Es tu primera vez con este correo — te mandamos un código nuevo para crear tu cuenta";
        return;
      }
      // sesión ya quedó guardada por verifyEmailLogin() — App.svelte
      // reacciona solo a isAuthenticated() cambiando de pantalla.
    } catch (err) {
      localError = err instanceof EmailLoginError ? err.message : "Código incorrecto o vencido — intenta de nuevo";
    } finally {
      sending = false;
    }
  }

  function backToEmail() {
    step = "email";
    otpCode = "";
    localError = null;
    infoMessage = null;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Pantalla COMPLETA, no un modal con blur encima de la app — el
     estudiante ve login o ve la app, nunca las dos superpuestas. Mismo
     <Background> que usa el resto de AEIS-APP, para que se sienta como
     otra sección de la app y no como un popup ajeno. -->
<div class="page">
  <Background tint="navy" />

  <div class="login-stack">
    <img src="/aso.png" alt="AEIS" class="logo" />

    <div class="panel" role="dialog" aria-modal="true" aria-label="Iniciar sesión">
      {#if showBack}
        <button class="back" onclick={onclose} aria-label="Volver">‹ Volver</button>
      {/if}

      <div class="brand-row">
        <span class="brand-dot"></span>
        <TypeText tag="span" class="login-brand-name" text="AEIS" speed={90} />
      </div>
      <TypeText tag="h2" class="login-title" text="Inicia sesión" speed={38} startDelay={420} />
    <p class="subtitle">Accede con tu cuenta para alquilar casilleros y aportar a AEIS</p>

    {#if errorMessage}
      <p class="login-error">{errorMessage}</p>
    {/if}
    {#if localError}
      <p class="login-error">{localError}</p>
    {/if}
    {#if infoMessage}
      <p class="login-info">{infoMessage}</p>
    {/if}

    {#if step === "email"}
      <button class="provider-btn github" onclick={continueWithGithub}>
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
               0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
               -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
               .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
               -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
               1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
               1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
               1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        Continuar con GitHub
      </button>

      <div class="divider"><span>o con correo institucional</span></div>

      <label class="field-label" for="login-email">Correo institucional</label>
      <input
        id="login-email"
        class="field-input"
        type="email"
        placeholder="tu.nombre@epn.edu.ec"
        bind:value={institutionalEmail}
        autocomplete="email"
        onkeydown={(e) => e.key === "Enter" && continueWithEmail()}
      />
      <button
        class="cta"
        disabled={!isValidInstitutionalEmail || sending}
        title={isValidInstitutionalEmail ? undefined : "Escribe tu correo @epn.edu.ec completo"}
        onclick={continueWithEmail}
      >
        {sending ? "Enviando código…" : "Continuar con correo"}
      </button>

      <p class="footnote">🔒 Tu sesión la maneja Logto — AEIS-APP nunca ve ni guarda tu contraseña.</p>
    {:else}
      <label class="field-label" for="login-otp">Código de 6 dígitos</label>
      <p class="subtitle" style="margin-top:-2px">
        Te lo mandamos a <strong>{institutionalEmail.trim()}</strong>
      </p>
      <input
        id="login-otp"
        class="field-input otp-input"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="6"
        placeholder="000000"
        bind:value={otpCode}
        autocomplete="one-time-code"
        onkeydown={(e) => e.key === "Enter" && confirmCode()}
      />
      <button class="cta" disabled={otpCode.trim().length < 6 || sending} onclick={confirmCode}>
        {sending ? "Verificando…" : "Confirmar código"}
      </button>
      <button class="link-btn" onclick={backToEmail} disabled={sending}>‹ Usar otro correo</button>
    {/if}
    </div>
  </div>
</div>

<style>
  /* position: fixed cubriendo TODO el viewport, opaco de verdad (el
     <Background> de adentro ya pinta su propio fondo sólido) — no hay
     "afuera" visible, así que esto se siente como entrar a otra pantalla,
     no como un popup encima de la app. z-index alto: por encima de
     cualquier otro modal que ya estuviera abierto (ej. RentLockerModal). */
  .page {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    overflow-y: auto;
  }

  .login-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(400px, 100%);
  }

  /* Se monta encima del borde superior del panel a propósito (margin
     negativo) — mismo look que el mockup: la pantera "asoma" desde arriba
     de la tarjeta en vez de flotar suelta y separada. */
  .logo {
    width: 92px;
    height: 92px;
    object-fit: contain;
    filter: drop-shadow(0 0 20px rgba(33, 224, 160, 0.5));
    margin-bottom: -18px;
    z-index: 2;
  }

  .panel {
    position: relative;
    z-index: 1;
    width: 100%;
    background: linear-gradient(180deg, rgba(20, 26, 40, 0.9), rgba(6, 9, 16, 0.94));
    border: 1px solid var(--line-strong, rgba(120, 200, 255, 0.16));
    border-radius: 22px;
    padding: 42px 24px 22px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
  }

  .back {
    position: absolute;
    top: 14px;
    right: 14px;
    background: none;
    border: none;
    color: rgba(238, 244, 251, 0.55);
    font-size: 12.5px;
    letter-spacing: 0.02em;
    cursor: pointer;
    padding: 4px 6px;
  }
  .back:hover {
    color: var(--accent, #21e0a0);
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
    background: var(--accent, #21e0a0);
    box-shadow: 0 0 10px var(--accent-glow, rgba(33, 224, 160, 0.5));
  }
  /* :global() a propósito — TypeText.svelte es quien renderiza estos
     elementos, y class="brand-name"/"title" llega ahí como texto plano,
     no como parte del template de Login.svelte. Sin :global() el hash de
     scoped-CSS de Svelte nunca matchea (mismo hallazgo real que .label en
     App.svelte). */
  :global(.login-brand-name) {
    font-family: var(--font-heading, sans-serif);
    font-size: 12px;
    letter-spacing: 0.3em;
    color: rgba(238, 244, 251, 0.75);
  }

  :global(.login-title) {
    font-family: var(--font-heading, sans-serif);
    font-size: 21px;
    letter-spacing: 0.03em;
    margin: 0 0 6px;
    color: #eef4fb;
  }

  .subtitle {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(238, 244, 251, 0.68);
    margin: 0 0 22px;
  }

  .login-error {
    font-size: 12.5px;
    line-height: 1.5;
    color: #ff8a8a;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 10px;
    padding: 9px 12px;
    margin: -10px 0 18px;
  }

  .login-info {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--accent, #21e0a0);
    background: rgba(33, 224, 160, 0.1);
    border: 1px solid rgba(33, 224, 160, 0.3);
    border-radius: 10px;
    padding: 9px 12px;
    margin: -10px 0 18px;
  }

  .otp-input {
    text-align: center;
    letter-spacing: 0.5em;
    font-size: 20px;
    font-weight: 700;
  }

  .link-btn {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: rgba(238, 244, 251, 0.55);
    font-size: 12.5px;
    text-align: center;
    cursor: pointer;
    margin-top: 14px;
    padding: 4px;
  }
  .link-btn:hover:not(:disabled) {
    color: var(--accent, #21e0a0);
  }
  .link-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .provider-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: #eef4fb;
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      transform 0.15s ease;
  }
  .provider-btn:hover {
    border-color: var(--accent, #21e0a0);
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-1px);
  }
  .provider-btn.github svg {
    flex: 0 0 auto;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 18px 0 14px;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: rgba(238, 244, 251, 0.45);
    text-transform: uppercase;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
  }

  .field-label {
    display: block;
    font-size: 11px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: rgba(238, 244, 251, 0.55);
    margin-bottom: 6px;
  }

  .field-input {
    width: 100%;
    padding: 11px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 13.5px;
    margin-bottom: 14px;
  }
  .field-input:focus {
    outline: none;
    border-color: var(--accent, #21e0a0);
  }
  .field-input::placeholder {
    color: rgba(238, 244, 251, 0.35);
  }

  .cta {
    width: 100%;
    padding: 12px 16px;
    border-radius: 999px;
    border: none;
    background: var(--accent, #21e0a0);
    color: #04150d;
    font-weight: 700;
    font-size: 13.5px;
    cursor: pointer;
  }
  .cta:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .footnote {
    margin: 16px 0 0;
    font-size: 11px;
    line-height: 1.5;
    text-align: center;
    color: rgba(238, 244, 251, 0.45);
  }
</style>
