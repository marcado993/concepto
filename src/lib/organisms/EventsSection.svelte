<script lang="ts">
  import type { Category } from "../data";

  interface Props {
    category: Category;
  }
  let { category }: Props = $props();
</script>

<!-- El PRIMERO es el más próximo (la lista viene ordenada por fecha).
     Marcarlo responde a la pregunta que el estudiante trae al entrar —
     "¿qué es lo siguiente?" — sin obligarle a comparar fechas a ojo. -->
{#if category.events}
  <div class="timeline">
    {#each category.events as ev, i (ev.id)}
      <div class="event-row list-in" class:event-next={i === 0} style="--li: {i}">
        <div class="event-date">
          <span class="event-day">{ev.day}</span>
          <span class="event-month">{ev.month}</span>
        </div>
        <div class="event-line"></div>
        <div class="event-body">
          <span class="event-tags">
            <span class="event-tag">{ev.tag}</span>
            {#if i === 0}
              <span class="event-next-badge">
                <span class="next-dot" aria-hidden="true"></span>
                Próximo
              </span>
            {/if}
          </span>
          <h3 class="event-title">{ev.title}</h3>
          <p class="event-time">{ev.time}</p>
        </div>
      </div>
    {/each}
  </div>
{/if}
