<script lang="ts">
  // Modal de alquiler — 3 pasos como máximo, tal como se pidió:
  //   1) identidad (solo lectura, de la sesión) + método de pago
  //   2) PayPhone (widget) o subir comprobante de transferencia
  //   3) confirmación
  // Nunca se le pide al estudiante escribir su nombre/código a mano — ya
  // está logueado, esos datos vienen de GET /auth/me (ver
  // backend/src/shared/auth/auth.controller.ts).
  import {
    fetchMe,
    rentLocker,
    confirmLockerReceipt,
    fetchPayphoneConfig,
    ApiError,
    type MeResponse,
  } from "./api";
  import { loadPayphoneSdk } from "./payphoneSdk";
  import { isAuthenticated } from "./auth.svelte";
  import Login from "./Login.svelte";

  interface Props {
    lockerCode: string;
    onclose: () => void;
    onrented?: () => void;
  }

  let { lockerCode, onclose, onrented }: Props = $props();

  type Step = "identity" | "payphone" | "receipt-upload" | "confirmed" | "rejected";
  let step = $state<Step>("identity");
  let method = $state<"PAYPHONE" | "TRANSFER">("TRANSFER");

  let me = $state<MeResponse | null>(null);
  let meError = $state(false);
  $effect(() => {
    if (!isAuthenticated()) return;
    fetchMe()
      .then((data) => (me = data))
      .catch(() => (meError = true));
  });

  let showLogin = $state(false);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let rentalId = $state<string | null>(null);
  let receiptFile = $state<File | null>(null);

  const PRICE: Record<"PAYPHONE" | "TRANSFER", string> = {
    PAYPHONE: "$6.90",
    TRANSFER: "$6.50",
  };
  const PRICE_CENTS: Record<"PAYPHONE" | "TRANSFER", number> = {
    PAYPHONE: 690,
    TRANSFER: 650,
  };

  // Ambos métodos crean el alquiler (PENDING/RESERVED) de una vez — con
  // PAYPHONE el cobro real todavía no pasó, pasa en el widget del paso 2
  // (ver backend/src/locker/locker.service.ts confirmPayphonePayment). El
  // casillero queda RESERVED mientras tanto, igual que TRANSFER.
  async function continueFromIdentity() {
    errorMessage = null;
    busy = true;
    try {
      const rental = await rentLocker({ lockerCode, method });
      rentalId = rental.id;
      step = method === "PAYPHONE" ? "payphone" : "receipt-upload";
    } catch (err) {
      errorMessage = err instanceof ApiError ? err.message : "No se pudo iniciar el alquiler";
    } finally {
      busy = false;
    }
  }

  // Config del widget de PayPhone (token/storeId públicos) — se pide solo
  // al entrar al paso 2, no en cada apertura del modal.
  let payphoneConfig = $state<{ configured: boolean; token: string; storeId: string } | null>(null);
  let payphoneConfigError = $state(false);
  let payphoneContainer = $state<HTMLDivElement | null>(null);
  let payphoneWidgetStarted = $state(false);

  $effect(() => {
    if (step !== "payphone" || payphoneConfig || payphoneConfigError) return;
    fetchPayphoneConfig()
      .then((c) => (payphoneConfig = c))
      .catch(() => (payphoneConfigError = true));
  });

  // Renderiza el widget real de PayPhone en cuanto: estamos en el paso 2,
  // la config llegó y está configured:true, el alquiler PENDING ya existe
  // (clientTransactionId = rentalId) y el <div> contenedor ya está en el
  // DOM. Solo se dispara una vez por apertura del modal (payphoneWidgetStarted).
  $effect(() => {
    if (
      step !== "payphone" ||
      !payphoneConfig?.configured ||
      !rentalId ||
      !payphoneContainer ||
      payphoneWidgetStarted
    ) {
      return;
    }
    payphoneWidgetStarted = true;
    const containerId = payphoneContainer.id;
    loadPayphoneSdk()
      .then(() => {
        const amountCents = PRICE_CENTS.PAYPHONE;
        new window.PPaymentButtonBox!({
          token: payphoneConfig!.token,
          storeId: payphoneConfig!.storeId,
          clientTransactionId: rentalId!,
          amount: amountCents,
          amountWithoutTax: amountCents,
          currency: "USD",
          reference: `Alquiler casillero ${lockerCode}`,
          lang: "es",
        }).render(containerId);
      })
      .catch(() => {
        errorMessage = "No se pudo cargar el widget de PayPhone — intenta con transferencia.";
        payphoneWidgetStarted = false;
      });
  });

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    receiptFile = input.files?.[0] ?? null;
  }

  async function submitReceipt() {
    if (!rentalId || !receiptFile) return;
    errorMessage = null;
    busy = true;
    try {
      await confirmLockerReceipt(rentalId, receiptFile);
      step = "confirmed";
      onrented?.();
    } catch (err) {
      errorMessage = err instanceof ApiError ? err.message : "No se pudo validar el comprobante";
      step = "rejected";
    } finally {
      busy = false;
    }
  }

  function retryReceipt() {
    errorMessage = null;
    receiptFile = null;
    step = "receipt-upload";
  }

  function onScrimKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<div class="scrim" onclick={onclose} onkeydown={onScrimKeydown} role="button" tabindex="-1" aria-label="Cerrar">
  <div
    class="modal"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Alquilar casillero {lockerCode}"
  >
    <button class="close" onclick={onclose} aria-label="Cerrar">×</button>
    <h3 class="modal-title">Casillero {lockerCode}</h3>

    {#if !isAuthenticated()}
      <p class="modal-copy">Inicia sesión para alquilar un casillero.</p>
      <button class="cta" onclick={() => (showLogin = true)}>Iniciar sesión</button>
      {#if showLogin}
        <Login onclose={() => (showLogin = false)} />
      {/if}
    {:else if step === "identity"}
      <div class="step-badge">Paso 1 de 3 · Identidad y método</div>

      {#if meError}
        <p class="modal-copy error">No se pudo cargar tu perfil — intenta de nuevo.</p>
      {:else if !me}
        <p class="modal-copy">Cargando tu perfil…</p>
      {:else}
        <div class="identity-card">
          <div class="identity-row"><span>Nombre</span><strong>{me.fullName}</strong></div>
          <div class="identity-row"><span>Código</span><strong>{me.uniqueCode}</strong></div>
        </div>

        <div class="method-choice">
          <button
            class="method-option"
            class:selected={method === "TRANSFER"}
            onclick={() => (method = "TRANSFER")}
          >
            <span class="method-label">Comprobante de transferencia</span>
            <span class="method-price">{PRICE.TRANSFER}</span>
          </button>
          <button
            class="method-option"
            class:selected={method === "PAYPHONE"}
            onclick={() => (method = "PAYPHONE")}
          >
            <span class="method-label">PayPhone</span>
            <span class="method-price">{PRICE.PAYPHONE}</span>
          </button>
        </div>

        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}

        <button class="cta" disabled={busy} onclick={continueFromIdentity}>
          {busy ? "Un momento…" : "Continuar"}
        </button>
      {/if}
    {:else if step === "payphone"}
      <div class="step-badge">Paso 2 de 3 · Pago con PayPhone</div>
      {#if payphoneConfigError}
        <p class="modal-copy error">
          No se pudo cargar la configuración de PayPhone — intenta de nuevo en un momento.
        </p>
      {:else if !payphoneConfig}
        <p class="modal-copy">Cargando PayPhone…</p>
      {:else if !payphoneConfig.configured}
        <p class="modal-copy error">
          PayPhone todavía no está conectado (faltan credenciales de comercio) — usa comprobante de
          transferencia por ahora.
        </p>
      {:else}
        <p class="modal-copy">
          Vas a pagar {PRICE.PAYPHONE} con PayPhone por el casillero {lockerCode}. Se abrirá el formulario
          seguro de PayPhone — al terminar, vuelves aquí y confirmamos el pago automáticamente.
        </p>
        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}
        <div id="pp-button-{lockerCode}" bind:this={payphoneContainer} class="payphone-widget"></div>
      {/if}
    {:else if step === "receipt-upload"}
      <div class="step-badge">Paso 2 de 3 · Comprobante</div>
      <p class="modal-copy">
        Casillero reservado — sube una foto legible del comprobante de transferencia de {PRICE.TRANSFER}. La
        validamos automáticamente.
      </p>
      <label class="file-drop">
        <input type="file" accept="image/jpeg,image/png,image/webp" onchange={onFileChange} />
        {receiptFile ? receiptFile.name : "Elegir imagen del comprobante"}
      </label>
      {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}
      <button class="cta" disabled={busy || !receiptFile} onclick={submitReceipt}>
        {busy ? "Validando…" : "Subir y confirmar"}
      </button>
    {:else if step === "rejected"}
      <div class="step-badge">Paso 3 de 3 · No se pudo confirmar</div>
      <p class="modal-copy error">{errorMessage}</p>
      <button class="cta" onclick={retryReceipt}>Intentar con otra foto</button>
    {:else if step === "confirmed"}
      <div class="step-badge">Paso 3 de 3 · Listo</div>
      <p class="modal-copy success">
        {method === "PAYPHONE"
          ? `¡Casillero ${lockerCode} confirmado!`
          : `¡Comprobante validado! Casillero ${lockerCode} es tuyo.`}
      </p>
      <button class="cta" onclick={onclose}>Cerrar</button>
    {/if}
  </div>
</div>

<style>
  .scrim {
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

  .modal {
    position: relative;
    width: min(380px, 100%);
    max-height: 86vh;
    overflow-y: auto;
    background: linear-gradient(180deg, rgba(20, 26, 40, 0.96), rgba(6, 9, 16, 0.98));
    border: 1px solid var(--line-strong, rgba(120, 200, 255, 0.16));
    border-radius: 20px;
    padding: 22px 20px 20px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  }

  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.07);
    border: none;
    color: #eef4fb;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .modal-title {
    font-family: var(--font-display, sans-serif);
    font-size: 18px;
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

  .method-choice {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .method-option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 11px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #eef4fb;
    cursor: pointer;
    font-size: 13px;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .method-option.selected {
    border-color: var(--accent, #21e0a0);
    background: rgba(33, 224, 160, 0.1);
  }
  .method-price {
    font-weight: 700;
    color: var(--accent, #21e0a0);
  }

  .file-drop {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px 14px;
    border-radius: 14px;
    border: 1.5px dashed rgba(255, 255, 255, 0.18);
    color: rgba(238, 244, 251, 0.75);
    font-size: 12.5px;
    cursor: pointer;
    margin-bottom: 14px;
  }
  .file-drop input {
    display: none;
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
  .cta:hover:not(:disabled) {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
  .cta:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .payphone-widget {
    min-height: 52px;
  }
</style>
