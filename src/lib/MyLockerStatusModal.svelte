<script lang="ts">
  // Vista de solo lectura para "ya tengo un casillero" — pedido real: en
  // vez de que el estudiante busque el suyo entre hasta 108, la grilla lo
  // distingue y lo deja tocar para ver esto directamente. A diferencia de
  // RentLockerModal, acá no hay ningún paso: no hay nada que alquilar ni
  // confirmar, solo mostrar lo que ya es tuyo.
  interface Props {
    lockerCode: string;
    zone: string;
    onclose: () => void;
  }

  let { lockerCode, zone, onclose }: Props = $props();

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
    aria-label="Estado de tu casillero {lockerCode}"
  >
    <button class="close" onclick={onclose} aria-label="Cerrar">×</button>
    <span class="check-badge" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path fill="currentColor" d="m9.55 17.55-5.7-5.7 1.425-1.425L9.55 14.7l9.175-9.175L20.15 6.95Z" />
      </svg>
    </span>
    <h3 class="modal-title">Casillero {lockerCode}</h3>
    <p class="modal-copy">Ya tienes este casillero confirmado para el periodo actual.</p>
    <div class="info-card">
      <div class="info-row"><span>Casillero</span><strong>{lockerCode}</strong></div>
      <div class="info-row"><span>Zona</span><strong>{zone}</strong></div>
    </div>
    <button class="cta" onclick={onclose}>Cerrar</button>
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

  /* Grande a propósito (44px, min de objetivo táctil WCAG 2.5.5) — mismo
     feedback real que RentLockerModal/SubscribeModal: "para cerrar pon
     una X grande". */
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

  .check-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent, #21e0a0);
    color: #0a1a12;
    margin: 4px auto 14px;
  }
  .check-badge svg {
    width: 26px;
    height: 26px;
  }

  .modal-title {
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
    margin: 0 0 14px;
  }

  .info-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 16px;
    text-align: left;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 12.5px;
    padding: 4px 0;
    color: rgba(238, 244, 251, 0.7);
  }
  .info-row strong {
    color: #eef4fb;
    text-align: right;
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
  .cta:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
</style>
