<script lang="ts">
  import { fade } from "svelte/transition";
  import Background from "./lib/Background.svelte";
  import ArcMenu from "./lib/ArcMenu.svelte";
  import DetailSheet from "./lib/DetailSheet.svelte";
  import DesktopNav from "./lib/DesktopNav.svelte";
  import CategoryContent from "./lib/CategoryContent.svelte";
  import TypeText from "./lib/TypeText.svelte";
  import { categories } from "./lib/data";
  import { riskForHour, themeForRisk } from "./lib/risk";

  // The wheel is a touch gesture wearing a UI — dragging a disc with a
  // mouse (or worse, tabbing to it with a keyboard) is a parlor trick, not
  // navigation. Mouse-and-keyboard visitors get a plain clickable nav and
  // a static content panel instead; touch (phone or tablet, any width)
  // keeps the dial, since that's the input it was actually designed for.
  let isDesktop = $state(false);
  $effect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: fine) and (min-width: 720px)");
    isDesktop = mq.matches;
    const handler = (e: MediaQueryListEvent) => (isDesktop = e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  let selectedIndex = $state(0);
  let sheetOpen = $state(false);
  let firstVisit = $state(false);

  // Seguridad's tone tracks the actual clock — not fixed like every other
  // module's theme — so it re-derives from the wall time on a slow tick
  // instead of once at load.
  let currentHour = $state(new Date().getHours());
  $effect(() => {
    const id = setInterval(() => (currentHour = new Date().getHours()), 60_000);
    return () => clearInterval(id);
  });
  const securityTheme = $derived(themeForRisk(riskForHour(currentHour)));

  const displayCategories = $derived(
    categories.map((c) => (c.id === "security" ? { ...c, theme: securityTheme } : c))
  );

  const activeCategory = $derived(displayCategories[selectedIndex]);
  // Handed to CategoryContent as a reference that doesn't change identity
  // just because you've navigated to some other section — see the comment
  // by <SecurityMapComp> for why that distinction is the whole point.
  const securityCategory = $derived(displayCategories.find((c) => c.id === "security") ?? null);
  const bgOverride = $derived(
    activeCategory.id === "security" ? { dim: securityTheme.accentDim, deep: securityTheme.deep } : null
  );

  function openSheet() {
    sheetOpen = true;
  }

  // A first-time visitor has no reason to know the disc turns or that the
  // pill opens something — Nielsen's "visibility of system status": show
  // the affordance plainly instead of expecting it to be recalled from a
  // faint caption. Settles back to the compact hint after a look, or the
  // moment the visitor actually acts.
  $effect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = localStorage.getItem("aeis-onboarded") === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    firstVisit = true;
    try {
      localStorage.setItem("aeis-onboarded", "1");
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => (firstVisit = false), 4200);
    return () => clearTimeout(t);
  });

  function dismissOnboarding() {
    firstVisit = false;
  }
</script>

