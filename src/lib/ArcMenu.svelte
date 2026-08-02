<script lang="ts">
  import { spring } from "svelte/motion";
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";

  interface Props {
    categories: Category[];
    selectedIndex?: number;
    locked?: boolean;
    onchange?: (index: number) => void;
    onswipeup?: () => void;
  }

  let { categories, selectedIndex = $bindable(0), locked = false, onchange, onswipeup }: Props = $props();

  // The disc scales off its own measured width instead of fixed pixels or vh,
  // so it stays proportional whether it's a full mobile screen or a shrunk
  // desktop card. REVEAL is capped well below R so the cap never passes the
  // disc's equator — past that point a circle's silhouette starts curving
  // back inward, which reads as a full sphere pinching shut, not a dome.
  let boxW = $state(375);

  const R = $derived(boxW * 0.82);
  const REVEAL = $derived(R * 0.94);
  const HUB_R = $derived(R * 0.2);
  const ICON_RADIUS = $derived(R * 0.63);
  const RING_RADII = $derived([0.38, 0.58, 0.82].map((f) => HUB_R + (R - HUB_R) * f));
  const ANGLE_STEP = 360 / categories.length;

  const rotation = spring(0, { stiffness: 0.15, damping: 0.72 });
  const dragPull = spring(0, { stiffness: 0.3, damping: 0.6 }); // -1..1 live swipe feedback

  // First-time-only "look, I turn" demo: nudges the wheel left then right
  // and settles back, so the affordance is shown rather than left for the
  // visitor to guess at (Nielsen: visibility of system status over relying
  // on the visitor to read a hint and remember it).
  $effect(() => {
    if (locked || typeof window === "undefined") return;
    let seen = false;
    try {
      seen = localStorage.getItem("aeis-wheel-demo-seen") === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    try {
      localStorage.setItem("aeis-wheel-demo-seen", "1");
    } catch {
      /* ignore */
    }
    const timers = [
      setTimeout(() => rotation.set(-ANGLE_STEP * 0.55), 900),
      setTimeout(() => rotation.set(ANGLE_STEP * 0.4), 1650),
      setTimeout(() => rotation.set(0), 2350),
    ];
    return () => timers.forEach(clearTimeout);
  });

  let dragging = $state(false);
  let startX = 0;
  let startY = 0;
  let startRotation = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let axisLocked: "x" | "y" | null = null;

  function wrap(deg: number) {
    return ((((deg + 180) % 360) + 360) % 360) - 180;
  }

  function settle(targetRotation: number, index: number) {
    rotation.set(targetRotation);
    selectedIndex = ((index % categories.length) + categories.length) % categories.length;
    onchange?.(selectedIndex);
  }

  function onPointerDown(e: PointerEvent) {
    if (locked) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging = true;
    axisLocked = null;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastT = performance.now();
    velocity = 0;
    startRotation = $rotation;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || locked) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!axisLocked) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisLocked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
    }

    if (axisLocked === "y") {
      if (dy < -14) {
        dragging = false;
        onswipeup?.();
      }
      return;
    }

    if (axisLocked === "x") {
      const deltaDeg = (dx / R) * (180 / Math.PI) * 1.1;
      rotation.set(startRotation + deltaDeg, { hard: true });
      dragPull.set(Math.max(-1, Math.min(1, dx / 130)));

      const now = performance.now();
      const dt = now - lastT || 16;
      velocity = ((e.clientX - lastX) / dt) * 16.6;
      lastX = e.clientX;
      lastT = now;
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    dragPull.set(0);
    if (axisLocked !== "x") return;

    const flick = Math.abs(velocity) > 5 ? (velocity > 0 ? -1 : 1) : 0;
    const raw = -$rotation / ANGLE_STEP;
    const nearest = Math.round(raw) + flick;
    settle(-nearest * ANGLE_STEP, nearest);
  }

  /** A trapezoid fanning out from the hub — an outer arc + inner arc joined
   *  by two radial edges, with round stroke joins softening all 4 corners —
   *  rather than a pie slice collapsing to a sharp point at the center. */
  function wedgePath(a1: number, a2: number, rOuter: number, rInner: number): string {
    const toXY = (r: number, a: number) => {
      const rad = (a * Math.PI) / 180;
      return [r * Math.sin(rad), -r * Math.cos(rad)];
    };
    const [ox1, oy1] = toXY(rOuter, a1);
    const [ox2, oy2] = toXY(rOuter, a2);
    const [ix1, iy1] = toXY(rInner, a1);
    const [ix2, iy2] = toXY(rInner, a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return (
      `M ${ix1} ${iy1} L ${ox1} ${oy1} ` +
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2} ` +
      `L ${ix2} ${iy2} ` +
      `A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1} Z`
    );
  }
</script>

<div
  class="stage"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  role="listbox"
  tabindex="0"
  aria-label="Selector de categorías"
>
  <button class="edge-arrow left" style="opacity: {Math.max(0, -$dragPull)}" tabindex="-1" aria-hidden="true">‹</button>
  <button class="edge-arrow right" style="opacity: {Math.max(0, $dragPull)}" tabindex="-1" aria-hidden="true">›</button>

  <div class="dome-window" bind:clientWidth={boxW} style="height: {REVEAL + 8}px">
    <div
      class="disc"
      style="width:{R * 2}px; height:{R * 2}px; margin-left:{-R}px; bottom:{-(R * 2 - REVEAL)}px"
    >
      <svg class="disc-svg" viewBox="{-R} {-R} {R * 2} {R * 2}" style="transform: rotate({$rotation}deg)">
        <defs>
          <linearGradient id="metal-sweep" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.14" />
            <stop offset="35%" stop-color="#fff" stop-opacity="0.02" />
            <stop offset="55%" stop-color="#000" stop-opacity="0.08" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0.05" />
          </linearGradient>
          <linearGradient id="wedge-metal" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#1c2747" />
            <stop offset="45%" stop-color="#0d1330" />
            <stop offset="100%" stop-color="#060a1c" />
          </linearGradient>
          <linearGradient id="wedge-metal-active" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#20415c" />
            <stop offset="45%" stop-color="#123047" />
            <stop offset="100%" stop-color="#081b2c" />
          </linearGradient>
        </defs>
        {#each categories as cat, i (cat.id)}
          {@const base = i * ANGLE_STEP}
          {@const theta = wrap(base + $rotation)}
          {@const isActive = Math.abs(theta) < ANGLE_STEP / 2}
          <path
            d={wedgePath(base - ANGLE_STEP / 2, base + ANGLE_STEP / 2, R, HUB_R)}
            class="wedge"
            class:active={isActive}
            pathLength="1"
            style="animation-delay: {i * 90}ms"
          />
        {/each}
        {#each RING_RADII as ringR}
          <circle r={ringR} class="radar-ring" />
        {/each}
        <circle r={R - HUB_R * 0.5} class="metal-sheen" />
        <circle r={R - 1} class="rim" pathLength="1" style="animation-delay: {categories.length * 90 + 120}ms" />
        <circle r={HUB_R} class="hub-disc" />
        <circle
          r={HUB_R}
          class="hub-ring"
          pathLength="1"
          style="animation-delay: {categories.length * 90 + 60}ms"
        />
      </svg>

      <div class="icons-layer">
        {#each categories as cat, i (cat.id)}
          {@const base = i * ANGLE_STEP}
          {@const theta = wrap(base + $rotation)}
          {@const isActive = Math.abs(theta) < ANGLE_STEP / 2}
          {@const dist = Math.min(Math.abs(theta) / (ANGLE_STEP * 1.4), 1)}
          <button
            class="icon-spot"
            class:active={isActive}
            style="transform: rotate({base + $rotation}deg) translateY({-ICON_RADIUS}px)"
            onclick={() => settle(-base, i)}
            aria-selected={isActive}
            role="option"
            aria-label={cat.label}
          >
            <span
              class="icon-counter"
              style="transform: translate(-50%, -50%) rotate({-(base + $rotation)}deg) scale({isActive
                ? 1
                : 0.72 - dist * 0.08}); opacity: {1 - dist * 0.55}"
            >
              <IsoIcon kind={cat.icon} size={isActive ? R * 0.56 : R * 0.3} />
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="dots">
    {#each categories as cat, i (cat.id)}
      <span class="dot" class:active={i === selectedIndex}></span>
    {/each}
  </div>
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    touch-action: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    padding-bottom: 4px;
  }

  .edge-arrow {
    position: absolute;
    top: 40%;
    font-size: 26px;
    line-height: 1;
    color: var(--accent);
    text-shadow: 0 0 12px var(--accent-glow);
    pointer-events: none;
    transition: transform 0.15s ease;
  }

  .edge-arrow.left {
    left: 2px;
  }

  .edge-arrow.right {
    right: 2px;
  }

  .dome-window {
    position: relative;
    width: 100%;
    flex-shrink: 0;
    overflow: hidden;
  }

  .disc {
    position: absolute;
    left: 50%;
  }

  .disc-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    will-change: transform;
  }

  /* Thin metal seams, not thick comic-book ink outlines — a hairline edge
     plus a gradient fill reads as brushed panel joints, not a cel-shaded
     cartoon. Each wedge also traces itself in once on mount, like a
     blueprint being drawn rather than a static sticker. */
  .wedge {
    fill: url(#wedge-metal);
    stroke: var(--line-strong);
    stroke-width: 1.2;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw-line 0.9s ease-out forwards;
    transition: fill 0.35s ease;
  }

  .wedge.active {
    fill: url(#wedge-metal-active);
    stroke: var(--accent);
    stroke-opacity: 0.6;
  }

  @keyframes draw-line {
    to {
      stroke-dashoffset: 0;
    }
  }

  .radar-ring {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1;
    stroke-dasharray: 2 5;
    opacity: 0.5;
  }

  .metal-sheen {
    fill: url(#metal-sweep);
    mix-blend-mode: overlay;
    pointer-events: none;
  }

  .rim {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.6;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw-line 1.1s ease-out forwards;
  }

  .hub-disc {
    fill: var(--bg-void);
  }

  .hub-ring {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.3;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw-line 0.7s ease-out forwards;
  }

  .icons-layer {
    position: absolute;
    inset: 0;
  }

  .icon-spot {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    cursor: pointer;
  }

  .icon-counter {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.3s ease;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
  }

  .icon-spot.active .icon-counter {
    filter: drop-shadow(0 0 14px var(--accent-glow));
  }

  .dots {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--line-strong);
    transition: background 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
  }

  .dot.active {
    background: var(--accent);
    transform: scale(1.3);
    box-shadow: 0 0 8px var(--accent-glow);
  }
</style>
