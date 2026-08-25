<script lang="ts">
  import type { Category, SubscriptionBenefit } from "../data";
  import ErrorBanner from "../atoms/ErrorBanner.svelte";
  import SubscribeModal from "../SubscribeModal.svelte";

  // "descuento_casillero" con percent:0 no se muestra como "0% de
  // descuento" — un beneficio sin efecto real es ruido, no información.
  const BENEFIT_LABELS: Record<string, string> = {
    descuento_casillero: "de descuento en casilleros",
    descuento_billar: "de descuento en billar",
    acceso_ps4: "Acceso a la sala de PS4",
  };
  function formatBenefit(b: SubscriptionBenefit): string | null {
    if (typeof b.percent === "number") {
      if (b.percent <= 0) return null;
      return `${b.percent}% ${BENEFIT_LABELS[b.type] ?? b.type}`;
    }
    if (b.included) return BENEFIT_LABELS[b.type] ?? b.type;
    return null;
  }

  interface Props {
    category: Category;
    subscriptionTiersError?: boolean;
    onsubscribed?: () => void;
  }
  let {
    category,
    subscriptionTiersError = false,
    onsubscribed,
  }: Props = $props();

  let subscribingTier = $state<{ name: string; amount: string } | null>(null);
</script>

{#if subscriptionTiersError}
  <ErrorBanner message="No se pudo cargar la disponibilidad real de aportaciones — intenta más tarde." />
{/if}

{#if category.tiers}
  <div class="tier-list">
    {#each category.tiers as tier, i (tier.id)}
      {@const labels = tier.benefits.map(formatBenefit).filter(Boolean)}
      <button
        class="tier-card list-in"
        style="--li: {i}"
        onclick={() => (subscribingTier = { name: tier.name, amount: tier.amount })}
      >
        <div class="tier-head">
          <h3 class="tier-name">{tier.name}</h3>
          <span class="tier-price">${tier.amount}</span>
        </div>
        <ul class="tier-benefits">
          {#each labels as label}
            <li>{label}</li>
          {/each}
          {#if labels.length === 0}
            <!-- Sin esto, un tier cuyos beneficios son todos de 0%
                 (ej. Bronce) se veía COMPLETAMENTE vacío: parecía que
                 no daba nada y no había forma de saber para qué sirve.
                 Aportar de por sí ya es el beneficio. -->
            <li class="tier-benefit-base">Apoyas a AEIS y sus actividades</li>
          {/if}
        </ul>
        <span class="tier-cta">Aportar ${tier.amount} →</span>
      </button>
    {/each}
  </div>
{/if}

{#if subscribingTier}
  <SubscribeModal
    tierName={subscribingTier.name}
    tierAmount={subscribingTier.amount}
    onclose={() => (subscribingTier = null)}
    onsubscribed={() => onsubscribed?.()}
  />
{/if}

<style>
  .tier-list {
    padding: 8px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .tier-card {
    display: block;
    width: 100%;
    text-align: left;
    padding: 16px 18px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .tier-card:hover {
      border-color: var(--sheet-accent);
      transform: translateY(-1px);
    }
  }

  .tier-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .tier-name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 16px;
    letter-spacing: 0.02em;
    color: #eafff5;
  }

  .tier-price {
    font-family: var(--font-heading);
    font-size: 18px;
    font-weight: 700;
    color: var(--sheet-accent);
    flex-shrink: 0;
  }

  .tier-benefits {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .tier-benefits li {
    font-size: 12.5px;
    line-height: 1.4;
    color: rgba(234, 255, 245, 0.75);
    padding-left: 16px;
    position: relative;
  }
  .tier-benefits li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: var(--sheet-accent);
    font-size: 11px;
  }

  .tier-benefit-base {
    opacity: 0.75;
    font-style: italic;
  }

  .tier-cta {
    display: inline-block;
    margin-top: 12px;
    font-family: var(--font-heading, sans-serif);
    font-size: 12.5px;
    letter-spacing: 0.03em;
    color: var(--sheet-accent);
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

