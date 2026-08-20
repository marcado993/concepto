<script lang="ts">
  import IsoIcon from "./IsoIcon.svelte";
  import type { Category, LockerStatus } from "./data";

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
    /** La reserva propia (por transferencia) que sigue esperando comprobante,
        si hay una — deja tocar ESE casillero puntual para resubir la foto
        aunque su estado sea RESERVED. Verificado por el backend contra la
        sesión real, nunca asumido acá. */
    myPendingReceipt?: { rentalId: string; lockerCode: string } | null;
    /** El casillero que el estudiante ya tiene CONFIRMADO este periodo, si
        hay uno — deja distinguirlo en la grilla y tocarlo para ver su
        estado, en vez de que lo busque entre hasta 108. */
    myRentedLocker?: { lockerCode: string; zone: string } | null;
    /** Desktop full-screen layout: let grids breathe into more columns. */
    wide?: boolean;
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
    myPendingReceipt = null,
    myRentedLocker = null,
    wide = false,
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
  import RentLockerModal from "./RentLockerModal.svelte";
  import MyLockerStatusModal from "./MyLockerStatusModal.svelte";
  import SubscribeModal from "./SubscribeModal.svelte";
  import type { SubscriptionBenefit } from "./data";

  let rentingLockerCode = $state<string | null>(null);
  // Distinto de null solo cuando se toca el casillero de TU PROPIA reserva
  // pendiente (myPendingReceipt) — le dice a RentLockerModal que salte
  // directo al paso de subir el comprobante en vez de empezar un alquiler
  // nuevo desde cero.
  let resumeRentalId = $state<string | null>(null);
  // Casillero propio confirmado que se está viendo (solo lectura) — no es
  // lo mismo que rentingLockerCode/RentLockerModal: acá no hay nada que
  // alquilar ni confirmar, solo el estado de lo que ya es tuyo.
  let viewingMyLocker = $state<{ lockerCode: string; zone: string } | null>(null);
  let subscribingTier = $state<{ name: string; amount: string } | null>(null);

  // "descuento_casillero" con percent:0 no se muestra como "0% de
  // descuento" — un beneficio sin efecto real es ruido, no información.
  // `included` (ej. acceso_ps4) se muestra como línea aparte, sin número.
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

  let mapReady = $state(false);

  // El resize del mapa al abrirse el sheet ya lo cubre el ResizeObserver
  // propio de SecurityMap.svelte (observa el contenedor real). Antes acá
  // se despachaba además un `window.dispatchEvent(new Event("resize"))`
  // global 420ms después — no solo era redundante (hasta 3 llamadas a
  // `map.resize()`, cada una recrea framebuffers), sino que ese evento
  // global también re-disparaba cualquier OTRO listener de resize de la
  // app, no solo el del mapa (hallazgo de auditoría de rendimiento móvil).

  const isSecurityActive = $derived(category.id === "security");
  const isLockersActive = $derived(category.id === "lockers");

  // Una sola vez true, nunca vuelve a false — a propósito no es
  // `isSecurityActive` directo. `{#if isSecurityActive}` desmontaba
  // <SecurityMapComp> cada vez que se navegaba fuera de Seguridad (pese a
  // que el comentario del panel decía lo contrario), lo que disparaba un
  // fetch nuevo a /security/map-data y un setData() completo del heatmap
  // (~500 puntos re-tesselados en GPU) en cada visita, no solo la primera
  // (hallazgo de auditoría de rendimiento móvil). Con este flag, el mapa
  // sigue sin montarse para quien nunca abre Seguridad, pero una vez
  // montado queda montado — igual que ya pasa con Casilleros.
  let hasOpenedSecurity = $state(false);
  $effect(() => {
    if (isSecurityActive) hasOpenedSecurity = true;
  });

  const riskLabel: Record<"low" | "moderate" | "high", string> = {
    low: "Bajo",
    moderate: "Moderado",
    high: "Alto",
  };

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

  // Un tono por categoría, no una paleta fija a mano — el estudiante que
  // sube un emprendimiento puede escribir cualquier texto en "categoría",
  // así que un mapa hardcodeado ("Alimentos" → naranja) se rompería con la
  // primera categoría nueva. Un hash determinístico da el mismo color
  // siempre para la misma palabra, sin mantenimiento, y sigue cumpliendo
  // el objetivo real: que el ojo agrupe tarjetas de la misma categoría por
  // color al escanear la grilla (categorización rápida, efecto Von
  // Restorff — una grilla monocroma se vuelve ruido visual).
  function categoryHue(category: string): number {
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = (hash * 31 + category.charCodeAt(i)) % 360;
    }
    return hash;
  }

  // Degradado a lo largo de la grilla de casilleros — un tono por
  // posición en vez de un color plano fijo. Recorre un arco de tono cada
  // ~30 casilleros (108 ÷ 30 ≈ 3.6 tramos), anclado cerca del teal de
  // acento de la app (~160°) para que nunca desentone con el resto de la UI.
  function unitHue(index: number): number {
    const withinBand = (index % 30) / 30; // 0..1 dentro del tramo de 30
    const band = Math.floor(index / 30); // qué tramo de 30 le toca
    return (160 + band * 55 + withinBand * 40) % 360;
  }

  // Entrada escalonada — cada casillero aparece un poco después que el
  // anterior, con techo para que el número 108 no tarde una eternidad.
  function unitDelay(index: number): number {
    return Math.min(index * 12, 500);
  }

  // Pedido real: que los reservados/ocupados se hundan al final y solo los
  // libres (y los tuyos — pendiente o ya alquilado, que sí puedes tocar)
  // queden arriba, en vez de mezclados entre hasta 108. Se ordena por
  // "prioridad" (0 = arriba) y a igualdad de prioridad se respeta el orden
  // original (número de casillero), así el resultado no salta de forma
  // rara entre refrescos.
  function unitPriority(unit: { status: LockerStatus; number: string }): number {
    if (unit.status === "available") return 0;
    if (myPendingReceipt?.lockerCode === unit.number || myRentedLocker?.lockerCode === unit.number) return 0;
    return 1;
  }
  const sortedLockers = $derived(
    [...(lockersCategory?.lockers ?? [])].sort((a, b) => unitPriority(a) - unitPriority(b))
  );

  // Filtro por zona — el hallazgo de usabilidad más grande de esta
  // sección: son 12 zonas (A–L) de 9 casilleros = 108, y la zona es una
  // UBICACIÓN FÍSICA real en el edificio. Un estudiante no quiere "un
  // casillero cualquiera", quiere uno cerca de donde tiene clases, y
  // antes tenía que recorrer las 108 tarjetas a mano para encontrarlo
  // (correspondencia con el mundo real + reconocer en vez de recordar).
  let zoneFilter = $state<string | null>(null);
  const zones = $derived(
    [...new Set((lockersCategory?.lockers ?? []).map((u) => u.zone))].sort()
  );
  const visibleLockers = $derived(
    zoneFilter ? sortedLockers.filter((u) => u.zone === zoneFilter) : sortedLockers
  );
  // Visibilidad del estado del sistema: sin esto no había forma de saber
  // "¿queda algo libre?" sin escanear la grilla entera a ojo.
  const availableCount = $derived(visibleLockers.filter((u) => u.status === "available").length);

  const theme = $derived(category.theme);
  const wrapStyle = $derived(
    `--sheet-accent: ${theme.accent}; --sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep}; --sheet-glow: ${theme.glow}; --sheet-hue: ${theme.hue}deg;`
  );
