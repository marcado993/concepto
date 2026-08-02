<script lang="ts">
  interface Props {
    tint?: "navy" | "accent";
  }
  let { tint = "navy" }: Props = $props();
</script>

<div class="bg" class:accent={tint === "accent"}>
  {#if tint === "navy"}
    <div class="brushed"></div>
    <div class="sheen"></div>
  {/if}
  <svg class="grid" width="100%" height="100%" preserveAspectRatio="none">
    <defs>
      <pattern id="iso-grid" width="64" height="37" patternUnits="userSpaceOnUse" patternTransform="translate(0,0)">
        <path d="M0 18.5 L32 0 L64 18.5 L32 37 Z" fill="none" stroke="currentColor" stroke-width="1" />
      </pattern>
      <radialGradient id="vignette" cx="50%" cy="30%" r="75%">
        <stop offset="0%" stop-color="black" stop-opacity="0" />
        <stop offset="100%" stop-color="black" stop-opacity="0.65" />
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#iso-grid)" class="grid-lines" />
    <rect width="100%" height="100%" fill="url(#vignette)" />
  </svg>
</div>

<style>
  .bg {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 90% at 50% 0%, var(--bg-panel-2) 0%, var(--bg-deep) 55%, var(--bg-void) 100%);
    color: var(--line-strong);
    overflow: hidden;
  }
  .bg.accent {
    background: radial-gradient(130% 100% at 50% -10%, var(--accent-dim) 0%, var(--bg-deep) 60%, var(--bg-void) 100%);
    color: var(--accent-ghost);
  }

  /* Brushed metal: fine directional grain + macro steel gradient, tinted to the AEIS navy/green hue */
  .brushed {
    position: absolute;
    inset: -10%;
    background:
      repeating-linear-gradient(
        95deg,
        rgba(210, 230, 255, 0.05) 0px,
        rgba(210, 230, 255, 0.05) 1px,
        rgba(0, 0, 0, 0.06) 1px,
        rgba(0, 0, 0, 0.06) 2px,
        transparent 2px,
        transparent 4px
      ),
      linear-gradient(
        152deg,
        #222f52 0%,
        #10182f 22%,
        #0a1024 42%,
        #060a17 58%,
        #101a34 78%,
        #263a4f 100%
      );
    mix-blend-mode: screen;
    opacity: 0.9;
  }

  .sheen {
    position: absolute;
    inset: -20%;
    background: radial-gradient(45% 30% at 50% 8%, rgba(33, 224, 160, 0.1) 0%, transparent 70%);
    animation: breathe-glow 12s ease-in-out infinite;
  }

  @keyframes breathe-glow {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }

  .grid {
    position: absolute;
    inset: 0;
    animation: drift 40s linear infinite;
  }
  .grid-lines {
    /* Kept faint — the brushed metal grain carries the surface now, this is
       just a whisper of structure underneath it so it doesn't fight the
       wheel's own metal finish. */
    opacity: 0.12;
  }
  @keyframes drift {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(-37px);
    }
  }
</style>
