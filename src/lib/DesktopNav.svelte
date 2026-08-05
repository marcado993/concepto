<script lang="ts">
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";

  interface Props {
    categories: Category[];
    selectedIndex: number;
    onselect: (i: number) => void;
  }

  let { categories, selectedIndex, onselect }: Props = $props();
</script>

<nav class="desktop-nav" aria-label="Selector de categorías">
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
    font-family: var(--font-display);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--ink-1);
  }

  .nav-item.active .nav-label {
    color: var(--ink-0);
  }
</style>
