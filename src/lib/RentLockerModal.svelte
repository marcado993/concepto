<script lang="ts">
  // Modal de alquiler — 3 pasos: 1) identidad (solo lectura, de la sesión)
  // 2) PayPhone (widget) 3) confirmación. PayPhone es el único método de
  // pago (transferencia + comprobante por OCR se retiró). Nunca se le pide
  // al estudiante escribir su nombre/código a mano — ya está logueado,
  // esos datos vienen de GET /auth/me (ver
  // backend/src/shared/auth/auth.controller.ts).
  import { fetchMe, rentLocker, fetchPayphoneConfig, fetchLockerPricePreview, ApiError, type MeResponse, type LockerPricePreview } from "./api";
  import { loadPayphoneSdk } from "./payphoneSdk";
  import { isAuthenticated } from "./auth.svelte";
  import Login from "./Login.svelte";
  import PayphoneLogo from "./PayphoneLogo.svelte";
  import { scale } from "svelte/transition";

  interface Props {
    lockerCode: string;
    onclose: () => void;
    onrented?: () => void;
    /** Otro estudiante ganó la carrera por este casillero (409 del
     *  backend). El padre debe recargar la grilla: sin esto el error se
     *  mostraba acá pero la grilla de atrás seguía pintando el casillero
     *  como libre, invitando a reintentar exactamente lo que acaba de
     *  fallar. */
    ontaken?: () => void;
  }

  let { lockerCode, onclose, onrented, ontaken }: Props = $props();

  type Step = "identity" | "payphone" | "confirmed";
  let step = $state<Step>("identity");

  let me = $state<MeResponse | null>(null);
  let meError = $state(false);
  // El precio (ya con el descuento de aportante resuelto por el backend) y
  // el nombre del tier — nunca le preguntamos al estudiante "¿eres
  // aportante?" ni "¿qué plan tienes?": eso ya lo sabe la app con solo su
  // sesión (backend/src/locker/locker.service.ts::getPricePreview cruza
  // con el dominio de Aportaciones). Menos preguntas, menos error posible
  // (heurística de Nielsen "prevención de errores").
  let pricePreview = $state<LockerPricePreview | null>(null);
  let pricePreviewError = $state(false);
  $effect(() => {
    if (!isAuthenticated()) return;
    fetchMe()
      .then((data) => {
        me = data;
        cedula = data.cedula ?? "";
        phone = data.phone ?? "";
        uniqueCode = data.uniqueCode ?? "";
      })
      .catch(() => (meError = true));
    fetchLockerPricePreview()
      .then((data) => (pricePreview = data))
      .catch(() => (pricePreviewError = true));
  });

  // Cédula/celular/código único — se piden UNA vez; si ya están en el
  // perfil (alquiler de un semestre anterior) llegan prellenados desde
  // /auth/me arriba, acá solo se re-confirman o se corrigen, nunca se
  // escriben desde cero de nuevo (reconocimiento sobre recuerdo).
  let cedula = $state("");
  let phone = $state("");
  // Código único institucional — dato personal REAL usado para localizar
  // físicamente al dueño de un casillero, no un identificador interno
  // nuestro. Formato real de la EPN confirmado con datos del cliente (ver
  // UNIQUE_CODE_PATTERN en backend/src/locker/dto/rent-locker.dto.ts):
  // año (empieza en 2) + periodo (1 o 2) + secuencial de 4 dígitos, ej.
  // 202120100. Mismo patrón acá para dar el error al escribir, no recién
  // al mandar el formulario — el backend lo vuelve a validar igual.
  let uniqueCode = $state("");
  const CEDULA_RE = /^\d{10}$/;
  const PHONE_RE = /^0\d{9}$/;
  const UNIQUE_CODE_RE = /^2\d{3}[12]\d{4}$/;
  const cedulaValid = $derived(CEDULA_RE.test(cedula.trim()));
  const phoneValid = $derived(PHONE_RE.test(phone.trim()));
  const uniqueCodeValid = $derived(UNIQUE_CODE_RE.test(uniqueCode.trim()));
  let acceptedTerms = $state(false);

  const identityValid = $derived(cedulaValid && phoneValid && uniqueCodeValid && acceptedTerms);

  let showLogin = $state(false);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let rentalId = $state<string | null>(null);

  const PRICE = $derived(pricePreview ? `$${pricePreview.price.PAYPHONE.toFixed(2)}` : "…");
  const PRICE_CENTS = $derived(pricePreview ? Math.round(pricePreview.price.PAYPHONE * 100) : 0);

  // El semestre que se firma sale del backend, nunca escrito a mano acá —
  // hallazgo real de auditoría: este texto decía "hasta fin del semestre
  // 2026-A" cuando el periodo activo en producción ya era 2026-B, o sea
  // que el estudiante aceptaba (y quedaba archivado en AuditLog como
  // prueba) un texto que nombraba el semestre equivocado.
  //
  // `?.period?.` con las DOS interrogaciones: durante los minutos entre el
  // despliegue del frontend (Vercel, segundos) y el del backend (Actions →
  // VPS, minutos) esta versión habla con un backend que todavía no manda
  // `period`. Con una sola interrogación esto reventaría con "cannot read
  // properties of undefined" justo en la pantalla de pago (ver el
  // comentario de LockerPricePreview.period en api.ts).
  const periodLabel = $derived(pricePreview?.period?.label ?? null);
  const periodEnds = $derived(
    pricePreview?.period
      ? new Date(pricePreview.period.endsAt).toLocaleDateString("es-EC", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null
  );

  // El alquiler queda creado (PENDING/RESERVED) de una vez — el cobro real
  // todavía no pasó, pasa en el widget del paso 2 (ver
  // backend/src/locker/locker.service.ts confirmPayphonePayment).
  async function continueFromIdentity() {
    if (!identityValid) return;
    errorMessage = null;
    busy = true;
    try {
      const rental = await rentLocker({
        lockerCode,
        uniqueCode: uniqueCode.trim(),
        cedula: cedula.trim(),
        phone: phone.trim(),
        acceptedTerms,
      });
      rentalId = rental.id;
      step = "payphone";
    } catch (err) {
      errorMessage = err instanceof ApiError ? err.message : "No se pudo iniciar el alquiler";
      // 409 = alguien más lo tomó entre que se pintó la grilla y este
      // toque (LockerUnavailableError en el backend, garantizado por la
      // restricción @@unique([lockerId, periodId]), no por el chequeo
      // optimista de status). Refrescar la grilla ES parte del mensaje de
      // error: si no, el estudiante cierra el modal, ve el mismo casillero
      // todavía en verde, y vuelve a intentar lo único que no puede salir.
      if (err instanceof ApiError && err.status === 409) ontaken?.();
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
        const amountCents = PRICE_CENTS;
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
        errorMessage = "No se pudo cargar el widget de PayPhone — intenta de nuevo en un momento.";
        payphoneWidgetStarted = false;
      });
  });

  function onScrimKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<div
  class="scrim"
  onclick={onclose}
  onkeydown={onScrimKeydown}
  role="button"
  tabindex="-1"
  aria-label="Cerrar"
