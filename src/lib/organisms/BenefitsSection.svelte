<script lang="ts">
  import type { Category } from "../data";

  // Los iconos de recurso son inline SVG a propósito — mismo patrón que
  // IsoIcon.svelte. currentColor toma el acento de la categoría activa.
  interface RepoIcon {
    paths: string[];
    dots: [number, number][];
  }
  const RESOURCE_ICONS: Record<string, RepoIcon> = {
    Hardware: {
      paths: ["M6 6h8v8H6z", "M8 6V3.3M12 6V3.3M8 16.7V14M12 16.7V14M6 8H3.3M6 12H3.3M14 8h2.7M14 12h2.7"],
      dots: [],
    },
    Infraestructura: {
      paths: ["M3.5 3.3h13v4h-13z", "M3.5 8h13v4h-13z", "M3.5 12.7h13v4h-13z"],
      dots: [[6.1, 5.3], [6.1, 10], [6.1, 14.7]],
    },
    Electrónica: {
      paths: ["M7.5 7.5h5v5h-5z", "M10 7.5V4.6M10 15.4v-2.9M7.5 10H4.6M15.4 10h-2.9"],
      dots: [[10, 3.6], [10, 16.4], [3.6, 10], [16.4, 10]],
    },
    Material: {
      paths: [
        "M10 6c-1.3-1.1-3.4-1.6-5.6-1.6-.6 0-1.1.5-1.1 1.1v8.8c0 .6.5 1 1.1 1 2.2 0 4.3.5 5.6 1.6m0-10.9c1.3-1.1 3.4-1.6 5.6-1.6.6 0 1.1.5 1.1 1.1v8.8c0 .6-.5 1-1.1 1-2.2 0-4.3.5-5.6 1.6m0-10.9v10.9",
      ],
      dots: [],
    },
  };
  // Cualquier tag sin ícono asignado cae al de Material — mismo criterio
  // que statusLabel para un LockerStatus inesperado, en vez de romper.
  function resourceIcon(tag: string): RepoIcon {
    return RESOURCE_ICONS[tag] ?? RESOURCE_ICONS.Material;
  }

  interface Props {
    category: Category;
  }
  let { category }: Props = $props();
</script>

{#if category.resources}
  <div class="repo-list">
    {#each category.resources as r, i (r.id)}
      <!-- {@const} tiene que ser hijo INMEDIATO del {#each}, no ir
           metido más abajo dentro del marcado. -->
      {@const total = r.stat1 + r.stat2}
      {@const pct = total > 0 ? Math.round((r.stat1 / total) * 100) : 0}
      {@const icon = resourceIcon(r.tag)}
      <div class="repo-card list-in" style="--li: {i}">
        <div class="repo-head">
          <span class="repo-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
              {#each icon.paths as d}<path {d} />{/each}
              {#each icon.dots as [cx, cy]}<circle {cx} {cy} r="0.7" fill="currentColor" stroke="none" />{/each}
            </svg>
          </span>
          <h3 class="repo-name">{r.name}</h3>
        </div>
        <p class="repo-desc">{r.description}</p>
        <!-- Barra de ocupación: los dos números sueltos obligaban a hacer
             la cuenta mental de cuánto queda. La proporción se lee de un
             vistazo. -->
        <div
          class="repo-gauge"
          role="img"
          aria-label="{r.stat1} de {total} {r.stat1Label.toLowerCase()}"
        >
          <span class="repo-gauge-fill" style="--pct: {pct}%"></span>
        </div>
        <div class="repo-foot">
          <span class="repo-tag">{r.tag}</span>
          <span class="repo-stat repo-stat-strong">{r.stat1} {r.stat1Label.toLowerCase()}</span>
          <span class="repo-stat">{r.stat2} {r.stat2Label.toLowerCase()}</span>
          <span class="repo-updated">{r.updated}</span>
        </div>
      </div>
    {/each}
  </div>
{/if}
