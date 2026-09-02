<script lang="ts">
  // Reemplaza el toast/banner que se mostraba tras volver de PayPhone
  // (pedido real: "sale un toast pero es mejor un modal") — mismo patrón
  // de modal ya establecido en MyLockerStatusModal.svelte (scrim + tarjeta
  // + insignia circular), con el check dibujándose solo, igual que la
  // animación de "código enviado" de Login.svelte (mismo lenguaje visual
  // en toda la app: algo importante acaba de pasar, se dibuja, no aparece
  // de golpe).
  import TypeText from "./TypeText.svelte";

  import { portal } from "./portal";
  interface Props {
    ok: boolean;
    text: string;
    onclose: () => void;
  }

  let { ok, text, onclose }: Props = $props();

  // Arranca justo cuando el check/x termina de dibujarse (badge-pop 0.4s +
  // el trazo del ícono, ver CSS abajo) — se siente como una secuencia, no
  // como dos animaciones sueltas compitiendo.
  const titleText = $derived(ok ? "¡Pago confirmado!" : "No se pudo confirmar el pago");

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
    aria-label={ok ? "Pago confirmado" : "No se pudo confirmar el pago"}
  >
    <button class="close" onclick={onclose} aria-label="Cerrar">×</button>

    <span class="badge" class:error={!ok} aria-hidden="true">
      {#if ok}
        <svg class="check-icon" viewBox="0 0 24 24" fill="none">
          <path class="check-path" d="m4.5 12.5 5.2 5.2L19.5 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        <svg class="x-icon" viewBox="0 0 24 24" fill="none">
          <path class="x-path-1" d="M6 6 18 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
          <path class="x-path-2" d="M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
        </svg>
      {/if}
    </span>

    <TypeText tag="h3" class="modal-title" text={titleText} speed={26} startDelay={480} />
    <p class="modal-copy">{text}</p>
    <button class="cta" class:error={!ok} onclick={onclose}>Entendido</button>
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
    text-align: center;
  }

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

  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent, #21e0a0);
    color: #0a1a12;
    margin: 4px auto 14px;
    box-shadow: 0 0 24px var(--accent-glow, rgba(33, 224, 160, 0.45));
    animation: badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  }

  .badge.error {
    background: #ef4444;
    color: #2a0a0a;
    box-shadow: 0 0 24px rgba(239, 68, 68, 0.45);
  }

  .check-icon,
  .x-icon {
    width: 30px;
    height: 30px;
  }

  /* El check se DIBUJA (stroke-dasharray/dashoffset), no aparece de golpe
     — misma técnica que .send-check-path en Login.svelte, para que el
     lenguaje visual de "algo se confirmó" se sienta igual en toda la app. */
  .check-path {
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: draw 0.4s ease-out 0.15s forwards;
  }

  .x-path-1,
  .x-path-2 {
    stroke-dasharray: 17;
    stroke-dashoffset: 17;
    animation: draw 0.28s ease-out 0.15s forwards;
  }
  .x-path-2 {
    animation-delay: 0.32s;
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes badge-pop {
    from {
      transform: scale(0.6);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* :global() a propósito — TypeText.svelte renderiza este h3 (efecto de
     máquina de escribir en el título), no el template de este componente
     directamente; sin :global() el hash de scoped-CSS de Svelte nunca
     matchea (mismo hallazgo real que .venture-name en CommunitySection y
     .login-title en Login.svelte). */
  :global(.modal-title) {
    font-family: var(--font-heading, sans-serif);
    font-size: 18px;
    letter-spacing: 0.02em;
    margin: 0 0 4px;
    color: #eef4fb;
  }

  .modal-copy {
    font-size: 13.5px;
    line-height: 1.5;
    color: rgba(238, 244, 251, 0.82);
    margin: 0 0 18px;
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

  .cta.error {
    background: #ef4444;
    color: #2a0a0a;
  }

  @media (hover: hover) and (pointer: fine) {
    .cta:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .badge {
      animation: none;
    }
    .check-path,
    .x-path-1,
    .x-path-2 {
      stroke-dashoffset: 0;
      animation: none;
    }
  }
</style>
