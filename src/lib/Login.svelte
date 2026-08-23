<script lang="ts">
  // Pantalla de login PROPIA de AEIS-APP, en el mismo estilo visual que el
  // resto de la app (glass panel oscuro + acento neón, como
  // RentLockerModal.svelte) — reemplaza el flujo anterior de mandar al
  // estudiante derecho a la pantalla genérica hospedada por Logto en
  // cuanto tocaba "Iniciar sesión". Logto sigue siendo el conector real
  // (backend/src/shared/auth/logto-oidc.client.ts) — solo deja de ser lo
  // primero que el estudiante ve.
  //
  // "Continuar con GitHub"/"Continuar con Google" llaman a
  // /auth/social/start, que habla con la Experience API de Logto por
  // dentro y redirige derecho al proveedor real — la pantalla hospedada de
  // Logto nunca se llega a mostrar (ver auth.svelte.ts).
  import Background from "./Background.svelte";
  import TypeText from "./TypeText.svelte";
  import { loginSocial, startEmailLogin, verifyEmailLogin, getPendingEmailFromToken, EmailLoginError } from "./auth.svelte";

  interface Props {
    onclose: () => void;
    showBack?: boolean;
    errorMessage?: string | null;
  }
  let { onclose, showBack = true, errorMessage = null }: Props = $props();

  // Bug real reportado en producción: pedir el código, tardarse en volver
  // a la app (revisar el correo toma un rato real) y encontrar "Sesión de
  // verificación expirada o inválida" con un código recién llegado. Causa
  // raíz: `step` es $state LOCAL de este componente — una recarga de la
  // pestaña (celular con poca RAM descartando pestañas en segundo plano,
  // el caso real más común mientras se revisa el correo) lo resetea a
  // "email" sin avisar, aunque el pendingToken siga vigente en
  // sessionStorage (ver auth.svelte.ts). Arrancar ya en "code" cuando
  // existe un token pendiente sin vencer evita el reinicio invisible.
  const restoredEmail = getPendingEmailFromToken();

  // Ya no se exige dominio @epn.edu.ec (decisión de DGIP, 2026-08-19) —
  // cualquier correo válido sirve para registrarse/entrar, ver el
  // comentario de isValidEmail en backend/src/shared/auth/auth.controller.ts.
  let email = $state(restoredEmail ?? "");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmailInput = $derived(EMAIL_RE.test(email.trim()));

  // El paso de código nunca sale a la pantalla de Logto — se queda acá
  // mismo (ver startEmailLogin/verifyEmailLogin en auth.svelte.ts, que
  // hablan con la Experience API de Logto por dentro, vía el backend).
  let step = $state<"email" | "code">(restoredEmail ? "code" : "email");
  let otpCode = $state("");
  let sending = $state(false);
  let localError = $state<string | null>(null);
  let infoMessage = $state<string | null>(null);

  // Botón "Reenviar código" con espera de 3 minutos — antes la ÚNICA
  // forma de pedir un código nuevo era "‹ Usar otro correo" (que además
  // no reenviaba nada por sí sola, solo volvía al paso 1). Bug real
  // reportado: un código de Logto puede vencer o quedar inválido después
  // de usarse una vez, y sin un botón de reenvío a mano, quien recibía un
  // error reintentaba con ESE MISMO código vencido una y otra vez. Los 3
  // minutos coinciden con el límite real del backend (máximo 3 códigos
  // por correo cada 15 min, ver EmailDestinationLimiter) — sin este
  // límite en la propia UI, alguien podría gastar ese cupo entero
  // reenviando de golpe antes de que el primer código ni siquiera llegue.
  const RESEND_COOLDOWN_MS = 3 * 60 * 1000;
  let resendAvailableAt = $state(0);
  let nowTick = $state(Date.now());
  const resendSecondsLeft = $derived(Math.max(0, Math.ceil((resendAvailableAt - nowTick) / 1000)));
  const canResend = $derived(resendSecondsLeft === 0 && !sending);

  function formatCountdown(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // Tictac de un segundo SOLO mientras se está en el paso de código — no
  // tiene sentido gastar un setInterval corriendo de fondo mientras se
  // escribe el correo o después de haber iniciado sesión.
  $effect(() => {
    if (step !== "code") return;
    const id = setInterval(() => (nowTick = Date.now()), 1000);
    return () => clearInterval(id);
  });

  // Bug real reportado: "la pantalla de carga sale dos veces". A
  // diferencia de continueWithEmail/confirmCode/resendCode (todos
  // guardados contra reintentos con `sending`), estos botones NO tenían
  // ninguna guardia — un doble toque disparaba `window.location.href`
  // DOS VECES, interrumpiendo la primera navegación a mitad de camino y
  // arrancando otra: eso es lo que se ve como "la carga dos veces". La
  // navegación en sí saca de esta pantalla (no hay "sending = false" que
  // volver a poner, la página entera se va), así que solo hace falta
  // bloquear el SEGUNDO toque mientras el primero ya está en camino.
  let oauthRedirecting = $state(false);

  function continueWithGithub() {
    if (oauthRedirecting) return;
    oauthRedirecting = true;
    loginSocial("github");
  }

  function continueWithGoogle() {
    if (oauthRedirecting) return;
    oauthRedirecting = true;
    loginSocial("google");
  }

  async function continueWithEmail() {
    if (!isValidEmailInput || sending) return;
    sending = true;
    localError = null;
    try {
      await startEmailLogin(email.trim());
      step = "code";
      resendAvailableAt = Date.now() + RESEND_COOLDOWN_MS;
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
        // El backend ya mandó un código nuevo en este mismo paso — el
        // reenvío manual debe esperar desde AHORA, no desde el envío
        // original (si no, el botón quedaría disponible casi de
        // inmediato para un código que recién acaba de salir).
        resendAvailableAt = Date.now() + RESEND_COOLDOWN_MS;
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

  async function resendCode() {
    if (!canResend) return;
    sending = true;
    localError = null;
    infoMessage = null;
    try {
      await startEmailLogin(email.trim());
      otpCode = "";
      resendAvailableAt = Date.now() + RESEND_COOLDOWN_MS;
      infoMessage = "Te mandamos un código nuevo";
    } catch (err) {
      localError = err instanceof EmailLoginError ? err.message : "No se pudo reenviar el código — intenta de nuevo";
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
      <button class="provider-btn github" onclick={continueWithGithub} disabled={oauthRedirecting}>
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

      <button class="provider-btn google" onclick={continueWithGoogle} disabled={oauthRedirecting}>
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        Continuar con Google
      </button>

      <div class="divider"><span>o con correo electrónico</span></div>

      <label class="field-label" for="login-email">Correo electrónico</label>
      <input
        id="login-email"
        class="field-input"
        type="email"
        placeholder="tu@correo.com"
        bind:value={email}
        autocomplete="email"
        onkeydown={(e) => e.key === "Enter" && continueWithEmail()}
      />
      <button
        class="cta"
        disabled={!isValidEmailInput || sending}
        title={isValidEmailInput ? undefined : "Escribe un correo completo"}
        onclick={continueWithEmail}
      >
        {sending ? "Enviando código…" : "Continuar con correo"}
      </button>

      <p class="footnote">🔒 Tu sesión la maneja Logto — AEIS-APP nunca ve ni guarda tu contraseña.</p>
    {:else}
      <label class="field-label" for="login-otp">Código de 6 dígitos</label>
      <p class="subtitle" style="margin-top:-2px">
        Te lo mandamos a <strong>{email.trim()}</strong>
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
      <div class="code-footer">
        <button class="link-btn" onclick={resendCode} disabled={!canResend}>
          {canResend ? "Reenviar código" : `Reenviar código en ${formatCountdown(resendSecondsLeft)}`}
        </button>
        <button class="link-btn" onclick={backToEmail} disabled={sending}>‹ Usar otro correo</button>
      </div>
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
  /* Gateado a (hover: hover) — mismo hallazgo real que .unit:hover en
     CategoryContent.svelte: sin esto, el primer tap en móvil se "gasta"
     simulando hover y hace falta un segundo tap para que el botón
     realmente actúe. */
  @media (hover: hover) and (pointer: fine) {
    .back:hover {
      color: var(--accent, #21e0a0);
    }
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

  .code-footer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 14px;
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
    padding: 4px;
    /* font-variant-numeric: la cuenta regresiva cambia de dígitos varias
       veces por minuto ("2:59" → "2:58" ...) — sin esto los números
       proporcionales hacen que el botón cambie de ancho y "tiemble". */
    font-variant-numeric: tabular-nums;
  }
  .code-footer .link-btn {
    margin-top: 0;
  }
  @media (hover: hover) and (pointer: fine) {
    .link-btn:hover:not(:disabled) {
      color: var(--accent, #21e0a0);
    }
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
    /* GitHub y Google quedaban pegados entre sí sin nada de aire —
       margin-top en vez de gap en el padre porque el padre no es un flex
       container acá, solo hay dos botones sueltos seguidos en el markup. */
    margin-top: 10px;
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
  @media (hover: hover) and (pointer: fine) {
    .provider-btn:hover:not(:disabled) {
      border-color: var(--accent, #21e0a0);
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-1px);
    }
  }
  .provider-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .provider-btn.github svg,
  .provider-btn.google svg {
    flex: 0 0 auto;
  }
  /* El logo de Google es a color a propósito (marca registrada — no se
     recolorea con currentColor como el de GitHub) y ya trae su fondo
     blanco propio en cada trazo del svg, así que no necesita nada más
     acá; solo separarlo del texto igual que el resto. */

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
