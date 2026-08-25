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

<style>
  .timeline {
    padding: 8px 22px 40px;
    display: flex;
    flex-direction: column;
  }

  :global(.content-wrap.wide) .timeline {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 0 24px;
    padding: 20px 28px 40px;
  }

  .event-row {
    display: grid;
    grid-template-columns: 46px 16px 1fr;
    align-items: start;
  }

  .event-date {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1;
    padding-top: 2px;
  }

  .event-day {
    font-family: var(--font-heading);
    font-size: 20px;
    color: #eafff5;
  }

  .event-month {
    margin-top: 2px;
    font-size: 9px;
    letter-spacing: 0.1em;
    color: rgba(234, 255, 245, 0.6);
  }

  .event-line {
    display: flex;
    justify-content: center;
    align-self: stretch;
  }

  .event-line::before {
    content: "";
    width: 2px;
    background: linear-gradient(180deg, var(--sheet-accent) 0%, rgba(255, 255, 255, 0.12) 100%);
    border-radius: 2px;
  }

  .event-row:last-child .event-line::before {
    background: var(--sheet-accent);
    opacity: 0.5;
  }

  .event-body {
    padding: 0 0 26px 4px;
  }

  .event-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .event-tag {
    display: inline-block;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #04120c;
    background: var(--sheet-accent);
    padding: 2px 8px;
    border-radius: 999px;
  }

  .event-next-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--sheet-accent);
    color: #06170f;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .next-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #06170f;
    animation: next-blink 1.4s ease-in-out infinite;
  }

  @keyframes next-blink {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .event-row.event-next .event-day {
    color: var(--sheet-accent);
    text-shadow: 0 0 12px var(--sheet-glow);
  }

  .event-row.event-next .event-month {
    color: var(--sheet-accent);
    opacity: 0.85;
  }

  .event-title {
    margin: 6px 0 2px;
    font-family: var(--font-heading);
    font-weight: 500;
    font-size: 15px;
    color: #eafff5;
  }

  .event-time {
    margin: 0;
    font-size: 12px;
    color: rgba(234, 255, 245, 0.6);
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
    .list-in,
    .next-dot {
      opacity: 1;
      animation: none;
      transform: none;
      filter: none;
    }
  }
</style>

