<script lang="ts">
  // Pestañas de categoría DENTRO del sheet — lo que convierte "cerrar y
  // luego elegir" (dos toques) en "elegir" (uno).
  //
  // Antes esto reusaba DesktopNav en horizontal, pero a 375px de ancho sus
  // ítems con ícono + etiqueta se apretaban hasta cortar el texto
  // ("Emprendimiento…") y los íconos a 34px no se distinguían entre sí —
  // ruido visual, no ayuda al reconocimiento. Acá el texto manda:
  //
  // - Reconocer en vez de recordar: la etiqueta completa siempre legible,
  //   nunca truncada.
  // - Estado del sistema visible: la activa se ve rellena con el acento de
  //   SU categoría, no solo un borde sutil.
  // - El ícono grande ya vive en el header del sheet justo abajo —
  //   repetirlo acá era información duplicada ocupando alto en pantalla.
  // - Se avisa que hay más: degradados a los costados solo cuando de
  //   verdad queda contenido por desplazar hacia ese lado.
  import type { Category } from "./data";

  interface Props {
    categories: Category[];
    selectedIndex: number;
    onselect: (i: number) => void;
  }
  let { categories, selectedIndex, onselect }: Props = $props();

  let strip = $state<HTMLDivElement | null>(null);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function updateScrollHints() {
    if (!strip) return;
    canScrollLeft = strip.scrollLeft > 4;
    canScrollRight = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4;
  }

  // La activa siempre visible: si el usuario abre una categoría que quedó
  // fuera del área visible de la tira (ej. Seguridad, la última), sin esto
  // la tira parecería no haber reaccionado al cambio.
  $effect(() => {
    const el = strip?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`);
    if (!el || !strip) return;

    // Solo desplazar si de verdad quedó (aunque sea parcialmente) fuera de
    // vista. Llamar a scrollIntoView incondicionalmente desplazaba ~14px
    // incluso con la pestaña ya visible — alinea contra el borde del
    // contenedor ignorando su padding, lo que pegaba la primera pestaña al
    // filo y encendía el degradado izquierdo estando al principio de todo.
    const stripBox = strip.getBoundingClientRect();
    const elBox = el.getBoundingClientRect();
    const MARGIN = 14; // que no quede pegada al filo, mismo aire que el padding
    if (elBox.left < stripBox.left) {
      strip.scrollTo({ left: strip.scrollLeft - (stripBox.left - elBox.left) - MARGIN, behavior: "smooth" });
    } else if (elBox.right > stripBox.right) {
      strip.scrollTo({ left: strip.scrollLeft + (elBox.right - stripBox.right) + MARGIN, behavior: "smooth" });
    }
    // requestAnimationFrame: scrollIntoView es asíncrono, leer los hints
    // en el mismo tick daría los valores de ANTES del desplazamiento.
    requestAnimationFrame(updateScrollHints);
  });
</script>

<div class="tabs-wrap" class:fade-left={canScrollLeft} class:fade-right={canScrollRight}>
  <div
    class="tabs"
    role="tablist"
    aria-label="Cambiar de categoría"
    bind:this={strip}
    onscroll={updateScrollHints}
  >
    {#each categories as cat, i (cat.id)}
      <button
        class="tab"
        class:active={i === selectedIndex}
        data-idx={i}
        role="tab"
        aria-selected={i === selectedIndex}
        onclick={() => onselect(i)}
        style="--tab-accent: {cat.theme.accent}; --tab-glow: {cat.theme.glow};"
      >
        {cat.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .tabs-wrap {
    position: relative;
    flex-shrink: 0;
    /* Deja libre la esquina donde flota la X de cerrar. */
    padding: 0 52px 8px 0;
  }

  .tabs {
    display: flex;
    gap: 8px;
    padding: 2px 14px 4px;
    overflow-x: auto;
    /* SIN scroll-snap a propósito: peleaba con el desplazamiento
       automático de la pestaña activa. Alineaba contra el borde del
       contenedor ignorando su padding (la tira se auto-corría 14px al
       abrir y encendía el degradado izquierdo estando al principio), y
       en la última pestaña se detenía en un punto de anclaje que la
       dejaba cortada. Con pastillas tan chicas el snap aporta poco y
       costaba dos bugs; el scroll se calcula a mano en el $effect. */
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    flex: 0 0 auto;
    /* 44px de alto = mínimo de objetivo táctil (WCAG 2.5.5), mismo
       criterio que las X de los modales. */
    min-height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(238, 244, 251, 0.72);
    font-family: var(--font-heading, sans-serif);
    font-size: 12.5px;
    letter-spacing: 0.03em;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.18s ease,
      color 0.18s ease,
      border-color 0.18s ease;
  }

  /* La activa se rellena con el acento de SU propia categoría — el color
     se vuelve parte de la respuesta ("estás en Casilleros"), no decoración. */
  .tab.active {
    background: var(--tab-accent);
    border-color: var(--tab-accent);
    color: #07130f;
    font-weight: 700;
    box-shadow: 0 0 14px var(--tab-glow);
  }

  /* Gateado a (hover: hover) — en touch un :hover suelto hace que el
     primer tap se gaste "simulando" el estado y haga falta un segundo,
     que es justo el bug que estas pestañas vienen a resolver. */
  @media (hover: hover) and (pointer: fine) {
    .tab:not(.active):hover {
      background: rgba(255, 255, 255, 0.1);
      color: #eef4fb;
    }
  }

  .tab:active {
    transform: scale(0.96);
  }

  /* Señal de que hay más categorías hacia ese lado — aparece solo cuando
     de verdad queda algo por desplazar (ver canScrollLeft/Right). */
  .tabs-wrap::before,
  .tabs-wrap::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 8px;
    width: 28px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .tabs-wrap::before {
    left: 0;
    background: linear-gradient(90deg, var(--sheet-dim, #0b1220), transparent);
  }
  .tabs-wrap::after {
    right: 52px;
    background: linear-gradient(270deg, var(--sheet-dim, #0b1220), transparent);
  }
  .tabs-wrap.fade-left::before,
  .tabs-wrap.fade-right::after {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
  }
</style>
