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
