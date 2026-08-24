<script lang="ts">
  // CategoryContent es ahora un thin wrapper — dispatcher hacia los organisms.
  // Toda la lógica de cada sección vive en src/lib/organisms/:
  //   EventsSection       → events/recursos
  //   BenefitsSection     → recursos de la AEIS
  //   SubscriptionsSection → tiers de aportación
  //   CommunitySection    → directorio de emprendimientos
  //   LockersSection      → grilla de casilleros (108 unidades)
  //   SecuritySection     → mapa 3D + indicadores de seguridad
  //
  // El <style> al final de este archivo sigue aquí porque los organisms NO
  // tienen estilos propios: las clases CSS (`.sec-panel`, `.grid`, `.unit`,
  // etc.) son parte del sistema de diseño de esta app y se aplican al DOM
  // independientemente del componente que las emite. Svelte no hace scoping
  // a menos que se use <style module>, así que no hay pérdida de estilos.

  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";
  import EventsSection from "./organisms/EventsSection.svelte";
  import BenefitsSection from "./organisms/BenefitsSection.svelte";
  import SubscriptionsSection from "./organisms/SubscriptionsSection.svelte";
  import CommunitySection from "./organisms/CommunitySection.svelte";
  import LockersSection from "./organisms/LockersSection.svelte";
  import SecuritySection from "./organisms/SecuritySection.svelte";

  interface Props {
    category: Category;
    // A separate, always-the-same reference to the Seguridad category —
    // NOT just `category` when it happens to be active. See the note by
    // the map block below for why this exists.
    securityCategory?: Category | null;
    // Misma razón que securityCategory: una referencia que no cambia de
    // identidad solo porque se navegó a otra categoría — sin esto, la
    // grilla de hasta 108 casilleros se destruía y reconstruía entera
    // (con sus 108 animaciones de entrada) cada vez que se volvía a esta
    // sección (auditoría de rendimiento móvil).
    lockersCategory?: Category | null;
    securityRisk?: number;
    /** true si fetchSecurityIndicators() falló — distingue "cargando" de "no se pudo". */
    securityIndicatorsError?: boolean;
    /** true si fetchVentures() falló — mismo patrón que securityIndicatorsError. */
    venturesError?: boolean;
    /** true si fetchLockers() falló — mismo patrón que securityIndicatorsError. */
    lockersError?: boolean;
    /** true mientras los casilleros reales todavía vienen en camino. Antes
        no había NINGUNA señal: la grilla se veía vacía y no se distinguía
        "cargando" de "no hay nada" (H1, visibilidad del estado). */
    lockersLoading?: boolean;
    /** El casillero que el estudiante ya tiene CONFIRMADO este periodo, si
        hay uno — deja distinguirlo en la grilla y tocarlo para ver su
        estado, en vez de que lo busque entre hasta 108. */
    myRentedLocker?: { lockerCode: string; zone: string } | null;
    /** Desktop full-screen layout: let grids breathe into more columns. */
    wide?: boolean;
    /** Móvil de una sola pantalla: las pestañas de arriba YA dicen en qué
        sección estás, así que el encabezado grande (título + ícono de
        128px + subtítulo) era información repetida ocupando casi la mitad
        de lo visible — el espacio más caro que hay en un celular.
        Feedback textual: "se ve mucho adorno y poco contenido". */
    compact?: boolean;
    // Only wired up by the mobile sliding sheet, so its header doubles as a
    // drag handle — the desktop panel just omits these.
    onheaderpointerdown?: (e: PointerEvent) => void;
    onheaderpointermove?: (e: PointerEvent) => void;
    onheaderpointerup?: (e: PointerEvent) => void;
    /** Se llama tras un alquiler exitoso, para que App.svelte vuelva a pedir /lockers. */
    onlockerrented?: () => void;
    /** true si fetchSubscriptionTiers() falló — mismo patrón que lockersError. */
    subscriptionTiersError?: boolean;
    /** Se llama tras una aportación exitosa, para que App.svelte vuelva a pedir los tiers. */
    onsubscribed?: () => void;
  }

  let {
    category,
    securityCategory = null,
    lockersCategory = null,
    securityRisk = 0.5,
    securityIndicatorsError = false,
    venturesError = false,
    lockersError = false,
    lockersLoading = false,
    myRentedLocker = null,
    wide = false,
    compact = false,
    onheaderpointerdown,
    onheaderpointermove,
    onheaderpointerup,
    onlockerrented,
    subscriptionTiersError = false,
    onsubscribed,
  }: Props = $props();

  // import() dinámico, no un `import SecurityMapComp from "./SecurityMap.svelte"`
  // estático — SecurityMap.svelte importa mapWarm.ts, que a su vez importa
  // maplibre-gl (~1MB sin comprimir, hallazgo real de rendimiento: antes de
  // este cambio dist/assets/index-*.js pesaba ~1MB porque esta cadena
  // completa terminaba dentro del bundle de arranque, aunque el usuario
  // nunca abriera Seguridad). El import() se dispara igual apenas se monta
  // este componente (mismo momento que antes, durante el splash) — la
  // diferencia es que Vite lo separa en su propio chunk, así que ya no
  // bloquea el parseo del bundle principal. Es una promesa a nivel de
  // módulo (no dentro de una función), así solo se pide una vez aunque
  // SecurityMapComp se monte/desmonte varias veces navegando.
  const securityMapModule = import("./SecurityMap.svelte");
  // Props — igual que antes, sin cambio de contrato: el frontend no
  // necesita ajustarse.
  interface Props {
    category: Category;
    securityCategory?: Category | null;
    lockersCategory?: Category | null;
    securityRisk?: number;
    securityIndicatorsError?: boolean;
    venturesError?: boolean;
    lockersError?: boolean;
    lockersLoading?: boolean;
    myRentedLocker?: { lockerCode: string; zone: string } | null;
    wide?: boolean;
    compact?: boolean;
    onheaderpointerdown?: (e: PointerEvent) => void;
    onheaderpointermove?: (e: PointerEvent) => void;
    onheaderpointerup?: (e: PointerEvent) => void;
    onlockerrented?: () => void;
    subscriptionTiersError?: boolean;
    onsubscribed?: () => void;
  }

  let {
    category,
    securityCategory = null,
    lockersCategory = null,
    securityRisk = 0.5,
    securityIndicatorsError = false,
    venturesError = false,
    lockersError = false,
    lockersLoading = false,
    myRentedLocker = null,
    wide = false,
    compact = false,
    onheaderpointerdown,
    onheaderpointermove,
    onheaderpointerup,
    onlockerrented,
    subscriptionTiersError = false,
    onsubscribed,
  }: Props = $props();

  const isSecurityActive = $derived(category.id === "security");
  const isLockersActive = $derived(category.id === "lockers");

  const theme = $derived(category.theme);
  const wrapStyle = $derived(
    `--sheet-accent: ${theme.accent}; --sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep}; --sheet-glow: ${theme.glow}; --sheet-hue: ${theme.hue}deg;`
  );
