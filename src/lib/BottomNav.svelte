<script lang="ts">
  // Barra de navegación inferior — el patrón estándar de iOS/Android para
  // 5-6 secciones de primer nivel, y la respuesta a varias heurísticas a
  // la vez:
  //
  // H6 (reconocer en vez de recordar): las 6 secciones SIEMPRE visibles.
  //   La tira horizontal de arriba solo mostraba 3 a la vez — las otras 3
  //   había que recordar que existían y salir a buscarlas desplazando.
  // H4 (consistencia y estándares): es donde una persona espera encontrar
  //   la navegación principal en un celular.
  // H1 (visibilidad del estado): la sección activa se ve marcada dentro
  //   del conjunto completo, no aislada sin contexto de qué más hay.
  // Ergonomía: abajo es la zona alcanzable con el pulgar; a 58px del tope
  //   de una pantalla de 812px había que recolocar la mano para navegar.
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";

  interface Props {
    categories: Category[];
    selectedIndex: number;
    onselect: (i: number) => void;
  }
  let { categories, selectedIndex, onselect }: Props = $props();
</script>

<nav class="bottom-nav" aria-label="Navegación principal">
  {#each categories as cat, i (cat.id)}
    <button
      class="nav-btn"
      class:active={i === selectedIndex}
      aria-current={i === selectedIndex ? "page" : undefined}
      onclick={() => onselect(i)}
      style="--nav-accent: {cat.theme.accent}; --nav-glow: {cat.theme.glow};"
    >
      <span class="nav-ico" aria-hidden="true"><IsoIcon kind={cat.icon} size={26} /></span>
      <span class="nav-txt">{cat.navLabel ?? cat.label}</span>
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    display: flex;
    flex-shrink: 0;
    /* safe-area: en iPhone con indicador de inicio, sin esto la última
       fila de botones queda debajo de la barra del sistema. */
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: rgba(6, 10, 18, 0.92);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    /* Sin backdrop-filter a propósito: hallazgo de rendimiento previo de
       este mismo proyecto — es caro en GPUs Android de gama baja y un
       fondo sólido se ve prácticamente igual. */
  }

  .nav-btn {
    flex: 1 1 0;
    /* min-width:0 permite que los 6 quepan repartidos sin desbordar; el
       texto se encoge con font-size, nunca se corta a mitad de palabra. */
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    /* 52px + el padding del safe-area supera el mínimo táctil de 44px
       (WCAG 2.5.5) con margen. */
    min-height: 52px;
    padding: 6px 2px 7px;
    border: none;
    background: none;
    color: rgba(238, 244, 251, 0.55);
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .nav-ico {
    display: flex;
    opacity: 0.55;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }

  .nav-txt {
    font-family: var(--font-heading, sans-serif);
    font-size: 9.5px;
    letter-spacing: 0.02em;
    line-height: 1.1;
    /* Ellipsis solo como última red: los navLabel de data.ts están
       elegidos para caber enteros a este tamaño. */
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-btn.active {
    color: var(--nav-accent);
  }
  .nav-btn.active .nav-ico {
    opacity: 1;
    transform: translateY(-1px);
    filter: drop-shadow(0 0 6px var(--nav-glow));
  }

  @media (hover: hover) and (pointer: fine) {
    .nav-btn:not(.active):hover {
      color: rgba(238, 244, 251, 0.85);
    }
    .nav-btn:not(.active):hover .nav-ico {
      opacity: 0.85;
    }
  }

  .nav-btn:active {
    transform: scale(0.94);
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-btn,
    .nav-ico {
      transition: none;
    }
  }
</style>
