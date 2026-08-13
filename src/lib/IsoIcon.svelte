<script lang="ts">
  import { cube, isoToScreen } from "./iso";
  import type { IconKind, LockerStatus } from "./data";

  interface Props {
    kind?: IconKind;
    size?: number;
    status?: LockerStatus;
    unit?: boolean;
    /** true solo para el ícono activo de la rueda — las otras 5 categorías
        se ven a la vez en pantalla desde el arranque, pero solo UNA es el
        foco real; el resto puede ceder ancho de banda frente al JS/CSS/API
        (hallazgo real: las 6 fotos de categoría descargaban ~1.6MB de un
        solo golpe en el sitio en producción, compitiendo por red justo
        cuando la grilla de Casilleros está animando su entrada). */
    priority?: boolean;
  }

  let { kind = "lockers", size = 96, status, unit = false, priority = false }: Props = $props();

  const W = 46;
  const H = 26;
  const D = 30;

  type Placed = { x: number; y: number; face: number };

  function layout(kind: IconKind): Placed[] {
    if (unit) return [{ x: 0, y: 0, face: 1 }];
    switch (kind) {
      case "lockers":
        return [
          { x: -1, y: 1, face: 0.55 },
          { x: 1, y: 1, face: 0.72 },
          { x: 0, y: 0, face: 1 },
        ].map((p, i) => ({ ...isoToScreen(p.x, p.y, i === 2 ? 0.4 : 0, W, H, 34), face: p.face }));
      case "resources":
        return [0, 1, 2, 3].map((level) => ({
          ...isoToScreen(0, 0, level, W, H, 34),
          face: 0.55 + level * 0.15,
        }));
      case "events":
        return [
          { x: 0, y: 0, level: 0, face: 1 },
          { x: 0, y: 0, level: 1, face: 0.65 },
        ].map((p) => ({ ...isoToScreen(p.x, p.y, p.level, W, H, 34), face: p.face }));
      case "community":
        return [
          { x: 0, y: -1, face: 0.6 },
          { x: -1, y: 0.4, face: 0.7 },
          { x: 1, y: 0.4, face: 0.8 },
          { x: 0, y: 1, face: 1 },
        ].map((p) => ({ ...isoToScreen(p.x, p.y, 0, W, H, 34), face: p.face }));
      case "security":
        // A small beacon: a wide base cube with a narrower one stacked on
        // top, reading as a watchtower/alarm silhouette on the wheel.
        return [0, 1].map((level) => ({
          ...isoToScreen(0, 0, level, W, H, 30),
          face: 0.6 + level * 0.4,
        }));
      case "subscriptions":
        // Tres bloques apilados — un tier por bloque (Bronce/Platino/
        // Pantera), cada uno más brillante que el de abajo. Sin PNG propio
        // todavía (a diferencia del resto de íconos); si llega uno, va en
        // photoMap más abajo y este case queda de respaldo sin tocar nada.
        return [0, 1, 2].map((level) => ({
          ...isoToScreen(0, 0, level, W, H, 22),
          face: 0.45 + level * 0.275,
        }));
      default:
        return [{ x: 0, y: 0, face: 1 }];
    }
  }

  // $derived (not plain const) — kind/status/unit are reactive props, and a
  // plain const only captures whatever they were at first mount. Detail-
  // Sheet reuses one IsoIcon instance across every category, so without
  // $derived here the header would freeze on the first icon it ever showed.
  const placed = $derived(layout(kind));

  const bounds = { minX: -90, minY: -100, w: 180, h: 170 };

  const statusTone: Record<LockerStatus, { top: string; body: string; glow: boolean }> = {
    available: { top: "var(--accent)", body: "var(--accent-dim)", glow: true },
    occupied: { top: "var(--ink-2)", body: "#1a2338", glow: false },
    reserved: { top: "var(--ink-1)", body: "#101a30", glow: false },
  };

  const tone = $derived(status ? statusTone[status] : { top: "var(--accent)", body: "var(--accent-dim)", glow: false });

  const photoMap: Partial<Record<IconKind, { src: string; alt: string }>> = {
    lockers: { src: "/locker2.png", alt: "Casilleros" },
    events: { src: "/Calendar.png", alt: "Eventos" },
    resources: { src: "/repo.png", alt: "Recursos" },
    community: { src: "/emprendimiento.png", alt: "Emprendimientos" },
    security: { src: "/alerta.png", alt: "Seguridad" },
  };
  const photo = $derived(photoMap[kind]);
</script>