<div class="phone-frame" class:desktop={isDesktop}>
  <div class="screen" class:desktop={isDesktop}>
    <Background tint={sheetOpen ? "accent" : "navy"} override={bgOverride} />

    <div class="brandbar">
      <span class="brand-dot"></span>
      <span class="brand-name">AEIS</span>
      <img src="/aso.png" alt="AEIS" class="brand-mark" />
    </div>

    {#if isDesktop}
      <main class="desktop-main">
        <aside class="desktop-side">
          <DesktopNav
            categories={displayCategories}
            {selectedIndex}
            onselect={(i) => (selectedIndex = i)}
            vertical
          />
        </aside>
        <section class="desktop-stage">
          <div class="desktop-label">
            {#key activeCategory.id}
              <div in:fade={{ duration: 150 }}>
                <h1 class="desktop-title">{activeCategory.label}</h1>
                <p class="desktop-prompt">{activeCategory.prompt}</p>
              </div>
            {/key}
          </div>
          <div class="desktop-panel">
            <!-- Not keyed on activeCategory.id: that used to blow away and
                 rebuild CategoryContent (and the map inside it) on every
                 switch. Content now swaps instantly instead of fading in,
                 which is the right trade for not re-fetching a map. -->
            <div class="desktop-panel-inner">
              <CategoryContent
                category={activeCategory}
                {securityCategory}
                securityRisk={riskForHour(currentHour)}
                wide
              />
            </div>
          </div>
        </section>
      </main>
    {:else}
      <main class="menu-layer" class:receded={sheetOpen}>
        <div class="label-block">
          {#key activeCategory.id}
            <div in:fade={{ duration: 150 }}>
              <TypeText tag="h1" class="label" text={activeCategory.label} speed={34} />
              <TypeText
                tag="p"
                class="prompt-text"
                text={activeCategory.prompt}
                speed={14}
                startDelay={activeCategory.label.length * 34 + 120}
              />
            </div>
          {/key}
        </div>
        <p class="swipe-hint" class:emphasize={firstVisit}>
          <span class="hint-arrow bounce-left">‹</span>
          {firstVisit ? "desliza el disco para elegir" : "desliza para elegir"}
          <span class="hint-arrow bounce-right">›</span>
        </p>
        <div class="wheel-slot" onpointerdown={dismissOnboarding}>
          <ArcMenu bind:selectedIndex categories={displayCategories} locked={sheetOpen} onswipeup={openSheet} />
        </div>
        <div class="pill-slot">
          <button class="open-pill" class:emphasize={firstVisit} onclick={openSheet}>
            <span class="open-pill-arrow">︿</span>
            desliza arriba o toca aquí
          </button>
        </div>
      </main>

      <DetailSheet
        category={activeCategory}
        bind:open={sheetOpen}
        {securityCategory}
        securityRisk={riskForHour(currentHour)}
      />
    {/if}

  </div>
</div>

<style>
  .phone-frame {
    height: 100dvh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .screen {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .brandbar {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: max(18px, env(safe-area-inset-top)) 24px 0;
  }

  .brand-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
  }

  .brand-mark {
    width: 40px;
    height: 40px;
    object-fit: contain;
    margin-left: auto;
    filter: drop-shadow(0 0 6px var(--accent-glow));
  }

  .brand-name {
    font-family: var(--font-display);
    font-size: 13px;
    letter-spacing: 0.3em;
    color: var(--ink-1);
  }

  .menu-layer {
    position: relative;
    z-index: 5;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(10px, 2.6vh, 20px);
    padding-top: clamp(8px, 2vh, 20px);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease;
  }

  .menu-layer.receded {
    transform: translateY(14px) scale(0.98);
    opacity: 0.3;
  }

  .label-block {
    text-align: center;
    padding: 0 20px;
    flex: 0 0 auto;
  }

  .label {
    font-family: var(--font-display);
    font-size: clamp(22px, 7vw, 28px);
    font-weight: 500;
    letter-spacing: 0.06em;
    margin: 0;
    color: var(--ink-0);
    text-shadow: 0 0 24px var(--accent-glow);
  }

  .prompt-text {
    margin: 6px 0 0;
    font-size: 13px;
    letter-spacing: 0.02em;
    color: var(--ink-1);
    line-height: 1.4;
  }

  .wheel-slot {
    width: 100%;
    flex: 1 1 auto;
    min-height: 130px;
  }

  /* Sits immediately under the wheel's own dots, not stranded in the
     leftover space — Gestalt proximity: the dial and its "confirm" action
     read as one control cluster only when they're actually close together. */
  .pill-slot {
    width: 100%;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .swipe-hint {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 22px;
    border-radius: 999px;
    background: var(--accent-ghost);
    border: 1px solid var(--accent-dim);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--ink-0);
    text-align: center;
    flex: 0 0 auto;
    text-transform: lowercase;
    transition: font-size 0.3s ease, padding 0.3s ease, background 0.3s ease, border-color 0.3s ease,
      box-shadow 0.3s ease;
  }

  .swipe-hint.emphasize {
    font-size: 13.5px;
    padding: 11px 24px;
    background: var(--accent-ghost);
    border-color: var(--accent);
    box-shadow: 0 0 22px var(--accent-glow);
  }

  .hint-arrow {
    display: inline-block;
    color: var(--accent);
    animation: hint-bounce 1.6s ease-in-out infinite;
  }

  .bounce-left {
    animation-name: hint-bounce-left;
  }

  .bounce-right {
    animation-name: hint-bounce-right;
  }

  @keyframes hint-bounce-left {
    0%,
    100% {
      transform: translateX(0);
      opacity: 0.7;
    }
    50% {
      transform: translateX(-4px);
      opacity: 1;
    }
  }

  @keyframes hint-bounce-right {
    0%,
    100% {
      transform: translateX(0);
      opacity: 0.7;
    }
    50% {
      transform: translateX(4px);
      opacity: 1;
    }
  }

  .open-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    margin: 0 0 max(4px, env(safe-area-inset-bottom));
    padding: 13px 26px;
    border-radius: 999px;
    background: var(--accent);
    color: #010805;
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: lowercase;
    text-shadow: none;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    flex: 0 0 auto;
    box-shadow: 0 0 0 2px rgba(4, 18, 12, 0.4) inset, 0 8px 24px var(--accent-glow);
    animation: pill-breathe 2.4s ease-in-out infinite;
    transition: transform 0.25s ease;
  }

  .open-pill.emphasize {
    animation: pill-breathe-strong 1.3s ease-in-out infinite;
  }

  @keyframes pill-breathe-strong {
    0%,
    100% {
      transform: translateY(0) scale(1);
      box-shadow: 0 0 0 2px rgba(4, 18, 12, 0.4) inset, 0 8px 24px var(--accent-glow);
    }
    50% {
      transform: translateY(-5px) scale(1.07);
      box-shadow: 0 0 0 2px rgba(4, 18, 12, 0.4) inset, 0 0 34px var(--accent-glow), 0 14px 34px var(--accent-glow);
    }
  }

  .open-pill-arrow {
    font-size: 12px;
    line-height: 0.6;
    opacity: 0.9;
  }

  @keyframes pill-breathe {
    0%,
    100% {
      transform: translateY(0) scale(1);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25) inset, 0 8px 24px var(--accent-glow);
    }
    50% {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3) inset, 0 12px 30px var(--accent-glow);
    }
  }

  /* Desktop/web: the same interface adapted as a page section — not a fake
     phone mockup. No bezel, no notch, just a comfortably sized panel that
     scales with the actual browser window. */
  @media (min-width: 720px) {
    .phone-frame {
      background: radial-gradient(120% 120% at 50% 0%, #10131d 0%, #04050a 70%);
      padding: 5vh 24px;
    }

    .screen {
      width: min(460px, 92vw);
      height: min(780px, calc(100vh - 10vh));
      border-radius: 28px;
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--line-soft);
    }

    .brandbar {
      padding-top: 26px;
    }
  }

  /* Mouse-and-keyboard visitors get the whole viewport, not a phone-shaped
     card floating in dead space — a desktop browser window IS the frame,
     so the bezel, the max-width and the centering all come off. */
  .phone-frame.desktop {
    padding: 0;
    background: var(--bg-void);
    align-items: stretch;
  }

  .screen.desktop {
    width: 100%;
    height: 100dvh;
    max-width: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  .desktop-main {
    position: relative;
    z-index: 5;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(190px, 232px) 1fr;
    gap: 0;
  }

  .desktop-side {
    padding: 10px 16px 24px;
    border-right: 1px solid var(--line-soft);
    overflow-y: auto;
  }

  .desktop-stage {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .desktop-label {
    padding: 10px 28px 6px;
  }

  .desktop-title {
    font-family: var(--font-display);
    font-size: clamp(26px, 2.4vw, 36px);
    font-weight: 500;
    letter-spacing: 0.05em;
    margin: 0;
    color: var(--ink-0);
    text-shadow: 0 0 24px var(--accent-glow);
  }

  .desktop-prompt {
    margin: 6px 0 0;
    font-size: 13.5px;
    color: var(--ink-1);
  }

  .desktop-panel {
    flex: 1;
    min-height: 0;
    margin: 8px 20px 20px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--line-strong);
    overflow: hidden;
    display: flex;
  }

  .desktop-panel-inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
