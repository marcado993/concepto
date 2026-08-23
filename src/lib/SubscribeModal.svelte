<script lang="ts">
  // Modal de aportación — 3 pasos: identidad → PayPhone → confirmación.
  // PayPhone es el único método de pago (transferencia + comprobante por
  // OCR se retiró).
  import { fetchMe, subscribeToTier, fetchSubscriptionPayphoneConfig, ApiError, type MeResponse } from "./api";
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

  type Step = "identity" | "payphone" | "confirmed";
  let step = $state<Step>("identity");

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

  // Igual que casilleros: se crea la aportación (PENDING) de una vez — el
  // cobro real todavía no pasó, pasa en el widget del paso 2 (ver
  // backend/src/subscription/subscription.service.ts confirmPayphonePayment).
  async function continueFromIdentity() {
    errorMessage = null;
    busy = true;
    try {
      const subscription = await subscribeToTier({ tierName });
      subscriptionId = subscription.id;
      step = "payphone";
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
        errorMessage = "No se pudo cargar el widget de PayPhone — intenta de nuevo en un momento.";
        payphoneWidgetStarted = false;
      });
  });

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
      <div class="step-badge">Paso 1 de 3 · Identidad</div>

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

        <div class="price-row">
          <span class="price-label">Pago con PayPhone</span>
          <span class="price-amount">{priceLabel}</span>
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
          PayPhone todavía no está conectado (faltan credenciales de comercio) — vuelve a intentar en
          un momento.
        </p>
      {:else}
        <p class="modal-copy">
          Vas a pagar {priceLabel} con PayPhone por tu aportación {tierName}. Se abrirá el formulario
          seguro de PayPhone — al terminar, vuelves aquí y confirmamos el pago automáticamente.
        </p>
        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}
        <div id="pp-sub-button-{tierName}" bind:this={payphoneContainer} class="payphone-widget"></div>
      {/if}
    {:else if step === "confirmed"}
      <div class="step-badge">Paso 3 de 3 · Listo</div>
      <p class="modal-copy success">¡Aportación {tierName} confirmada!</p>
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
    /* Más ancho que el resto de pasos a propósito — el formulario real de
       PayPhone (tarjeta, fecha, CVV, "De Una") se ve apretado y obliga a
       más scroll a 380px; con 440px sus propios campos entran cómodos. */
    width: min(440px, 100%);
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

  .price-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 11px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #eef4fb;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .price-amount {
    font-weight: 700;
    color: var(--accent, #21e0a0);
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

  /* Marco propio alrededor del widget — PayPhone renderiza su formulario
     en BLANCO por dentro (no se puede re-estilar: vive aislado por
     cumplimiento PCI) y quedaba flotando directo contra el fondo oscuro
     del modal, con bordes duros. Este marco redondeado y con borde suave
     hace que la transición se sienta integrada, no un recorte pegado. */
  .payphone-widget {
    min-height: 52px;
    border-radius: 16px;
    overflow: hidden;
    background: #f4f6fb;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
</style>
