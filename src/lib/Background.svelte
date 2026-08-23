<script lang="ts">
  interface Props {
    tint?: "navy" | "accent";
    override?: { dim: string; deep: string } | null;
  }
  let { tint = "navy", override = null }: Props = $props();
  const overrideStyle = $derived(override ? `--ov-dim: ${override.dim}; --ov-deep: ${override.deep};` : "");
</script>

<div class="bg" class:accent={tint === "accent"} style={overrideStyle}>
  <!-- El tint por riesgo se monta siempre y simplemente cross-fadea.
       Swapping the `background` shorthand between two different
       radial-gradients can't animate (CSS has nothing to interpolate, so it
       snaps), and tearing the layer out of the DOM made the change land in
       one hard frame. Opacity is GPU-compositable, so this is both
       smoother and cheaper than what it replaces. -->
  <div class="sheen" class:hidden={!!override}></div>
  <div class="risk-tint" class:on={!!override}></div>
  <svg class="grid" width="100%" height="100%" preserveAspectRatio="none">
    <defs>
      <!-- Retícula de cruces de registro (las marcas de un plano técnico),
           no la malla de rombos isométricos que había antes: los rombos
           llenaban la pantalla de diagonales que chocaban con una interfaz
           que es toda rectangular, y a tamaño completo se leían como una
           textura rara en vez de como estructura de fondo. La cruz va
           CENTRADA en la baldosa (22,22 de 44×44) — puesta en la esquina
           quedaría partida en cuatro por el mosaico. -->
      <pattern id="tech-grid" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="translate(0,0)">
        <path d="M22 17.5 V26.5 M17.5 22 H26.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
      </pattern>
      <!-- r=75% (antes) significa que CUALQUIER punto a más de 75% de
           distancia del centro se pinta con el último color-stop SÓLIDO —
           sin más degradado. Con el centro en cy=30% y contenido que ahora
           llega hasta el final de la rueda + la píldora "desliza arriba",
           la mitad inferior de la pantalla caía entera en esa zona plana:
           un bloque de opacidad 0.65 uniforme, sin textura, que se veía
           como una "tarjeta" negra pegada debajo de la rueda en vez de un
           degradado continuo (hallazgo real, reportado en un celular).
           r=130% (mayor que la distancia a cualquier esquina de la caja)
           más un stop intermedio hace que el oscurecimiento sea gradual
           en TODA la pantalla, sin llegar nunca a la meseta plana. -->
      <radialGradient id="vignette" cx="50%" cy="25%" r="130%">
        <stop offset="0%" stop-color="black" stop-opacity="0" />
        <stop offset="55%" stop-color="black" stop-opacity="0.22" />
        <stop offset="100%" stop-color="black" stop-opacity="0.5" />
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#tech-grid)" class="grid-lines" />
    <rect width="100%" height="100%" fill="url(#vignette)" />
  </svg>
</div>

<style>
  /* The ellipse now runs well past 100% before it ever reaches bg-void, so
     the tone keeps drifting all the way to the bottom edge instead of
     flatlining into a visibly different, texture-less zone once the wheel
     (and everything below it) got taller. */
  .bg {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 150% at 50% 0%, var(--bg-panel-2) 0%, var(--bg-deep) 68%, var(--bg-void) 140%);
    color: var(--line-strong);
    overflow: hidden;
  }
  .bg.accent {
    background: radial-gradient(130% 160% at 50% -10%, var(--accent-dim) 0%, var(--bg-deep) 70%, var(--bg-void) 140%);
    color: var(--accent-ghost);
  }

  /* Security's hour-of-day risk tone — same gradient shape, colors handed
     in via CSS vars so it stays visually consistent with every other
     module instead of introducing a one-off look. Sits as its own layer
     that fades over the navy base rather than replacing it. */
  .risk-tint {
    position: absolute;
    inset: 0;
    background: radial-gradient(130% 160% at 50% -10%, var(--ov-dim, transparent) 0%, var(--ov-deep, transparent) 70%, var(--bg-void) 140%);
    opacity: 0;
    transition: opacity 0.55s ease;
    pointer-events: none;
  }

  .risk-tint.on {
    opacity: 1;
  }

  .sheen {
    transition: opacity 0.55s ease;
  }

  .sheen.hidden {
    opacity: 0;
    /* A running keyframe animation outranks a normal opacity declaration,
       so .sheen's breathing loop has to be cancelled or it would keep
       pulsing itself back to visible while "hidden". */
    animation: none;
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
    /* Sigue siendo una insinuación de estructura, no una textura que
       compita con nada — pero sube de 0.12 a 0.22 porque las cruces son
       trazos SUELTOS, no la malla continua de rombos que había antes: a
       la opacidad vieja se perdían del todo y el fondo se veía liso, como
       si el patrón se hubiera roto. */
    opacity: 0.22;
  }
  /* El desplazamiento TIENE que ser exactamente el alto de la baldosa
     (44px, ver el <pattern> arriba): así al terminar el ciclo la retícula
     queda calcada sobre sí misma y el bucle es invisible. Con cualquier
     otro valor el reinicio se ve como un salto. */
  @keyframes drift {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(-44px);
    }
  }
</style>
