<script lang="ts">
  import { spring } from "svelte/motion";
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category, LockerStatus } from "./data";

  interface Props {
    category: Category;
    open?: boolean;
    onclose?: () => void;
  }

  let { category, open = $bindable(false), onclose }: Props = $props();

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
    if ($progress > 0.28) {
      open = false;
      onclose?.();
    } else {
      progress.set(0);
    }
  }

  const statusLabel: Record<LockerStatus, string> = {
    available: "Libre",
    occupied: "Ocupado",
    reserved: "Reservado",
  };

  function initials(name: string) {
    return name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  const contentOpacity = $derived(Math.max(0, 1 - $progress * 1.4));
  const theme = $derived(category.theme);
  const sheetStyle = $derived(
    `transform: translateY(${$progress * 100}%); pointer-events: ${open ? "auto" : "none"};` +
      `--sheet-accent: ${theme.accent}; --sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep}; --sheet-glow: ${theme.glow}; --sheet-hue: ${theme.hue}deg;`
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
    <header class="sheet-header">
      <h2>{category.label}</h2>
      <div class="icon-cluster">
        <IsoIcon kind={category.icon} size={128} />
      </div>
      <p class="sheet-sub">{category.detailTitle}</p>
    </header>

    <div class="sheet-body">
      {#if category.id === "lockers" && category.lockers}
        <div class="grid">
          {#each category.lockers as unit (unit.id)}
            <div class="unit" class:dim={unit.status !== "available"}>
              <IsoIcon unit status={unit.status} size={64} />
              <span class="unit-number">{unit.number}</span>
              <span class="unit-status status-{unit.status}">{statusLabel[unit.status]}</span>
            </div>
          {/each}
        </div>
      {:else if category.id === "events" && category.events}
        <div class="timeline">
          {#each category.events as ev (ev.id)}
            <div class="event-row">
              <div class="event-date">
                <span class="event-day">{ev.day}</span>
                <span class="event-month">{ev.month}</span>
              </div>
              <div class="event-line"></div>
              <div class="event-body">
                <span class="event-tag">{ev.tag}</span>
                <h3 class="event-title">{ev.title}</h3>
                <p class="event-time">{ev.time}</p>
              </div>
            </div>
          {/each}
        </div>
      {:else if category.id === "resources" && category.resources}
        <div class="repo-list">
          {#each category.resources as r (r.id)}
            <div class="repo-card">
              <div class="repo-head">
                <span class="repo-dot"></span>
                <h3 class="repo-name">{r.name}</h3>
              </div>
              <p class="repo-desc">{r.description}</p>
              <div class="repo-foot">
                <span class="repo-tag">{r.tag}</span>
                <span class="repo-stat">⬡ {r.stat1} {r.stat1Label}</span>
                <span class="repo-stat">◆ {r.stat2} {r.stat2Label}</span>
                <span class="repo-updated">{r.updated}</span>
              </div>
            </div>
          {/each}
        </div>
      {:else if category.id === "community" && category.news}
        <div class="news-list">
          {#each category.news as n (n.id)}
            <div class="news-card">
              <div class="news-top">
                <span class="news-tag">{n.tag}</span>
                <span class="news-time">{n.time}</span>
              </div>
              <h3 class="news-title">{n.title}</h3>
              <p class="news-excerpt">{n.excerpt}</p>
              <div class="news-author">
                <span class="avatar">{initials(n.author)}</span>
                {n.author}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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

  .sheet-header {
    text-align: center;
    padding: 4px 24px 18px;
    flex-shrink: 0;
  }

  .sheet-header h2 {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 22px;
    letter-spacing: 0.08em;
    margin: 0;
    color: #eafff5;
  }

  .icon-cluster {
    margin: 10px 0 6px;
    display: flex;
    justify-content: center;
    filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.35)) hue-rotate(var(--sheet-hue));
  }

  .sheet-sub {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(234, 255, 245, 0.65);
  }

  .sheet-body {
    flex: 1;
    overflow-y: auto;
  }

  /* ---------- Casilleros: grid ---------- */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 8px 22px 40px;
  }

  .unit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 6px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition: transform 0.2s ease;
  }

  .unit:active {
    transform: scale(0.95);
  }

  .unit.dim {
    background: rgba(0, 0, 0, 0.18);
  }

  .unit-number {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 0.06em;
    color: #eafff5;
  }

  .unit-status {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .status-available {
    color: #0a1a12;
    background: var(--accent);
  }

  .status-occupied {
    color: rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.08);
  }

  .status-reserved {
    color: var(--ink-1);
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.25);
  }

  /* ---------- Eventos: timeline ---------- */
  .timeline {
    padding: 8px 22px 40px;
    display: flex;
    flex-direction: column;
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
    font-family: var(--font-display);
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

  .event-title {
    margin: 6px 0 2px;
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 15px;
    color: #eafff5;
  }

  .event-time {
    margin: 0;
    font-size: 12px;
    color: rgba(234, 255, 245, 0.6);
  }

  /* ---------- Recursos: repo cards ---------- */
  .repo-list {
    padding: 8px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .repo-card {
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .repo-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .repo-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--sheet-accent);
    box-shadow: 0 0 8px var(--sheet-glow);
    flex-shrink: 0;
  }

  .repo-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 500;
    color: #eafff5;
  }

  .repo-desc {
    margin: 8px 0 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.7);
  }

  .repo-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: rgba(234, 255, 245, 0.55);
  }

  .repo-tag {
    padding: 2px 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--sheet-accent);
    font-size: 10px;
    letter-spacing: 0.03em;
  }

  .repo-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .repo-updated {
    margin-left: auto;
    opacity: 0.7;
  }

  /* ---------- Comunidad: news feed ---------- */
  .news-list {
    padding: 8px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .news-card {
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .news-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .news-tag {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #04120c;
    background: var(--sheet-accent);
    padding: 2px 9px;
    border-radius: 999px;
  }

  .news-time {
    font-size: 11px;
    color: rgba(234, 255, 245, 0.5);
  }

  .news-title {
    margin: 8px 0 4px;
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 14.5px;
    color: #eafff5;
  }

  .news-excerpt {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.7);
  }

  .news-author {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: rgba(234, 255, 245, 0.6);
  }

  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--sheet-accent);
    color: #04120c;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