</script>

<div class="content-wrap" class:wide class:compact style={wrapStyle}>
  <header
    class="sheet-header"
    onpointerdown={onheaderpointerdown}
    onpointermove={onheaderpointermove}
    onpointerup={onheaderpointerup}
    onpointercancel={onheaderpointerup}
  >
    {#if compact}
      <div class="compact-head">
        <span class="compact-icon" aria-hidden="true">
          <IsoIcon kind={category.icon} size={56} priority />
        </span>
        <span class="compact-text">
          <span class="compact-title">{category.label}</span>
          <span class="compact-sub">{category.detailTitle}</span>
        </span>
      </div>
    {:else}
      <h2>{category.label}</h2>
      <div class="icon-cluster">
        <IsoIcon kind={category.icon} size={128} priority />
      </div>
      <p class="sheet-sub">{category.detailTitle}</p>
    {/if}
  </header>

  <div class="sheet-body">
    <!-- Eventos y recursos: secciones sin estado de carga — los datos
         vienen de data.ts (estáticos). -->
    {#if category.id === "events"}
      <EventsSection {category} />
    {:else if category.id === "resources"}
      <BenefitsSection {category} />
    {:else if category.id === "subscriptions"}
      <SubscriptionsSection
        {category}
        {subscriptionTiersError}
        {onsubscribed}
      />
    {:else if category.id === "community"}
      <CommunitySection {category} {venturesError} />
    {/if}

    <!-- Casilleros: display:none en vez de {#if} para no destruir los 108
         nodos animados al navegar a otra sección y volver (ver LockersSection). -->
    <LockersSection
      {lockersCategory}
      {myRentedLocker}
      {lockersError}
      {lockersLoading}
      isActive={isLockersActive}
      {onlockerrented}
    />

    <!-- Seguridad: display:none en vez de {#if} para no destruir el
         contexto WebGL del mapa (ver SecuritySection). -->
    <SecuritySection
      {securityCategory}
      {securityRisk}
      {securityIndicatorsError}
      isActive={isSecurityActive}
    />
  </div>
</div>

<style>
  .content-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* Full-screen desktop: the header shrinks (the sidebar already names the
     section) and every list/grid spreads into the extra columns a wide
     viewport affords, instead of staying in a phone-width single file. */
  .content-wrap.wide .sheet-header {
    display: none;
  }

  .content-wrap.wide .grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    padding: 20px 28px 40px;
  }

  .content-wrap.wide .repo-list,
  .content-wrap.wide .news-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
    padding: 20px 28px 40px;
  }

  .content-wrap.wide .timeline {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 0 24px;
    padding: 20px 28px 40px;
  }

  .content-wrap.wide .sec-panel {
    padding: 20px 28px 32px;
  }

  .content-wrap.wide .sec-map-frame {
    height: min(46vh, 420px);
  }

  .content-wrap.wide .sec-grid {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }

  .sheet-header {
    text-align: center;
    padding: 4px 24px 18px;
    flex-shrink: 0;
    touch-action: none;
  }

  /* Sin el panel deslizante no hay gesto de arrastre desde el header, así
     que tampoco hay razón para apagarle el touch nativo — dejarlo puesto
     era justo el tipo de cosa que rompe el desplazamiento con el dedo. */
  .content-wrap.compact .sheet-header {
    padding: 2px 22px 10px;
    text-align: left;
    touch-action: auto;
  }

  .compact-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .compact-icon {
    display: flex;
    flex-shrink: 0;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.45));
  }

  .compact-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .compact-title {
    font-family: var(--font-heading);
    font-size: 19px;
    letter-spacing: 0.01em;
    color: #eafff5;
  }

  .compact-sub {
    font-size: 11.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(234, 255, 245, 0.6);
  }

  .sheet-header h2 {
    font-family: var(--font-heading);
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

  /* Visualmente oculto, pero presente para lectores de pantalla — patrón
     estándar; el placeholder ya comunica el propósito a la vista. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ---------- Casilleros: buscador por número ---------- */
  .locker-search {
    position: relative;
    margin: 0 22px 10px;
  }
  .locker-search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 15px;
    height: 15px;
    color: rgba(238, 244, 251, 0.45);
    pointer-events: none;
  }
  .locker-search-input {
    width: 100%;
    padding: 10px 12px 10px 34px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 13px;
  }
  .locker-search-input::placeholder {
    color: rgba(238, 244, 251, 0.4);
  }
  .locker-search-input:focus {
    outline: none;
    border-color: var(--sheet-accent);
  }
  /* Safari/iOS agrega su propio botón de limpiar en type="search" con un
     tamaño distinto al resto del input — se deja el nativo (gratis, ya
     accesible) en vez de reinventar uno con JS. */
  .locker-search-input::-webkit-search-cancel-button {
    filter: invert(0.7);
  }

  /* Explica el salto de numeración (libres primero) en vez de dejar que
     se lea como un bug — spans las 3 columnas del grid. */
  .grid-divider {
    grid-column: 1 / -1;
    margin: 4px 0 -2px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 10.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: rgba(238, 244, 251, 0.45);
  }

  /* ---------- Casilleros: filtro por zona ---------- */
  .zone-bar {
    padding: 2px 0 10px;
  }

  .zone-chips {
    display: flex;
    gap: 7px;
    overflow-x: auto;
    padding: 2px 22px 6px;
    scrollbar-width: none;
  }
  .zone-chips::-webkit-scrollbar {
    display: none;
  }

  .zone-chip {
    flex: 0 0 auto;
    /* 44px = mínimo de objetivo táctil (WCAG 2.5.5). Las zonas son de una
       sola letra, así que sin este mínimo quedarían chips diminutos
       imposibles de acertar con el pulgar. */
    min-width: 44px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(238, 244, 251, 0.75);
    font-family: var(--font-heading, sans-serif);
    font-size: 13px;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .zone-chip.active {
    background: var(--sheet-accent);
    border-color: var(--sheet-accent);
    color: #07130f;
    font-weight: 700;
  }

  @media (hover: hover) and (pointer: fine) {
    .zone-chip:not(.active):hover {
      background: rgba(255, 255, 255, 0.1);
      color: #eef4fb;
    }
  }

  .zone-count {
    margin: 0;
    padding: 0 22px;
    font-size: 12.5px;
    color: rgba(238, 244, 251, 0.62);
  }
  .zone-count strong {
    color: var(--sheet-accent);
    font-size: 14px;
  }

  .locker-price-note {
    margin: 6px 0 0;
    padding: 0 22px;
    font-size: 12.5px;
    color: rgba(238, 244, 251, 0.7);
  }
  .locker-price-note strong {
    color: var(--sheet-accent);
    font-size: 14px;
  }
  .price-discount {
    display: block;
    font-size: 11.5px;
    color: var(--sheet-accent);
    opacity: 0.85;
  }

  .locker-legend {
    list-style: none;
    margin: 10px 0 0;
    padding: 0 22px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 11.5px;
    color: rgba(238, 244, 251, 0.6);
  }
  .locker-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .legend-dot {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .legend-free {
    background: var(--sheet-accent);
  }
  .legend-taken {
    background: rgba(255, 255, 255, 0.22);
  }
  /* Mismo tratamiento con borde punteado que .status-reserved en la
     grilla — la muestra tiene que verse como lo que representa, no solo
     un color más de la lista. */
  .legend-reserved {
    background: transparent;
    border: 1.5px dashed rgba(255, 255, 255, 0.4);
  }
  .legend-mine {
    background: var(--sheet-accent);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
  }

  .retry-btn {
    margin-left: 8px;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  /* ---------- Casilleros: grid ---------- */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 8px 22px 40px;
  }

  .unit {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 6px;
    border-radius: 18px;
    /* Degradado por posición (--unit-hue, calculado en unitHue()) — un
       tramo de tono distinto cada ~30 casilleros, no un color plano
       repetido en los 108. Solo se nota en los disponibles (ver .dim
       abajo, que lo apaga a propósito — un casillero ocupado no debe
       competir visualmente por atención con uno libre). */
    background: linear-gradient(
      145deg,
      hsla(var(--unit-hue), 70%, 55%, 0.16),
      hsla(var(--unit-hue), 70%, 55%, 0.05)
    );
    border: 1px solid hsla(var(--unit-hue), 70%, 60%, 0.28);
    transition:
      transform 0.2s ease,
      border-color 0.2s ease,
      box-shadow 0.2s ease;
    /* .unit ahora es un <button> (antes era un <div> decorativo) — reset de
       estilos nativos de botón para que siga viéndose igual que antes. */
    font: inherit;
    color: inherit;
    cursor: pointer;
    width: 100%;
    /* Entrada escalonada — animation-delay viene inline por unidad
       (unitDelay() en el script), así que los 108 no aparecen todos de
       golpe sino en una ola rápida de izquierda a derecha, arriba a abajo. */
    opacity: 0;
    animation: unit-enter 0.45s ease-out forwards;
  }

  /* Entrada orgánica en móvil: la ola vuelve, pero MUY corta. Antes el
     escalonado llegaba a ~950ms para los 108 (se leía como app lenta);
     ahora el retardo se corta a 220ms como máximo, así que la grilla
     entera termina de aparecer en ~0.5s. El movimiento se siente vivo sin
     hacer esperar — que era el equilibrio que faltaba. */
  .content-wrap.compact .unit {
    opacity: 0;
    animation: unit-materialize 0.42s cubic-bezier(0.18, 0.9, 0.24, 1.08) forwards;
    animation-delay: calc(var(--unit-i, 0) * 14ms);
  }

  /* Materializar, no solo aparecer: entra desde un poco abajo, con un
     apagado de brillo que sube — como algo que se enciende, no como algo
     que se desliza. El cubic-bezier con rebote leve (1.08) es lo que le da
     el carácter orgánico frente a un ease lineal. */
  @keyframes unit-materialize {
    0% {
      opacity: 0;
      transform: translateY(10px) scale(0.9);
      filter: brightness(0.4);
    }
    60% {
      filter: brightness(1.25);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: brightness(1);
    }
  }

  /* Respiración lenta y muy sutil en los libres — el "latido" retrofuturista
     de un sistema encendido. 4s y una variación mínima de brillo: se
     percibe de reojo, nunca compite con la lectura. */
  .content-wrap.compact .unit:not(.dim) {
    animation:
      unit-materialize 0.42s cubic-bezier(0.18, 0.9, 0.24, 1.08) forwards,
      unit-breathe 4s ease-in-out 1.2s infinite;
  }

  @keyframes unit-breathe {
    0%,
    100% {
      box-shadow: 0 0 14px hsla(var(--unit-hue), 75%, 60%, 0.18);
    }
    50% {
      box-shadow: 0 0 20px hsla(var(--unit-hue), 75%, 62%, 0.3);
    }
  }

  /* Entrada en cascada para TODAS las listas de contenido (eventos,
     recursos, tiers, emprendimientos) — antes solo los casilleros se
     animaban y el resto de secciones aparecía de golpe, estático. Misma
     curva con rebote leve que los casilleros, para que la app se sienta de
     una sola pieza. 45ms por elemento: en listas de 4-6 todo termina en
     ~0.5s, sin hacer esperar. */
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

  /* ---------- Esqueleto de carga (retrofuturista) ---------- */
  .grid-hidden {
    display: none;
  }

  .unit-skeleton {
    position: relative;
    height: 118px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(var(--sheet-hue, 160), 100%, 70%, 0.1);
    overflow: hidden;
  }

  /* Barrido de luz que recorre cada celda — el retardo por celda
     (--skel-delay, inline) hace que la luz viaje en cascada por la grilla
     en vez de parpadear todo a la vez: se lee como un escaneo. */
  .unit-skeleton::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      105deg,
      transparent 30%,
      var(--sheet-accent) 50%,
      transparent 70%
    );
    opacity: 0.14;
    transform: translateX(-100%);
    animation: skel-scan 1.6s ease-in-out infinite;
    animation-delay: var(--skel-delay, 0ms);
  }

  @keyframes skel-scan {
    to {
      transform: translateX(100%);
    }
  }

  .loading-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 0;
    padding: 0 22px 10px;
    font-size: 12.5px;
    letter-spacing: 0.04em;
    color: rgba(238, 244, 251, 0.6);
  }

  .loading-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sheet-accent);
    animation: dot-pulse 1.1s ease-in-out infinite;
  }

  @keyframes dot-pulse {
    0%,
    100% {
      opacity: 0.25;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
      box-shadow: 0 0 10px var(--sheet-accent);
    }
  }

  /* ACCESIBILIDAD — todo lo de arriba es decorativo: con el sistema
     pidiendo menos movimiento, cada pieza queda en su estado final legible
     y quieta. Nada de la información depende de la animación. */
  @media (prefers-reduced-motion: reduce) {
    .content-wrap.compact .unit,
    .content-wrap.compact .unit:not(.dim) {
      opacity: 1;
      animation: none;
      transform: none;
      filter: none;
    }
    .unit-skeleton::after,
    .loading-dot {
      animation: none;
    }
  }

  @keyframes unit-enter {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Brillo permanente y barato para "disponible" — box-shadow en el
     BOTÓN, no filter/drop-shadow sobre la foto de adentro (ver comentario
     en IsoIcon.svelte: eso volvía a ser caro con locker-mini.png por su
     borde alfa disperso tipo halftone, a diferencia del cubo SVG de antes). */
  .unit:not(.dim) {
    box-shadow: 0 0 14px hsla(var(--unit-hue), 75%, 60%, 0.18);
  }

  @media (hover: hover) and (pointer: fine) {
    .unit:hover:not(:disabled) {
      border-color: hsla(var(--unit-hue), 75%, 65%, 0.55);
      box-shadow: 0 0 16px hsla(var(--unit-hue), 75%, 60%, 0.25);
    }
  }

  .unit:active {
    transform: scale(0.95);
  }

  .unit.dim {
    background: rgba(0, 0, 0, 0.18);
    border-color: rgba(255, 255, 255, 0.08);
  }
  @media (hover: hover) and (pointer: fine) {
    .unit.dim:hover {
      box-shadow: none;
    }
  }

  .unit-lock {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.55);
    pointer-events: none;
  }

  .unit-lock svg {
    width: 11px;
    height: 11px;
  }

  /* Casillero propio ya confirmado — el borde fijo (sin pulso, no hay
     ninguna acción urgente pendiente) y el check reemplazan al candado
     para que se note al toque que es "tuyo", no solo "ocupado". */
  .unit.mine-rented {
    border-color: var(--accent);
  }

  .unit-check {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: #0a1a12;
    pointer-events: none;
  }

  .unit-check svg {
    width: 12px;
    height: 12px;
  }

  .status-mine {
    color: #0a1a12;
    background: var(--accent);
    animation: mine-status-pulse 1.8s ease-in-out infinite;
  }

  @keyframes mine-status-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .unit {
      animation: none;
      opacity: 1;
    }
  }

  .unit:disabled {
    cursor: not-allowed;
  }

  .fetch-error {
    margin: 0 22px 10px;
    font-size: 12.5px;
    color: #ff8a8a;
  }

  .unit-number {
    font-family: var(--font-heading);
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

  /* "Toca para alquilar" es la llamada a la acción de toda la pantalla,
     pero se perdía entre las hasta 108 tarjetas: el CONTRASTE de color ya
     era altísimo (10.4:1, tinta oscura sobre el acento — medido, no a
     ojo), lo que fallaba era el TAMAÑO. A 10px en mayúsculas y con mucho
     espaciado entre letras se leía diminuto en pantalla de escritorio,
     así que no se notaba que era una invitación a tocar. Sube de peso y
     tamaño, y baja el espaciado, solo en el estado disponible — ocupado y
     reservado siguen discretos a propósito: no hay nada que hacer ahí. */
  .status-available {
    color: #0a1a12;
    background: var(--accent);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 3px 10px;
    box-shadow: 0 0 12px var(--sheet-glow);
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
    transition:
      border-color 0.15s ease,
      transform 0.15s ease,
      background 0.15s ease;
  }
  /* Gateado a (hover: hover) — mismo hallazgo que .tier-card/.unit: sin
     esto el primer tap en móvil se "gasta" simulando el estado hover. */
  @media (hover: hover) and (pointer: fine) {
    .repo-card:hover {
      border-color: var(--sheet-accent);
      background: rgba(255, 255, 255, 0.07);
      transform: translateY(-1px);
    }
  }

  .repo-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Reemplaza al punto de color plano que había antes — un ícono por tag
     (Hardware/Infraestructura/Electrónica/Material, ver resourceIcon en
     el script) dice de un vistazo qué tipo de recurso es cada tarjeta. */
  .repo-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 9px;
    background: linear-gradient(155deg, var(--sheet-glow), transparent 70%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--sheet-accent);
  }

  .repo-icon svg {
    width: 17px;
    height: 17px;
  }

  .repo-name {
    margin: 0;
    font-family: var(--font-heading);
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

  /* ---------- Aportaciones: tiers ---------- */
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
  /* Gateado a (hover: hover) — mismo hallazgo de .unit:hover /
     .accessible-item:hover: sin esto, el primer tap en móvil se
     "gasta" simulando este estado y hace falta un segundo tap real. */
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

  /* La tarjeta ya era un botón, pero nada lo decía: sin una llamada a la
     acción visible había que adivinar que tocarla hacía algo. */
  .tier-cta {
    display: inline-block;
    margin-top: 12px;
    font-family: var(--font-heading, sans-serif);
    font-size: 12.5px;
    letter-spacing: 0.03em;
    color: var(--sheet-accent);
  }

  /* ---------- Eventos: el próximo se anuncia ---------- */
  .event-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
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

  /* El próximo evento se destaca con el ACENTO en su fecha, no con un
     fondo sobre la fila entera.
     Antes esto pintaba el fondo de todo el grid (columna de fecha + línea
     de tiempo incluidas) con border-radius y sin relleno propio: se veía
     una caja con el texto pegado arriba y un hueco enorme debajo, porque
     el .event-body lleva 26px de padding inferior para separar los hitos
     de la línea. Se veía desalineado y roto.
     Colorear la fecha no toca la maquetación en absoluto — y en una línea
     de tiempo la fecha es justo el dato que uno busca. */
  .event-row.event-next .event-day {
    color: var(--sheet-accent);
    text-shadow: 0 0 12px var(--sheet-glow);
  }

  .event-row.event-next .event-month {
    color: var(--sheet-accent);
    opacity: 0.85;
  }

  /* ---------- Recursos: barra de ocupación ---------- */
  .repo-gauge {
    position: relative;
    height: 8px;
    margin: 10px 0 2px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }

  .repo-gauge-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--pct, 0%);
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--sheet-accent),
      color-mix(in srgb, var(--sheet-accent) 55%, white)
    );
    /* Brillo sutil en la punta — la barra ya no se lee como un adorno
       plano, se lee como algo con energía real detrás. */
    box-shadow: 0 0 10px var(--sheet-glow);
    /* Crece desde cero al entrar — el movimiento comunica "esto es una
       cantidad", no un adorno fijo. */
    transform-origin: left;
    animation: gauge-grow 0.9s cubic-bezier(0.22, 1, 0.28, 1) 0.15s backwards;
  }

  @keyframes gauge-grow {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  .repo-stat-strong {
    color: var(--sheet-accent);
    font-weight: 700;
  }

  @media (prefers-reduced-motion: reduce) {
    .next-dot,
    .repo-gauge-fill {
      animation: none;
    }
    /* El relleno de la barra se anima con scaleX desde 0: sin la
       animación hay que devolverle la escala, o quedaría invisible. */
    .repo-gauge-fill {
      transform: none;
    }
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
    font-family: var(--font-heading);
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

  /* ---------- Emprendimientos: tarjetas de directorio ---------- */

  /* Grilla, no lista de una columna — un directorio se hojea, no se lee de
     corrido; ver también .content-wrap.wide .news-list para la versión
     de escritorio (ya define columnas ahí). En móvil, una columna angosta
     ya es efectivamente una grilla de 1. */
  .venture-grid {
    padding: 8px 16px 40px;
  }

  .venture-card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md, 18px);
    overflow: hidden;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
    /* La variable por tarjeta (--v-hue) es lo que hace que cada categoría
       "sienta" distinta sin escribir una regla CSS por categoría. */
    transition:
      transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 0.22s ease,
      box-shadow 0.22s ease;
  }

  /* :focus-within queda FUERA del media query a propósito — el foco de
     teclado tiene que verse en cualquier dispositivo. Solo el :hover se
     gatea (mismo hallazgo que .unit/.accessible-item/.tier-card: en touch,
     el primer tap se gasta simulando hover). */
  .venture-card:focus-within {
    transform: translateY(-4px);
    border-color: hsl(var(--v-hue) 85% 65% / 0.55);
    box-shadow:
      0 14px 28px -12px hsl(var(--v-hue) 85% 55% / 0.35),
      0 1px 0 rgba(255, 255, 255, 0.06) inset;
  }

  @media (hover: hover) and (pointer: fine) {
    .venture-card:hover {
      transform: translateY(-4px);
      border-color: hsl(var(--v-hue) 85% 65% / 0.55);
      box-shadow:
        0 14px 28px -12px hsl(var(--v-hue) 85% 55% / 0.35),
        0 1px 0 rgba(255, 255, 255, 0.06) inset;
    }
  }

  .venture-media {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
  }

  .venture-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @media (hover: hover) and (pointer: fine) {
    .venture-card:hover .venture-media img {
      transform: scale(1.06);
    }
  }

  /* Scrim de abajo hacia arriba — asegura que la insignia de categoría se
     lea sobre CUALQUIER foto, sin depender de que la imagen sea oscura. */
  .venture-media::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(4, 6, 13, 0) 55%, rgba(4, 6, 13, 0.75) 100%);
    pointer-events: none;
  }

  .venture-media-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-heading);
    font-size: 28px;
    letter-spacing: 0.08em;
    color: hsl(var(--v-hue) 85% 72%);
    background: hsl(var(--v-hue) 60% 18%);
  }

  .venture-badge {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 1;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
    color: hsl(var(--v-hue) 40% 12%);
    background: hsl(var(--v-hue) 85% 68%);
    box-shadow: 0 2px 10px hsl(var(--v-hue) 85% 45% / 0.5);
  }

  .venture-body {
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .venture-name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: 600;
    font-size: 16px;
    line-height: 1.25;
    color: #f4f9ff;
  }

  .venture-desc {
    margin: 0 0 6px;
    font-size: 12.5px;
    line-height: 1.55;
    color: rgba(234, 255, 245, 0.68);
    /* Recorta a 2 líneas — todas las tarjetas de la grilla quedan del
       mismo alto sin importar cuánto haya escrito cada estudiante. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .venture-cta {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 12px;
    border-radius: 999px;
    background: #25d366;
    color: #04150d;
    font-size: 12.5px;
    font-weight: 700;
    text-decoration: none;
    transition:
      filter 0.15s ease,
      transform 0.15s ease;
  }

  /* Verde real de WhatsApp, no el acento de AEIS — "reconocer, no
     recordar": el ojo ya sabe qué hace este botón antes de leer el texto,
     que es exactamente lo que se busca en el paso de mayor fricción del
     flujo (salir de la app a escribir a un desconocido). */
  @media (hover: hover) and (pointer: fine) {
    .venture-cta:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
  }
  .venture-cta:active {
    transform: translateY(0);
    filter: brightness(0.96);
  }

  .wa-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
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

  /* ---------- Seguridad: indicators + 3D risk map ---------- */
  .sec-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 20px 24px;
  }

  /* Oculta visualmente sin destruir el DOM ni el contexto WebGL.
     visibility:hidden + opacity:0 mantiene el layout y permite que
     MapLibre siga vivo; pointer-events:none bloquea la interacción
     accidental mientras el panel no está activo. */
  .sec-panel--hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .sec-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .sec-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .sec-label {
    font-size: 10.5px;
    letter-spacing: 0.04em;
    color: rgba(234, 255, 245, 0.65);
  }

  .sec-value-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 2px;
  }

  .sec-value {
    font-family: var(--font-heading);
    font-size: 22px;
    font-weight: 500;
    color: #eafff5;
  }

  /* Up is bad and down is good for every indicator here (they're all counts
     of harm), so the arrow can carry a fixed valence colour. */
  .sec-trend {
    font-size: 11px;
    line-height: 1;
  }

  .sec-trend.trend-up {
    color: #ef4444;
  }

  .sec-trend.trend-down {
    color: #21e0a0;
  }

  .sec-unit {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.5);
  }

  .sec-note {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.4);
    margin-top: 2px;
  }

  .sec-src-note {
    margin: 2px 0 0;
    font-size: 10.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.45);
  }

  .sec-risk {
    align-self: flex-start;
    margin-top: 6px;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .sec-risk.risk-low {
    color: #0a1a12;
    background: #21e0a0;
  }

  .sec-risk.risk-moderate {
    color: #241c0a;
    background: #f5b942;
  }

  .sec-risk.risk-high {
    color: #2a0a0a;
    background: #ef4444;
  }

  .sec-source {
    font-size: 11px;
    color: var(--sheet-accent);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
    align-self: flex-start;
    opacity: 0.85;
  }

  .sec-map-frame {
    position: relative;
    width: 100%;
    height: 260px;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.25);
  }

  /* Overlay de carga encima del mapa: cubre el WebGL mientras inicializa
     y hace fade-out suave cuando el mapa dispara su evento 'load'. */
  .sec-map-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 16px;
    background: rgba(4, 6, 13, 0.88);
    color: var(--sheet-accent);
    font-family: var(--font-heading);
    font-size: 13px;
    letter-spacing: 0.04em;
    pointer-events: none;
    transition: opacity 0.55s ease;
    opacity: 1;
  }

  .sec-map-overlay--hidden {
    opacity: 0;
  }

  .sec-map-cta {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 16px;
    border: 1px dashed var(--line-strong);
    background: rgba(255, 255, 255, 0.04);
    color: var(--sheet-accent);
    font-family: var(--font-heading);
    font-size: 13px;
    letter-spacing: 0.04em;
  }

  .sec-map-icon {
    font-size: 22px;
  }

  .sec-map-icon.spin {
    animation: sec-spin 1.1s linear infinite;
  }

  @keyframes sec-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
