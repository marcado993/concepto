<script lang="ts">
  // Modal de aportación — mismo patrón de 3 pasos que RentLockerModal.svelte
  // (identidad+método → PayPhone/comprobante → confirmación), adaptado a
  // Aportaciones: el precio es el mismo sin importar el método (a
  // diferencia de casilleros, subscription.service.ts no le suma recargo
  // de PayPhone al monto del tier).
  import {
    fetchMe,
    subscribeToTier,
    confirmSubscriptionReceipt,
    fetchSubscriptionPayphoneConfig,
    ApiError,
    type MeResponse,
  } from "./api";
  import { loadPayphoneSdk } from "./payphoneSdk";
  import { isAuthenticated } from "./auth.svelte";
  import Login from "./Login.svelte";

  interface Props {
    tierName: string;
    tierAmount: string;
    onclose: () => void;
    onsubscribed?: () => void;
  }

  let { tierName, tierAmount, onclose, onsubscribed }: Props = $props();

  type Step = "identity" | "payphone" | "receipt-upload" | "confirmed" | "rejected";
  let step = $state<Step>("identity");
  let method = $state<"PAYPHONE" | "TRANSFER">("TRANSFER");

  const priceLabel = $derived(`$${tierAmount}`);
  const amountCents = $derived(Math.round(parseFloat(tierAmount) * 100));

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
  let subscriptionId = $state<string | null>(null);
  let receiptFile = $state<File | null>(null);

  // Igual que casilleros: se crea la aportación (PENDING) de una vez —
  // con PAYPHONE el cobro real todavía no pasó, pasa en el widget del
  // paso 2 (ver backend/src/subscription/subscription.service.ts
  // confirmPayphonePayment).
  async function continueFromIdentity() {
    errorMessage = null;
    busy = true;
    try {
      const subscription = await subscribeToTier({ tierName, method });
      subscriptionId = subscription.id;
      step = method === "PAYPHONE" ? "payphone" : "receipt-upload";
    } catch (err) {
      errorMessage = err instanceof ApiError ? err.message : "No se pudo iniciar la aportación";
    } finally {
      busy = false;
    }
  }

  let payphoneConfig = $state<{ configured: boolean; token: string; storeId: string } | null>(null);
  let payphoneConfigError = $state(false);
  let payphoneContainer = $state<HTMLDivElement | null>(null);
  let payphoneWidgetStarted = $state(false);

  $effect(() => {
    if (step !== "payphone" || payphoneConfig || payphoneConfigError) return;
    fetchSubscriptionPayphoneConfig()
      .then((c) => (payphoneConfig = c))
      .catch(() => (payphoneConfigError = true));
  });

  $effect(() => {
    if (
      step !== "payphone" ||
      !payphoneConfig?.configured ||
      !subscriptionId ||
      !payphoneContainer ||
      payphoneWidgetStarted
    ) {
      return;
    }
    payphoneWidgetStarted = true;
    const containerId = payphoneContainer.id;
    loadPayphoneSdk()
      .then(() => {
        new window.PPaymentButtonBox!({
          token: payphoneConfig!.token,
          storeId: payphoneConfig!.storeId,
          clientTransactionId: subscriptionId!,
          amount: amountCents,
          amountWithoutTax: amountCents,
          currency: "USD",
          reference: `Aportación ${tierName}`,
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
    if (!subscriptionId || !receiptFile) return;
    errorMessage = null;
    busy = true;
    try {
      await confirmSubscriptionReceipt(subscriptionId, receiptFile);
      step = "confirmed";
      onsubscribed?.();
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
      <div class="step-badge">Paso 1 de 3 · Identidad y método</div>

      {#if meError}
        <p class="modal-copy error">No se pudo cargar tu perfil — intenta de nuevo.</p>
      {:else if !me}
        <p class="modal-copy">Cargando tu perfil…</p>
      {:else}
        <div class="identity-card">
          <div class="identity-row"><span>Nombre</span><strong>{me.fullName}</strong></div>
          <div class="identity-row"><span>Código</span><strong>{me.uniqueCode}</strong></div>
          <div class="identity-row"><span>Tier</span><strong>{tierName} — {priceLabel}</strong></div>
        </div>

        <div class="method-choice">
          <button
            class="method-option"
            class:selected={method === "TRANSFER"}
            onclick={() => (method = "TRANSFER")}
          >
            <span class="method-label">Comprobante de transferencia</span>
            <span class="method-price">{priceLabel}</span>
          </button>
          <button
            class="method-option"
            class:selected={method === "PAYPHONE"}
            onclick={() => (method = "PAYPHONE")}
          >
            <span class="method-label">PayPhone</span>
            <span class="method-price">{priceLabel}</span>
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
          Vas a pagar {priceLabel} con PayPhone por tu aportación {tierName}. Se abrirá el formulario
          seguro de PayPhone — al terminar, vuelves aquí y confirmamos el pago automáticamente.
        </p>
        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}
        <div id="pp-sub-button-{tierName}" bind:this={payphoneContainer} class="payphone-widget"></div>
      {/if}
    {:else if step === "receipt-upload"}
      <div class="step-badge">Paso 2 de 3 · Comprobante</div>
      <p class="modal-copy">
        Aportación reservada — sube una foto legible del comprobante de transferencia de {priceLabel}. La
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
          ? `¡Aportación ${tierName} confirmada!`
          : `¡Comprobante validado! Tu aportación ${tierName} ya quedó activa.`}
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
    width: min(380px, 100%);
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

  .payphone-widget {
    min-height: 52px;
  }
</style>