{#if photo && !unit}
  {#key photo.src}
    <span class="photo-wrap" style="width: {size}px; height: {size}px">
      <img
        src={photo.src}
        alt={photo.alt}
        class="kind-photo"
        draggable="false"
        fetchpriority={priority ? "high" : "low"}
        decoding="async"
      />
      <span class="scan-sweep"></span>
    </span>
  {/key}
{:else}
<svg
  viewBox="{bounds.minX} {bounds.minY} {bounds.w} {bounds.h}"
  width={size}
  height={size}
  class="iso-icon"
  class:glow={tone.glow}
>
  {#if tone.glow && !unit}
    <!-- El filtro feGaussianBlur solo se define/usa para el ÍCONO GRANDE de
         la rueda (uno solo a la vez) — nunca para unit=true, que se
         renderiza hasta ~108 veces en la grilla de casilleros. Cada
         instancia definía su PROPIO <filter> con el mismo id repetido
         (id duplicado inválido en SVG/HTML) y el navegador tenía que
         rasterizar ~108 regiones de blur por separado — el cuello de
         botella real del lag en gama baja, no la rueda. Para unit=true el
         brillo usa un CSS drop-shadow más abajo (ver .cube.glow), que el
         compositor resuelve mucho más barato al repetirse tantas veces. -->
    <defs>
      <filter id="soft-glow-{kind}-{status}" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  {/if}

  <g
    filter={tone.glow && !unit ? `url(#soft-glow-${kind}-${status})` : undefined}
    class:unit-glow={tone.glow && unit}
  >
    {#each placed as p, i (i)}
      {@const c = cube(p.x, p.y, W, H, D)}
      <g class="cube">
        <polygon points={c.right} fill={unit ? tone.body : "var(--accent-dim)"} opacity={unit ? 1 : 0.35 * p.face} />
        <polygon points={c.left} fill={unit ? tone.body : "var(--accent-dim)"} opacity={unit ? 0.8 : 0.55 * p.face} />
        <polygon
          points={c.top}
          fill={unit ? tone.top : "var(--accent)"}
          opacity={unit ? 1 : 0.5 + 0.5 * p.face}
          stroke={unit ? tone.top : "var(--accent)"}
          stroke-width="0.6"
          stroke-opacity="0.6"
        />
        {#if unit}
          <line
            x1={p.x}
            y1={p.y - H / 2}
            x2={p.x}
            y2={p.y + H / 2 + D}
            stroke="var(--bg-void)"
            stroke-width="1.4"
            opacity="0.5"
          />
          <circle cx={p.x - 6} cy={p.y + H / 2 + D * 0.45} r="1.6" fill="var(--bg-void)" opacity="0.55" />
        {/if}
      </g>
    {/each}
  </g>
</svg>
{/if}

<style>
  .iso-icon {
    overflow: visible;
    display: block;
  }
  .cube {
    transition: opacity 0.4s ease;
  }

  /* Brillo barato para casilleros "disponible" en la grilla — un
     drop-shadow CSS normal, no un <filter> SVG con feGaussianBlur propio
     (ver comentario arriba de <defs>). El navegador ya sabe componer
     drop-shadow de forma eficiente incluso repetido ~100 veces; un
     feGaussianBlur con su propia región de filtro por instancia no. */
  .unit-glow {
    filter: drop-shadow(0 0 3px var(--accent-glow, rgba(33, 224, 160, 0.55)));
  }

  /* "Materializes" in once on mount — a clip-path wipe plus a scanning
     highlight line, like the image is being scanned into existence rather
     than just popping in. pointer-events stay off the whole photo: without
     it, touch-dragging directly over the <img> triggers the browser's
     native image-drag ghost instead of our swipe handlers, which is exactly
     what broke the left/right and swipe-up gestures. The "interactive"
     response instead answers the *selection* state (set by the parent
     button when the user picks this category), not raw hover/press. */
  .photo-wrap {
    position: relative;
    display: block;
    pointer-events: none;
  }

  .kind-photo {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    animation: materialize 1.1s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    transition: filter 0.3s ease;
  }

  :global(.icon-spot.active) .kind-photo {
    filter: drop-shadow(0 0 12px var(--accent-glow));
  }

  .scan-sweep {
    position: absolute;
    left: 4%;
    right: 4%;
    height: 22%;
    background: linear-gradient(180deg, transparent 0%, var(--accent) 50%, transparent 100%);
    opacity: 0.75;
    mix-blend-mode: screen;
    animation: scan-pass 1.1s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    pointer-events: none;
  }

  @keyframes materialize {
    0% {
      clip-path: inset(0 0 100% 0);
      opacity: 0;
      filter: brightness(2.2) saturate(0);
    }
    35% {
      opacity: 1;
    }
    100% {
      clip-path: inset(0 0 0% 0);
      opacity: 1;
      filter: brightness(1) saturate(1);
    }
  }

  @keyframes scan-pass {
    0% {
      top: -4%;
      opacity: 0;
    }
    12% {
      opacity: 0.9;
    }
    100% {
      top: 96%;
      opacity: 0;
    }
  }
</style>
