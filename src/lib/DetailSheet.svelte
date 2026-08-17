<script lang="ts">
  import { spring } from "svelte/motion";
  import CategoryContent from "./CategoryContent.svelte";
  import type { Category } from "./data";

  interface Props {
    category: Category;
    open?: boolean;
    onclose?: () => void;
    securityRisk?: number;
    securityCategory?: Category | null;
    lockersCategory?: Category | null;
    securityIndicatorsError?: boolean;
    venturesError?: boolean;
    lockersError?: boolean;
    myPendingReceipt?: { rentalId: string; lockerCode: string } | null;
    myRentedLocker?: { lockerCode: string; zone: string } | null;
    onlockerrented?: () => void;
    subscriptionTiersError?: boolean;
    onsubscribed?: () => void;
  }

  let {
    category,
    open = $bindable(false),
    onclose,
    securityRisk = 0.5,
    securityCategory = null,
    lockersCategory = null,
    securityIndicatorsError = false,
    venturesError = false,
    lockersError = false,
    myPendingReceipt = null,
    myRentedLocker = null,
    onlockerrented,
    subscriptionTiersError = false,
    onsubscribed,
  }: Props = $props();

  // 1 = fully hidden below the screen, 0 = fully presented — a plain,
  // well-damped slide (the familiar iOS sheet motion) reads far more
  // natural here than trying to mask a square content grid with a circle.
  const progress = spring(1, { stiffness: 0.2, damping: 0.78 });

  $effect(() => {
    progress.set(open ? 0 : 1);
  });

  let dragging = false;
  let startY = 0;
  let startProgress = 0;

  function onPointerDown(e: PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging = true;
    startY = e.clientY;
    startProgress = $progress;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (dy < 0) return;
    const sheetHeight = window.innerHeight * 0.86;
    progress.set(Math.min(1, startProgress + dy / sheetHeight), { hard: true });
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    if ($progress > 0.2) {
      open = false;
      onclose?.();
    } else {
      progress.set(0);
    }
  }

  const contentOpacity = $derived(Math.max(0, 1 - $progress * 1.4));
  const theme = $derived(category.theme);
  const sheetStyle = $derived(
    `transform: translateY(${$progress * 100}%); pointer-events: ${open ? "auto" : "none"};` +
      `--sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep};`
  );
</script>

<div class="scrim" style="opacity: {1 - $progress}" class:interactive={open} onclick={() => { open = false; onclose?.(); }}></div>

<section class="sheet" style={sheetStyle} aria-hidden={!open}>
  <div
    class="handle-zone"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <div class="handle"></div>
  </div>

  <div class="sheet-inner" style="opacity: {contentOpacity}">
    <CategoryContent
      {category}
      {securityCategory}
      {lockersCategory}
      {securityRisk}
      {securityIndicatorsError}
      {venturesError}
      {lockersError}
      {myPendingReceipt}
      {myRentedLocker}
      {onlockerrented}
      {subscriptionTiersError}
      {onsubscribed}
      onheaderpointerdown={onPointerDown}
      onheaderpointermove={onPointerMove}
      onheaderpointerup={onPointerUp}
    />
  </div>
</section>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(2, 4, 10, 0.6);
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 20;
  }
  .scrim.interactive {
    pointer-events: auto;
  }

  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 86%;
    border-radius: 32px 32px 0 0;
    background: linear-gradient(165deg, var(--sheet-dim) 0%, var(--sheet-deep) 45%, var(--bg-void) 100%);
    box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.55);
    z-index: 30;
    display: flex;
    flex-direction: column;
    touch-action: none;
    overflow: hidden;
    will-change: transform;
    transition: background 0.4s ease;
  }

  .handle-zone {
    padding: 14px 0 6px;
    display: flex;
    justify-content: center;
    cursor: grab;
  }

  .handle {
    width: 44px;
    height: 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.35);
  }

  .sheet-inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    transition: opacity 0.2s ease;
  }
</style>
