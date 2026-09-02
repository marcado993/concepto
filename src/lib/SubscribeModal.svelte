<script lang="ts">
  // Modal de aportación — 2 pasos: identidad → confirmación. Aportaciones
  // son INFORMATIVAS, sin pasarela real (decisión de negocio) — a
  // diferencia de casilleros, acá nunca se abre PayPhone; el backend
  // confirma el "pago" de una vez (ver
  // backend/src/subscription/subscription.service.ts::subscribe(),
  // autoConfirm:true).
  import { fetchMe, subscribeToTier, ApiError, type MeResponse } from "./api";
  import { isAuthenticated } from "./auth.svelte";
  import Login from "./Login.svelte";

  import { portal } from "./portal";
  interface Props {
    tierName: string;
    tierAmount: string;
    onclose: () => void;
    onsubscribed?: () => void;
  }

  let { tierName, tierAmount, onclose, onsubscribed }: Props = $props();

  type Step = "identity" | "confirmed";
  let step = $state<Step>("identity");

  const priceLabel = $derived(`$${tierAmount}`);

  let me = $state<MeResponse | null>(null);
  let meError = $state(false);
  // Nombre completo — mismo motivo/patrón que RentLockerModal.svelte:
  // aportar nunca lo pedía en absoluto, así que quedaba con el placeholder
  // interno para siempre (que llegó a ser literalmente el correo del
  // estudiante — bug real corregido, ver PENDING_FULL_NAME en
  // auth.service.ts). Siempre editable, nunca prellenado con ese
  // placeholder.
  let fullName = $state("");
  const FULL_NAME_RE = /^\S+(\s+\S+)+$/;
  const fullNameValid = $derived(FULL_NAME_RE.test(fullName.trim()));
  $effect(() => {
    if (!isAuthenticated()) return;
    fetchMe()
      .then((data) => {
        me = data;
        fullName = data.fullName ?? "";
      })
      .catch(() => (meError = true));
  });

  let showLogin = $state(false);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);

  // La aportación queda CONFIRMED de una vez del lado del backend — no hay
  // un paso 2 de pago que esperar acá, a diferencia de casilleros.
  async function continueFromIdentity() {
    if (!fullNameValid) return;
    errorMessage = null;
    busy = true;
    try {
      await subscribeToTier({ tierName, fullName: fullName.trim() });
      step = "confirmed";
      onsubscribed?.();
    } catch (err) {
      errorMessage = err instanceof ApiError ? err.message : "No se pudo registrar la aportación";
    } finally {
      busy = false;
    }
  }

  function onScrimKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<div class="scrim" use:portal onclick={onclose} onkeydown={onScrimKeydown} role="button" tabindex="-1" aria-label="Cerrar">
  <div
    class="modal"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Aportar — tier {tierName}"
  >
    <button class="close" onclick={onclose} aria-label="Cerrar">×</button>
    <h3 class="modal-title">Aportación {tierName}</h3>

    {#if !isAuthenticated()}
      <p class="modal-copy">Inicia sesión para aportar a AEIS.</p>
      <button class="cta" onclick={() => (showLogin = true)}>Iniciar sesión</button>
      {#if showLogin}
        <Login onclose={() => (showLogin = false)} />
      {/if}
    {:else if step === "identity"}
      <div class="step-badge">Paso 1 de 2 · Identidad</div>

      {#if meError}
        <p class="modal-copy error">No se pudo cargar tu perfil — intenta de nuevo.</p>
      {:else if !me}
        <p class="modal-copy">Cargando tu perfil…</p>
      {:else}
        <label class="field-label" for="sub-full-name">Nombre completo</label>
        <div class="field-wrap">
          <input
            id="sub-full-name"
            class="field-input"
            class:invalid={fullName.length > 0 && !fullNameValid}
            class:valid={fullNameValid}
            type="text"
            placeholder="Pon tus nombres, ej. Luis Andrés Guerrero"
            bind:value={fullName}
          />
          {#if fullNameValid}<span class="field-check" aria-hidden="true">✓</span>{/if}
        </div>
        {#if fullName.length > 0 && !fullNameValid}
          <p class="field-hint error">Te falta el apellido — escribe tu nombre completo</p>
        {/if}

        <div class="identity-card">
          <div class="identity-row"><span>Tier</span><strong>{tierName} — {priceLabel}</strong></div>
        </div>
        <p class="modal-copy hint">
          Esto registra tu aportación como {tierName} — es informativo, no se procesa ningún cobro dentro de la app.
        </p>

        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}

        <button class="cta" disabled={busy || !fullNameValid} onclick={continueFromIdentity}>
          {busy ? "Un momento…" : "Confirmar aportación"}
        </button>
      {/if}
    {:else if step === "confirmed"}
      <div class="step-badge">Paso 2 de 2 · Listo</div>
      <p class="modal-copy success">¡Aportación {tierName} confirmada!</p>
      <button class="cta" onclick={onclose}>Cerrar</button>
    {/if}
  </div>
</div>

<style>
  .scrim {
    /* Con la pagina permitiendo "deslizar para recargar", un tiron
       hacia abajo mientras se llena el formulario la recargaria y se
       perderia lo escrito. `contain` corta esa cadena. */
    overscroll-behavior: contain;
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(2, 4, 10, 0.72);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  /* Mismo hallazgo que RentLockerModal.svelte: backdrop-filter es caro en
     GPUs Android de gama baja, y en mobile un scrim sólido más opaco se ve
     casi igual sin ese costo. */
  @media (max-width: 767px) {
    .scrim {
      background: rgba(2, 4, 10, 0.88);
      backdrop-filter: none;
    }
  }

  .modal {
    position: relative;
    width: min(400px, 100%);
    max-height: 86vh;
    overflow-y: auto;
    background: linear-gradient(180deg, rgba(20, 26, 40, 0.96), rgba(6, 9, 16, 0.98));
    border: 1px solid var(--line-strong, rgba(120, 200, 255, 0.16));
    border-radius: 20px;
    padding: 22px 20px 20px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  }

  /* Grande a propósito (44px, min de objetivo táctil WCAG 2.5.5) — mismo
     feedback real que RentLockerModal.svelte: "para cerrar pon una X
     grande". Salir de un flujo tiene que ser al menos tan fácil de tocar
     como entrar. */
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.07);
    border: none;
    color: #eef4fb;
    font-size: 26px;
    line-height: 1;
    cursor: pointer;
  }

  .modal-title {
    font-family: var(--font-heading, sans-serif);
    font-size: 18px;
    letter-spacing: 0.02em;
    margin: 0 0 4px;
    color: #eef4fb;
  }

  .step-badge {
    display: inline-block;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent, #21e0a0);
    margin-bottom: 12px;
  }

  .modal-copy {
    font-size: 13.5px;
    line-height: 1.5;
    color: rgba(238, 244, 251, 0.82);
    margin: 0 0 14px;
  }
  .modal-copy.error {
    color: #ff8a8a;
  }
  .modal-copy.success {
    color: var(--accent, #21e0a0);
  }
  .modal-copy.hint {
    font-size: 12px;
    color: rgba(238, 244, 251, 0.6);
  }

  .identity-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  .identity-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 12.5px;
    padding: 4px 0;
    color: rgba(238, 244, 251, 0.7);
  }
  .identity-row strong {
    color: #eef4fb;
    text-align: right;
  }

  /* Mismo patrón que RentLockerModal.svelte — check verde en cuanto el
     campo queda válido, pista clara si no. */
  .field-label {
    display: block;
    font-size: 11px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: rgba(238, 244, 251, 0.55);
    margin-bottom: 6px;
  }
  .field-wrap {
    position: relative;
  }
  .field-input {
    width: 100%;
    padding: 10px 34px 10px 13px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 13.5px;
    margin-bottom: 12px;
    transition: border-color 0.15s ease;
  }
  .field-input:focus {
    outline: none;
    border-color: var(--accent, #21e0a0);
  }
  .field-input.invalid {
    border-color: #ff8a8a;
  }
  .field-input.valid {
    border-color: var(--accent, #21e0a0);
  }
  .field-check {
    position: absolute;
    right: 12px;
    top: 10px;
    color: var(--accent, #21e0a0);
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
    animation: check-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes check-pop {
    from {
      transform: scale(0.5);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .field-check {
      animation: none;
    }
  }
  .field-hint {
    margin: -8px 0 12px;
    font-size: 11px;
    line-height: 1.4;
  }
  .field-hint.error {
    color: #ff8a8a;
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
    transition:
      filter 0.15s ease,
      transform 0.15s ease;
  }
  /* Gateado a (hover: hover) — mismo hallazgo real que .unit:hover en
     CategoryContent.svelte: sin esto, el primer tap en móvil se "gasta"
     simulando hover y hace falta un segundo tap para que el botón
     realmente actúe. */
  @media (hover: hover) and (pointer: fine) {
    .cta:hover:not(:disabled) {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
  }
  .cta:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