>
  <div
    class="modal"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Alquilar casillero {lockerCode}"
    in:scale={{ duration: 220, start: 0.9, opacity: 0.4 }}
    out:scale={{ duration: 150, start: 0.96, opacity: 0 }}
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
      <div class="step-badge">Paso 1 de 3 · Identidad</div>

      {#if meError}
        <p class="modal-copy error">No se pudo cargar tu perfil — intenta de nuevo.</p>
      {:else if !me}
        <!-- Antes era una línea de texto suelta — en una red móvil real con
             latencia, ese instante entre tocar el casillero y ver contenido
             se sentía como que la app no había reaccionado al tap. Una caja
             con el mismo tamaño/borde que .identity-card (la que reemplaza
             al llegar los datos) hace que el "está cargando" sea imposible
             de pasar por alto, y evita que el modal salte de tamaño cuando
             el contenido real aparece. -->
        <div class="loading-box">
          <span class="loading-spinner">◎</span>
          Cargando tu perfil…
        </div>
      {:else}
        <div class="identity-card">
          <div class="identity-row"><span>Nombre</span><strong>{me.fullName}</strong></div>
          <div class="identity-row"><span>Código</span><strong>{me.uniqueCode}</strong></div>
        </div>

        {#if pricePreview?.tierName}
          <p class="tier-banner">✓ Aportante Plan {pricePreview.tierName} — descuento ya aplicado abajo</p>
        {/if}

        <label class="field-label" for="rl-unique-code">Código único institucional</label>
        <input
          id="rl-unique-code"
          class="field-input"
          class:invalid={uniqueCode.length > 0 && !uniqueCodeValid}
          type="text"
          inputmode="numeric"
          placeholder="Ej. 202120100"
          bind:value={uniqueCode}
        />
        {#if uniqueCode.length > 0 && !uniqueCodeValid}
          <p class="field-hint error">9 dígitos: año + periodo (1 o 2) + secuencial — ej. 202120100</p>
        {/if}

        <label class="field-label" for="rl-cedula">Cédula</label>
        <input
          id="rl-cedula"
          class="field-input"
          class:invalid={cedula.length > 0 && !cedulaValid}
          type="text"
          inputmode="numeric"
          maxlength="10"
          placeholder="10 dígitos"
          bind:value={cedula}
        />

        <label class="field-label" for="rl-phone">Celular</label>
        <input
          id="rl-phone"
          class="field-input"
          class:invalid={phone.length > 0 && !phoneValid}
          type="text"
          inputmode="numeric"
          maxlength="10"
          placeholder="0991234567"
          bind:value={phone}
        />

        <div class="price-row">
          <span class="price-label">
            Pago con <PayphoneLogo height={13} />
            {#if periodLabel}
              <!-- Un monto sin unidad de tiempo no se puede evaluar: "$6.50"
                   a secas no dice si es por mes, por semestre o por día. -->
              <span class="price-period">semestre {periodLabel}</span>
            {/if}
          </span>
          <span class="price-amount">{PRICE}</span>
        </div>
        {#if pricePreviewError}
          <p class="modal-copy error">No se pudo calcular tu precio — intenta de nuevo.</p>
        {/if}

        <label class="terms-row">
          <input type="checkbox" bind:checked={acceptedTerms} />
          <span>
            {#if periodLabel && periodEnds}
              Acepto usar el casillero durante el semestre {periodLabel} (hasta el {periodEnds}) y cuidarlo.
            {:else}
              Acepto usar el casillero durante el semestre vigente y cuidarlo.
            {/if}
            <em>Esto queda firmado digitalmente con tu identidad, fecha y hora.</em>
          </span>
        </label>

        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}

        <button class="cta" disabled={busy || !identityValid} onclick={continueFromIdentity}>
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
        <p class="modal-copy loading-row"><span class="loading-spinner">◎</span> Cargando PayPhone…</p>
      {:else if !payphoneConfig.configured}
        <p class="modal-copy error">
          PayPhone todavía no está conectado (faltan credenciales de comercio) — vuelve a intentar en
          un momento.
        </p>
      {:else}
        <div class="payphone-brand">
          <PayphoneLogo height={20} />
        </div>
        <p class="modal-copy">
          Vas a pagar {PRICE} con PayPhone por el casillero {lockerCode}. Se abrirá el formulario
          seguro de PayPhone — al terminar, vuelves aquí y confirmamos el pago automáticamente.
        </p>
        {#if errorMessage}<p class="modal-copy error">{errorMessage}</p>{/if}
        <div id="pp-button-{lockerCode}" bind:this={payphoneContainer} class="payphone-widget"></div>
      {/if}
    {:else if step === "confirmed"}
      <div class="step-badge">Paso 3 de 3 · Listo</div>
      <p class="modal-copy success">¡Casillero {lockerCode} confirmado!</p>
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

  /* backdrop-filter obliga al navegador a difuminar en tiempo real todo lo
     que queda detrás — acá, la grilla completa de hasta 108 casilleros con
     sus propios drop-shadow, en el tap más común de la categoría (abrir
     este modal). Es de las propiedades CSS más caras en GPUs Android de
     gama baja; en mobile un scrim sólido más opaco se ve casi igual sin
     ese costo (auditoría de rendimiento móvil). Desktop mantiene el blur. */
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
       más scroll a 380px; con 440px sus propios campos entran cómodos y
       la vista previa (identidad, precio) sigue leyéndose igual de bien. */
    width: min(440px, 100%);
    max-height: 86vh;
    overflow-y: auto;
    background: linear-gradient(180deg, rgba(20, 26, 40, 0.96), rgba(6, 9, 16, 0.98));
    border: 1px solid var(--line-strong, rgba(120, 200, 255, 0.16));
    border-radius: 20px;
    padding: 22px 20px 20px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  }

  /* El "pop" de entrada (in:scale en el markup) ya avisa que el tap
     registró — pero mientras /auth/me y el precio siguen en vuelo, un
     texto estático ("Cargando…") no se distingue de la app trabada. Un
     spinner girando (mismo lenguaje visual que .sec-map-icon.spin en
     CategoryContent.svelte) deja claro que sigue vivo. */
  .loading-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Mismo tamaño/borde que .identity-card (lo que la reemplaza al llegar
     los datos) — para que el modal no salte de alto y el estado de carga
     se lea como una caja real, no como una línea de texto que se puede
     pasar por alto. */
  .loading-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 64px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 14px;
    color: var(--ink-1, #9db0d1);
    font-size: 13px;
  }

  .loading-box .loading-spinner {
    font-size: 18px;
  }

  .loading-spinner {
    display: inline-block;
    font-size: 15px;
    line-height: 1;
    animation: rl-spin 1.1s linear infinite;
  }

  @keyframes rl-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Grande a propósito (44px, min de objetivo táctil WCAG 2.5.5) —
     feedback real de usabilidad: "para cerrar pon una X grande". Salir de
     un flujo tiene que ser al menos tan fácil de tocar como entrar. */
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

  .tier-banner {
    font-size: 12px;
    line-height: 1.5;
    color: var(--accent, #21e0a0);
    background: rgba(33, 224, 160, 0.1);
    border: 1px solid rgba(33, 224, 160, 0.3);
    border-radius: 10px;
    padding: 8px 12px;
    margin: -4px 0 14px;
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
    padding: 10px 13px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 13.5px;
    margin-bottom: 12px;
  }
  .field-input:focus {
    outline: none;
    border-color: var(--accent, #21e0a0);
  }
  .field-input.invalid {
    border-color: #ff8a8a;
  }

  .field-hint {
    margin: -8px 0 12px;
    font-size: 11px;
    line-height: 1.4;
  }
  .field-hint.error {
    color: #ff8a8a;
  }

  /* El checkbox nativo se veía gris y plano en Windows/Chrome —
     `accent-color` solo tiñe la palomita, no da ningún contraste real
     entre "aceptado" y "sin aceptar", que es justo la distinción que más
     importa acá: es la casilla que hace de firma del contrato. Ahora la
     fila entera cambia de estado, no solo un cuadrito de 13px. */
  .terms-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 12px;
    line-height: 1.4;
    color: rgba(238, 244, 251, 0.75);
    margin: 4px 0 16px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }
  .terms-row:has(input:checked) {
    border-color: var(--accent, #21e0a0);
    background: color-mix(in srgb, var(--accent, #21e0a0) 10%, transparent);
    color: #eef4fb;
  }

  .terms-row input {
    appearance: none;
    -webkit-appearance: none;
    flex-shrink: 0;
    /* 20px, no los ~13px del nativo: es el control que confirma un cobro
       real, y a 13px es tanto difícil de acertar con el dedo como difícil
       de leer si quedó marcado o no. */
    width: 20px;
    height: 20px;
    margin: 0;
    border-radius: 6px;
    border: 2px solid rgba(238, 244, 251, 0.45);
    background: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    display: grid;
    place-content: center;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  /* Palomita dibujada con clip-path (no un carácter de texto): así el
     check queda del color del FONDO OSCURO sobre el relleno de acento —
     el contraste más alto posible, en vez de un tilde claro sobre claro. */
  .terms-row input::before {
    content: "";
    width: 11px;
    height: 11px;
    transform: scale(0);
    transition: transform 0.12s cubic-bezier(0.3, 1.4, 0.6, 1);
    background: #04150d;
    clip-path: polygon(14% 46%, 0 60%, 39% 100%, 100% 22%, 85% 8%, 39% 71%);
  }
  .terms-row input:checked {
    background: var(--accent, #21e0a0);
    border-color: var(--accent, #21e0a0);
  }
  .terms-row input:checked::before {
    transform: scale(1);
  }
  /* Foco visible para quien navega con teclado — el outline por defecto
     desaparece al quitar la apariencia nativa. */
  .terms-row input:focus-visible {
    outline: 2px solid var(--accent, #21e0a0);
    outline-offset: 2px;
  }
  .terms-row em {
    display: block;
    font-style: normal;
    font-size: 10.5px;
    color: rgba(238, 244, 251, 0.5);
    margin-top: 3px;
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
  .price-label {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .price-period {
    color: rgba(238, 244, 251, 0.6);
    font-size: 11.5px;
  }
  .price-label :global(svg) {
    color: #eef4fb;
    opacity: 0.9;
  }
  .price-amount {
    font-weight: 700;
    color: var(--accent, #21e0a0);
  }

  /* Logo real de PayPhone antes de abrir su widget — confirma de un
     vistazo con QUIÉN se está por pagar, antes de que aparezca el
     formulario blanco aislado por PCI (ver comentario de .payphone-widget
     más abajo). */
  .payphone-brand {
    display: flex;
    justify-content: center;
    margin-bottom: 10px;
    color: #eef4fb;
    opacity: 0.92;
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
     del modal, con bordes duros. Este marco con esquinas redondeadas y un
     borde suave hace que la transición se sienta integrada en vez de un
     recorte pegado encima. */
  .payphone-widget {
    min-height: 52px;
    border-radius: 16px;
    overflow: hidden;
    background: #f4f6fb;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
</style>