</script>

<div class="content-wrap" class:wide style={wrapStyle}>
  <header
    class="sheet-header"
    onpointerdown={onheaderpointerdown}
    onpointermove={onheaderpointermove}
    onpointerup={onheaderpointerup}
    onpointercancel={onheaderpointerup}
  >
    <h2>{category.label}</h2>
    <div class="icon-cluster">
      <IsoIcon kind={category.icon} size={128} priority />
    </div>
    <p class="sheet-sub">{category.detailTitle}</p>
  </header>

  <div class="sheet-body">
    {#if category.id === "events" && category.events}
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
    {:else if category.id === "subscriptions" && category.tiers}
      {#if subscriptionTiersError}
        <p class="fetch-error">No se pudo cargar la disponibilidad real de aportaciones — intenta más tarde.</p>
      {/if}
      <div class="tier-list">
        {#each category.tiers as tier (tier.id)}
          <button class="tier-card" onclick={() => (subscribingTier = { name: tier.name, amount: tier.amount })}>
            <div class="tier-head">
              <h3 class="tier-name">{tier.name}</h3>
              <span class="tier-price">${tier.amount}</span>
            </div>
            <ul class="tier-benefits">
              {#each tier.benefits as b}
                {@const label = formatBenefit(b)}
                {#if label}<li>{label}</li>{/if}
              {/each}
            </ul>
          </button>
        {/each}
      </div>
    {:else if category.id === "community"}
      <!-- "Comunidad" reemplazado por Emprendimientos — vitrina +
           contacto WhatsApp, sin chat propio (docs/dominio/
           01-analisis-negocio-mision.md §4). El id interno se queda como
           "community" a propósito: renombrarlo tocaría IconKind/ArcMenu/
           IsoIcon sin necesidad real, cuando lo único que cambió es el
           contenido, no la mecánica de navegación. -->
      <div class="news-list venture-grid">
        {#if category.ventures}
          {#each category.ventures as v (v.id)}
            <article class="venture-card" style="--v-hue: {categoryHue(v.category)}">
              <div class="venture-media">
                {#if v.photoUrl}
                  <img src={v.photoUrl} alt={v.name} loading="lazy" />
                {:else}
                  <div class="venture-media-fallback">{initials(v.name)}</div>
                {/if}
                <span class="venture-badge">{v.category}</span>
              </div>
              <div class="venture-body">
                <h3 class="venture-name">{v.name}</h3>
                <p class="venture-desc">{v.description}</p>
                <a class="venture-cta" href={v.whatsappLink} target="_blank" rel="noreferrer">
                  <svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.06-1.36A10 10 0 1 0 12 2Zm0 18.2a8.15 8.15 0 0 1-4.16-1.14l-.3-.18-3 .8.8-2.93-.2-.31A8.2 8.2 0 1 1 12 20.2Zm4.5-6.13c-.24-.12-1.44-.71-1.66-.8-.22-.08-.38-.12-.55.12-.16.24-.63.8-.77.96-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.18-.71-.63-1.19-1.42-1.33-1.66-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z"
                    />
                  </svg>
                  Escribir por WhatsApp
                </a>
              </div>
            </article>
          {/each}
          {#if category.ventures.length === 0}
            <p class="sec-note">Todavía no hay emprendimientos aprobados en el directorio.</p>
          {/if}
        {:else if venturesError}
          <p class="sec-note">No se pudo cargar el directorio de emprendimientos.</p>
        {:else}
          <p class="sec-note">Cargando emprendimientos…</p>
        {/if}
      </div>
    {/if}

    <!-- Casilleros tampoco está en la cadena {#if/:else if} de arriba, por
         la misma razón que Seguridad (ver comentario debajo): es la
         sección más pesada (hasta 108 unidades, cada una con su propio
         IsoIcon SVG animado) y antes se destruía/reconstruía por completo
         — con las 108 animaciones de entrada volviendo a dispararse — cada
         vez que el usuario navegaba a otra categoría y regresaba. Ahora se
         monta una sola vez y solo se oculta con `display: none`. -->
    {#if lockersCategory}
      <div class="lockers-panel" style:display={isLockersActive ? "block" : "none"}>
        {#if lockersError}
          <p class="fetch-error">No se pudo cargar la disponibilidad real de casilleros — intenta más tarde.</p>
        {/if}

        {#if zones.length > 1}
          <div class="zone-bar">
            <div class="zone-chips" role="group" aria-label="Filtrar por zona">
              <button class="zone-chip" class:active={zoneFilter === null} onclick={() => (zoneFilter = null)}>
                Todas
              </button>
              {#each zones as z (z)}
                <button class="zone-chip" class:active={zoneFilter === z} onclick={() => (zoneFilter = z)}>
                  {z}
                </button>
              {/each}
            </div>
            <!-- aria-live: al cambiar de zona el conteo se actualiza sin
                 recargar nada; sin esto un lector de pantalla no anuncia
                 que el resultado del filtro cambió. -->
            <p class="zone-count" aria-live="polite">
              {#if availableCount === 0}
                Sin casilleros libres {zoneFilter ? `en la zona ${zoneFilter}` : "por ahora"}
              {:else}
                <strong>{availableCount}</strong>
                {availableCount === 1 ? "libre" : "libres"}
                {zoneFilter ? `en la zona ${zoneFilter}` : `de ${visibleLockers.length}`}
              {/if}
            </p>
          </div>
        {/if}

        <div class="grid">
          {#each visibleLockers as unit, i (unit.id)}
            {@const isMine = myPendingReceipt?.lockerCode === unit.number}
            {@const isMineRented = myRentedLocker?.lockerCode === unit.number}
            {@const clickable = unit.status === "available" || isMine || isMineRented}
            <button
              class="unit"
              class:dim={unit.status !== "available" && !isMine && !isMineRented}
              class:mine-pending={isMine}
              class:mine-rented={isMineRented}
              disabled={!clickable}
              onclick={() => {
                if (isMineRented) {
                  viewingMyLocker = myRentedLocker;
                  return;
                }
                resumeRentalId = isMine ? (myPendingReceipt?.rentalId ?? null) : null;
                rentingLockerCode = unit.number;
              }}
              aria-label={isMineRented
                ? `Ver estado de tu casillero ${unit.number}`
                : isMine
                  ? `Resubir comprobante del casillero ${unit.number}`
                  : `Alquilar casillero ${unit.number}`}
              style="--unit-hue: {unitHue(i)}; animation-delay: {unitDelay(i)}ms"
            >
              {#if isMineRented}
                <!-- Casillero propio ya confirmado — pedido real: en vez de
                     buscarlo entre hasta 108, se distingue con su propio
                     ícono (check, no candado/upload) y se puede tocar para
                     ver el estado directamente. -->
                <span class="unit-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="m9.55 17.55-5.7-5.7 1.425-1.425L9.55 14.7l9.175-9.175L20.15 6.95Z"
                    />
                  </svg>
                </span>
              {:else if isMine}
                <!-- Solo TU reserva pendiente se ve así — verificado por el
                     backend contra tu sesión, nunca por algo que este
                     cliente decida. El resto de los reservados/ocupados
                     sigue con el candado normal, sin poder tocarse. -->
                <span class="unit-upload" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M11 16V7.85l-2.6 2.6L7 9l5-5 5 5-1.4 1.45-2.6-2.6V16Zm-5 4q-.825 0-1.413-.588T4 18v-3h2v3h12v-3h2v3q0 .825-.588 1.413T18 20Z"
                    />
                  </svg>
                </span>
              {:else if unit.status !== "available"}
                <!-- El texto "Ocupado"/"Reservado" ya distingue el estado
                     exacto, pero a 10px y entre hasta 108 unidades es fácil
                     de pasar por alto en un vistazo rápido — un candado en
                     la esquina se reconoce sin tener que leer nada,
                     apoyándose en el mismo principio que ya usa .dim
                     (reconocimiento en vez de recuerdo). -->
                <span class="unit-lock" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M6 22q-.825 0-1.413-.588T4 20V10q0-.825.588-1.413T6 8h1V6q0-2.075 1.463-3.538T12 1t3.538 1.463T17 6v2h1q.825 0 1.413.588T20 10v10q0 .825-.588 1.413T18 22zm6-5q.825 0 1.413-.588T14 15t-.588-1.413T12 13t-1.413.588T10 15t.588 1.413T12 17M9 8h6V6q0-1.25-.875-2.125T12 3t-2.125.875T9 6z"
                    />
                  </svg>
                </span>
              {/if}
              <IsoIcon unit status={unit.status} size={64} />
              <span class="unit-number">{unit.number}</span>
              <span class="unit-status status-{unit.status}" class:status-mine={isMine || isMineRented}>
                {isMineRented ? "Es tuyo — toca para ver" : isMine ? "Sube tu comprobante" : statusLabel[unit.status]}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Seguridad is NOT in the {#if/:else if} chain above on purpose. It's
         keyed off `securityCategory` — a reference that stays the same
         object whether or not Seguridad is the active section — and only
         hidden with CSS `display: none` while another category shows.
         Branching it like the others (`{:else if category.id === ...}`)
         would tear the whole block down, including the mounted
         <SecurityMapComp>, every single time you navigated away — which
         meant every return trip paid for a brand-new WebGL context plus a
         fresh style/sprite/glyph/tile fetch from a third-party host. On
         localhost that round trip is near-zero; on a real deploy it reads
         as the module hanging for a second on every visit. -->
    {#if securityCategory}
      <!--
        SecurityMap monta/desmonta cuando el usuario navega a/desde Seguridad.
        Con el Map Singleton (mapWarm.ts), el costo es solo un movimiento de DOM
        — no new Map(), no workers. El mapa ya estaba cálido desde el splash.

        `security` (los 6 indicadores) ahora se pide al backend de forma
        asíncrona (App.svelte, fetchSecurityIndicators) — a propósito NO se
        usa como condición de este panel: si se gatilla en `.security`, el
        mapa entero desaparece mientras carga o si el backend no responde.
        El mapa se mantiene siempre montado; solo la grilla de indicadores
        de abajo tiene su propio estado de carga/error.
      -->
      <div class="sec-panel" style:display={isSecurityActive ? "flex" : "none"}>
        <div class="sec-map-frame">
          <!-- Overlay fade-out cuando mapReady=true -->
          <div class="sec-map-overlay" class:sec-map-overlay--hidden={mapReady}>
            <span class="sec-map-icon spin">◎</span>
            cargando mapa 3d…
          </div>
          {#if hasOpenedSecurity}
            {#await securityMapModule then { default: SecurityMapComp }}
              <SecurityMapComp
                risk={securityRisk}
                accent={securityCategory.theme.accent}
                onready={() => (mapReady = true)}
              />
            {/await}
          {/if}
        </div>

        <div class="sec-grid">
          {#if securityCategory.security}
            {#each securityCategory.security as ind (ind.id)}
              <div class="sec-card">
                <span class="sec-label">{ind.label}</span>
                <span class="sec-value-row">
                  <span class="sec-value">{ind.value}</span>
                  {#if ind.trend && ind.trend !== "flat"}
                    <span class="sec-trend trend-{ind.trend}">{ind.trend === "up" ? "▲" : "▼"}</span>
                  {/if}
                </span>
                <span class="sec-unit">{ind.unit}</span>
                {#if ind.note}<span class="sec-note">{ind.note}</span>{/if}
                <span class="sec-risk risk-{ind.risk}">{riskLabel[ind.risk]}</span>
              </div>
            {/each}
          {:else if securityIndicatorsError}
            <p class="sec-note">No se pudieron cargar los indicadores del backend.</p>
          {:else}
            <p class="sec-note">Cargando indicadores…</p>
          {/if}
        </div>

        <p class="sec-src-note">
          Distrito Metropolitano de Quito · cierre 2025. Fuente: Observatorio Metropolitano de Seguridad
          Ciudadana (Policía Nacional y Fiscalía).
        </p>
        <a class="sec-source" href="https://observatorioseguridad.quito.gob.ec" target="_blank" rel="noreferrer">
          Cifras oficiales actualizadas → observatorioseguridad.quito.gob.ec
        </a>
      </div>
    {/if}

  </div>
</div>

{#if rentingLockerCode}
  <RentLockerModal
    lockerCode={rentingLockerCode}
    {resumeRentalId}
    onclose={() => {
      rentingLockerCode = null;
      resumeRentalId = null;
    }}
    onrented={() => onlockerrented?.()}
  />
{/if}

{#if viewingMyLocker}
  <MyLockerStatusModal
    lockerCode={viewingMyLocker.lockerCode}
    zone={viewingMyLocker.zone}
    onclose={() => (viewingMyLocker = null)}
  />
{/if}

{#if subscribingTier}
  <SubscribeModal
    tierName={subscribingTier.name}
    tierAmount={subscribingTier.amount}
    onclose={() => (subscribingTier = null)}
    onsubscribed={() => onsubscribed?.()}
  />
{/if}

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

  /* Tu reserva pendiente — la única celda RESERVED que sigue siendo
     tocable. Pulso suave en el borde en vez del tratamiento .dim normal,
     para que se note a distancia que hay algo pendiente de tu parte (a
     diferencia de un "ocupado" cualquiera, que no pide ninguna acción). */
  .unit.mine-pending {
    border-color: var(--accent);
    animation: unit-enter 0.45s ease-out forwards, mine-pulse 1.8s ease-in-out infinite 0.5s;
  }

  @keyframes mine-pulse {
    0%,
    100% {
      box-shadow: 0 0 14px hsla(var(--unit-hue), 75%, 60%, 0.18);
    }
    50% {
      box-shadow: 0 0 20px var(--accent-glow, rgba(33, 224, 160, 0.5));
    }
  }

  .unit-upload {
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

  .unit-upload svg {
    width: 12px;
    height: 12px;
  }

  /* Casillero propio ya confirmado — a diferencia de .mine-pending, no
     pide ninguna acción urgente (no hay nada pendiente de subir), así que
     el borde queda fijo en vez de pulsar; el check reemplaza al candado
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
