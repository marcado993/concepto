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
  import { login } from "./auth.svelte";

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  let institutionalEmail = $state("");

  function continueWithGithub() {
    login("github");
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

  <div class="panel" role="dialog" aria-modal="true" aria-label="Iniciar sesión">
    <button class="back" onclick={onclose} aria-label="Volver">‹ Volver</button>

    <div class="brand-row">
      <span class="brand-dot"></span>
      <span class="brand-name">AEIS</span>
    </div>
    <h2 class="title">Inicia sesión</h2>
    <p class="subtitle">Accede con tu cuenta para alquilar casilleros y aportar a AEIS</p>

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
    />
    <button class="cta" disabled title="El login por correo institucional todavía no está disponible — usa GitHub por ahora">
      Continuar con correo (próximamente)
    </button>

    <p class="footnote">🔒 Tu sesión la maneja Logto — AEIS-APP nunca ve ni guarda tu contraseña.</p>
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

  .panel {
    position: relative;
    z-index: 1;
    width: min(400px, 100%);
    background: linear-gradient(180deg, rgba(20, 26, 40, 0.9), rgba(6, 9, 16, 0.94));
    border: 1px solid var(--line-strong, rgba(120, 200, 255, 0.16));
    border-radius: 22px;
    padding: 26px 24px 22px;
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
  .brand-name {
    font-family: var(--font-display, sans-serif);
    font-size: 12px;
    letter-spacing: 0.3em;
    color: rgba(238, 244, 251, 0.75);
  }

  .title {
    font-family: var(--font-display, sans-serif);
    font-size: 21px;
    margin: 0 0 6px;
    color: #eef4fb;
  }

  .subtitle {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(238, 244, 251, 0.68);
    margin: 0 0 22px;
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
