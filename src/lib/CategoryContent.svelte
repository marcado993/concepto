<script lang="ts">
  // CategoryContent es ahora un thin wrapper — dispatcher hacia los organisms.
  // Toda la lógica de cada sección vive en src/lib/organisms/:
  //   EventsSection       → events/recursos
  //   BenefitsSection     → recursos de la AEIS
  //   SubscriptionsSection → tiers de aportación
  //   JobsSection         → bolsa de empleo (pasantías y vacantes)
  //   CommunitySection    → directorio de emprendimientos (oculto del menú)
  //   LockersSection      → grilla de casilleros (108 unidades)
  //   SecuritySection     → mapa 3D + indicadores de seguridad
  //
  // El bloque de estilos al final de este archivo sigue aquí porque los organisms NO
  // tienen estilos propios: las clases CSS (.sec-panel, .grid, .unit,
  // etc.) son parte del sistema de diseño de esta app y se aplican al DOM
  // independientemente del componente que las emite. Svelte no hace scoping
  // a menos que se use style module, así que no hay pérdida de estilos.

  import IsoIcon from "./IsoIcon.svelte";
  import type { Category } from "./data";
  import EventsSection from "./organisms/EventsSection.svelte";
  import BenefitsSection from "./organisms/BenefitsSection.svelte";
  import SubscriptionsSection from "./organisms/SubscriptionsSection.svelte";
  import CommunitySection from "./organisms/CommunitySection.svelte";
  import JobsSection from "./organisms/JobsSection.svelte";
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
    {:else if category.id === "jobs"}
      <!-- JobsSection pide sus propios datos (a diferencia del resto): el
           listado es filtrable y paginado, y ese estado pertenece a la
           sección, no a App.svelte. -->
      <JobsSection />
    {:else if category.id === "community"}
      <!-- Emprendimientos — OCULTO, no borrado: la categoría salió de
           `categories` en data.ts, así que esta rama ya no se alcanza. Se
           deja cableada a propósito para que volver a mostrarla sea
           reinsertar la entrada allá y nada más. -->
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

  .content-wrap.wide .sheet-header {
    display: none;
  }

  .sheet-header {
    text-align: center;
    padding: 4px 24px 18px;
    flex-shrink: 0;
    touch-action: none;
  }

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
</style>
