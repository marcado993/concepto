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

<style>
  .news-list {
    padding: 8px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .venture-grid {
    padding: 8px 16px 40px;
  }

  :global(.content-wrap.wide) .news-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
    padding: 20px 28px 40px;
  }

  .venture-card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md, 18px);
    overflow: hidden;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
    transition:
      transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 0.22s ease,
      box-shadow 0.22s ease;
  }

  .venture-card:focus-within {
    transform: translateY(-4px);
    border-color: hsl(var(--v-hue) 85% 65% / 0.55);
    box-shadow:
      0 14px 28px -12px hsl(var(--v-hue) 85% 55% / 0.35),
      0 1px 0 rgba(255, 255, 255, 0.06) inset;
  }

  @media (hover: hover) and (pointer: fine) {
    .venture-card:hover {
      transform: translateY(-4px);
      border-color: hsl(var(--v-hue) 85% 65% / 0.55);
      box-shadow:
        0 14px 28px -12px hsl(var(--v-hue) 85% 55% / 0.35),
        0 1px 0 rgba(255, 255, 255, 0.06) inset;
    }
  }

  .venture-media {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
  }

  .venture-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @media (hover: hover) and (pointer: fine) {
    .venture-card:hover .venture-media img {
      transform: scale(1.06);
    }
  }

  .venture-media::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(4, 6, 13, 0) 55%, rgba(4, 6, 13, 0.75) 100%);
    pointer-events: none;
  }

  .venture-media-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-heading);
    font-size: 28px;
    letter-spacing: 0.08em;
    color: hsl(var(--v-hue) 85% 72%);
    background: hsl(var(--v-hue) 60% 18%);
  }

  .venture-badge {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 1;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    color: hsl(var(--v-hue) 40% 12%);
    background: hsl(var(--v-hue) 85% 68%);
    box-shadow: 0 2px 10px hsl(var(--v-hue) 85% 45% / 0.5);
  }

  .venture-body {
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .venture-name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: 600;
    font-size: 16px;
    line-height: 1.25;
    color: #f4f9ff;
  }

  .venture-desc {
    margin: 0 0 6px;
    font-size: 12.5px;
    line-height: 1.55;
    color: rgba(234, 255, 245, 0.68);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .venture-cta {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 12px;
    border-radius: 999px;
    background: #25d366;
    color: #04150d;
    font-size: 12.5px;
    font-weight: 700;
    text-decoration: none;
    transition:
      filter 0.15s ease,
      transform 0.15s ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .venture-cta:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
  }
  .venture-cta:active {
    transform: translateY(0);
    filter: brightness(0.96);
  }

  .wa-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .sec-note {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.4);
    margin-top: 2px;
  }

  .list-in {
    opacity: 0;
    animation: list-materialize 0.44s cubic-bezier(0.18, 0.9, 0.24, 1.06) forwards;
    animation-delay: calc(var(--li, 0) * 45ms);
  }

  @keyframes list-materialize {
    0% {
      opacity: 0;
      transform: translateY(12px) scale(0.97);
      filter: brightness(0.55);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: brightness(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .list-in {
      opacity: 1;
      animation: none;
      transform: none;
      filter: none;
    }
  }
</style>

