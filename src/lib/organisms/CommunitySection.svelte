<script lang="ts">
  import type { Category } from "../data";

  // Un tono por categoría de emprendimiento, no una paleta fija — el
  // estudiante puede escribir cualquier texto en "categoría", así que un
  // mapa hardcodeado ("Alimentos" → naranja) se rompería con la primera
  // categoría nueva. Un hash determinístico da el mismo color siempre
  // para la misma palabra, sin mantenimiento (efecto Von Restorff).
  function categoryHue(cat: string): number {
    let hash = 0;
    for (let i = 0; i < cat.length; i++) {
      hash = (hash * 31 + cat.charCodeAt(i)) % 360;
    }
    return hash;
  }

  function initials(name: string) {
    return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }

  interface Props {
    category: Category;
    venturesError?: boolean;
  }
  let { category, venturesError = false }: Props = $props();
</script>

<!-- "Comunidad" reemplazado por Emprendimientos — vitrina + contacto
     WhatsApp. El id interno se queda como "community" a propósito:
     renombrarlo tocaría IconKind/ArcMenu/IsoIcon sin necesidad real. -->
<div class="news-list venture-grid">
  {#if category.ventures}
    {#each category.ventures as v, i (v.id)}
      <article class="venture-card list-in" style="--v-hue: {categoryHue(v.category)}; --li: {i}">
        <div class="venture-media">
          {#if v.photoUrl}
            <img src={v.photoUrl} alt={v.name} loading="lazy" />
          {:else}
            <div class="venture-media-fallback">{initials(v.name)}</div>
          {/if}
          <span class="venture-badge">{v.category}</span>
        </div>
        <div class="venture-body">
          <h3 class="venture-name">{v.name}</h3>
          <p class="venture-desc">{v.description}</p>
          <a class="venture-cta" href={v.whatsappLink} target="_blank" rel="noreferrer">
            <svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.06-1.36A10 10 0 1 0 12 2Zm0 18.2a8.15 8.15 0 0 1-4.16-1.14l-.3-.18-3 .8.8-2.93-.2-.31A8.2 8.2 0 1 1 12 20.2Zm4.5-6.13c-.24-.12-1.44-.71-1.66-.8-.22-.08-.38-.12-.55.12-.16.24-.63.8-.77.96-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.42-1.33-1.66-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z"
              />
            </svg>
            Escribir por WhatsApp
          </a>
        </div>
      </article>
    {/each}
    {#if category.ventures.length === 0}
      <p class="sec-note">Todavía no hay emprendimientos aprobados en el directorio.</p>
    {/if}
  {:else if venturesError}
    <p class="sec-note">No se pudo cargar el directorio de emprendimientos.</p>
  {:else}
    <p class="sec-note">Cargando emprendimientos…</p>
  {/if}
</div>
