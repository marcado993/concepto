<script lang="ts">
  // Variante B del test A/B de navegación — pedido real del cliente tras
  // feedback de "no es usable" sobre la rueda (ArcMenu). Sin gesto de
  // arrastre, sin tener que "descubrir" que el disco gira: una lista de
  // botones reales, con foco de teclado y texto visible en cada uno.
  // Tocar una categoría la selecciona Y la abre en el mismo gesto — la
  // rueda necesitaba dos pasos (girar, luego deslizar arriba/tocar el
  // pill); acá ese segundo paso desaparece.
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";

  interface Props {
    categories: Category[];
    selectedIndex: number;
    onopen: (i: number) => void;
  }

  let { categories, selectedIndex, onopen }: Props = $props();
</script>

<nav class="accessible-nav" aria-label="Selector de categorías">
  <ul class="accessible-list">
    {#each categories as cat, i (cat.id)}
      <li>
        <button
          class="accessible-item"
          aria-current={i === selectedIndex ? "true" : undefined}
          onclick={() => onopen(i)}
          style="--item-accent: {cat.theme.accent}; --item-glow: {cat.theme.glow};"
        >
          <!-- aria-hidden — IsoIcon trae su propio alt (ej. "Casilleros")
               que, sin esto, se suma al texto visible del botón y un
               lector de pantalla termina anunciando "Casilleros
               Casilleros". El texto real ya está en .accessible-label. -->
          <span class="accessible-icon" aria-hidden="true"><IsoIcon kind={cat.icon} size={44} /></span>
          <span class="accessible-text">
            <span class="accessible-label">{cat.label}</span>
            <span class="accessible-desc">{cat.prompt}</span>
          </span>
          <span class="accessible-chevron" aria-hidden="true">›</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .accessible-nav {
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 20px 24px;
  }

  .accessible-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Objetivo táctil generoso (min ~64px de alto) — el criterio de tamaño
     de objetivo de WCAG 2.5.5 pide al menos 44×44px; esto le da bastante
     más margen a propósito, ya que "difícil de tocar bien" fue parte del
     feedback real sobre la rueda. */
  .accessible-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 64px;
    padding: 12px 16px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line-strong, rgba(255, 255, 255, 0.12));
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
  }

  /* Gateado a (hover: hover) — mismo hallazgo real que .unit:hover en
     CategoryContent.svelte: un :hover sin esto hace que iOS interprete el
     PRIMER tap como "simular hover" y recién el SEGUNDO tap como el click
     real — "estoy haciendo dos clicks para cambiar" (reporte real). En
     touch nunca debería existir un estado :hover que haya que "confirmar"
     con un segundo toque. */
  @media (hover: hover) and (pointer: fine) {
    .accessible-item:hover {
      background: rgba(255, 255, 255, 0.07);
    }
  }

  .accessible-item:active {
    transform: scale(0.98);
  }

  /* :focus-visible, no :focus — el resalte de teclado no debe aparecer en
     cada tap táctil (eso sí sería ruido visual), solo quien navega con
     Tab/teclado o lector de pantalla necesita verlo. */
  .accessible-item:focus-visible {
    outline: 2px solid var(--item-accent);
    outline-offset: 2px;
  }

  .accessible-item[aria-current="true"] {
    background: color-mix(in srgb, var(--item-accent) 14%, transparent);
    border-color: var(--item-accent);
    box-shadow: 0 0 16px var(--item-glow);
  }

  .accessible-icon {
    flex: 0 0 auto;
    display: flex;
    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.5));
  }

  .accessible-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .accessible-label {
    font-family: var(--font-heading);
    font-size: 16px;
    letter-spacing: 0.03em;
    color: var(--ink-0, #eef4fb);
  }

  .accessible-desc {
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--ink-1, #9db0d1);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .accessible-chevron {
    flex: 0 0 auto;
    font-size: 20px;
    color: var(--ink-1, #9db0d1);
  }

  @media (prefers-reduced-motion: reduce) {
    .accessible-item {
      transition: none;
    }
  }
</style>
