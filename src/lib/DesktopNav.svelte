<script lang="ts">
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";

  interface Props {
    categories: Category[];
    selectedIndex: number;
    onselect: (i: number) => void;
    vertical?: boolean;
  }

  let { categories, selectedIndex, onselect, vertical = false }: Props = $props();
</script>

<nav class="desktop-nav" class:vertical aria-label="Selector de categorías">
  {#each categories as cat, i (cat.id)}
    <button
      class="nav-item"
      class:active={i === selectedIndex}
      onclick={() => onselect(i)}
      style="--nav-accent: {cat.theme.accent}; --nav-glow: {cat.theme.glow};"
    >
      <span class="nav-icon"><IsoIcon kind={cat.icon} size={34} /></span>
      <span class="nav-label">{cat.label}</span>
    </button>
  {/each}
</nav>

<style>
  .desktop-nav {
    display: flex;
    gap: 8px;
    padding: 4px 20px 14px;
    overflow-x: auto;
    flex-shrink: 0;
  }

  /* Sidebar form for the full-screen desktop layout: a vertical rail of
     left-aligned rows reads as real navigation, where the horizontal
     row was really just a tab strip for the narrow card. */
  .desktop-nav.vertical {
    flex-direction: column;
    padding: 0;
    overflow-x: visible;
    gap: 6px;
  }

  .desktop-nav.vertical .nav-item {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 12px 16px;
    width: 100%;
  }

  .desktop-nav.vertical .nav-label {
    font-size: 13px;
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 14px 8px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line-strong);
    cursor: pointer;
    flex: 1 1 0;
    min-width: 64px;
    transition: background 0.25s ease, border-color 0.25s ease, transform 0.15s ease;
  }

  .nav-item:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.07);
  }

  .nav-item.active {
    background: color-mix(in srgb, var(--nav-accent) 14%, transparent);
    border-color: var(--nav-accent);
    box-shadow: 0 0 16px var(--nav-glow);
  }

  .nav-icon {
    display: flex;
    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.5));
  }

  .nav-item.active .nav-icon {
    filter: drop-shadow(0 0 8px var(--nav-glow));
  }

  .nav-label {
    font-family: var(--font-heading);
    font-size: 10.5px;
    font-weight: 600;
    /* Más espaciado que el resto de títulos — Anton a este tamaño (10.5px)
       es donde más se aprieta, así que necesita el empujón extra para
       seguir siendo legible. */
    letter-spacing: 0.06em;
    color: var(--ink-1);
  }

  .nav-item.active .nav-label {
    color: var(--ink-0);
  }
</style>
