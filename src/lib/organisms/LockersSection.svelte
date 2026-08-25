<script lang="ts">
  import IsoIcon from "../IsoIcon.svelte";
  import ErrorBanner from "../atoms/ErrorBanner.svelte";
  import LoadingSpinner from "../atoms/LoadingSpinner.svelte";
  import RentLockerModal from "../RentLockerModal.svelte";
  import MyLockerStatusModal from "../MyLockerStatusModal.svelte";
  import type { Category, LockerStatus } from "../data";
  import { fetchLockerPricePreview, type LockerPricePreview } from "../api";
  import { isAuthenticated } from "../auth.svelte";

  const statusLabel: Record<LockerStatus, string> = {
    available: "Libre",
    occupied: "Ocupado",
    reserved: "Reservado",
  };

  // Degradado a lo largo de la grilla — un tono por posición en vez de
  // un color plano fijo. Recorre un arco de tono cada ~30 casilleros
  // (108 ÷ 30 ≈ 3.6 tramos), anclado cerca del teal de acento (~160°)
  // para que nunca desentone con el resto de la UI.
  function unitHue(index: number): number {
    const withinBand = (index % 30) / 30;
    const band = Math.floor(index / 30);
    return (160 + band * 55 + withinBand * 40) % 360;
  }

  // Entrada escalonada — cada casillero aparece un poco después que el
  // anterior, con techo para que el número 108 no tarde una eternidad.
  function unitDelay(index: number): number {
    return Math.min(index * 12, 500);
  }

  // Pedido real: los reservados/ocupados se hunden al final y solo los
  // libres (y los tuyos) quedan arriba. Se ordena por prioridad y a
  // igualdad se respeta el orden original (número de casillero).
  function unitPriority(unit: { status: LockerStatus; number: string }): number {
    if (unit.status === "available") return 0;
    if (myRentedLocker?.lockerCode === unit.number) return 0;
    return 1;
  }

  interface Props {
    /** La referencia estable de la categoría Casilleros — NO cambia de
        identidad cuando el usuario navega a otra sección. Esto evita que
        la grilla de hasta 108 nodos se destruya y reconstruya en cada
        visita (auditoría de rendimiento móvil). */
    lockersCategory: Category | null;
    myRentedLocker?: { lockerCode: string; zone: string } | null;
    lockersError?: boolean;
    lockersLoading?: boolean;
    isActive: boolean;
    onlockerrented?: () => void;
  }
  let {
    lockersCategory,
    myRentedLocker = null,
    lockersError = false,
    lockersLoading = false,
    isActive,
    onlockerrented,
  }: Props = $props();

  let rentingLockerCode = $state<string | null>(null);
  let viewingMyLocker = $state<{ lockerCode: string; zone: string } | null>(null);

  // Filtro por zona — con 12 zonas (A–L) de 9 casilleros = 108, un
  // estudiante quiere uno cerca de donde tiene clases, no uno cualquiera.
  let zoneFilter = $state<string | null>(null);
  const zones = $derived(
    [...new Set((lockersCategory?.lockers ?? []).map((u) => u.zone))].sort()
  );

  // Buscador por número — coincidencia parcial ("05" encuentra "B05").
  let numberQuery = $state("");

  const sortedLockers = $derived(
    [...(lockersCategory?.lockers ?? [])].sort((a, b) => unitPriority(a) - unitPriority(b))
  );

  const visibleLockers = $derived(
    (zoneFilter ? sortedLockers.filter((u) => u.zone === zoneFilter) : sortedLockers).filter(
      (u) => !numberQuery.trim() || u.number.toLowerCase().includes(numberQuery.trim().toLowerCase())
    )
  );

  // Visibilidad del estado del sistema: sin esto no había forma de saber
  // "¿queda algo libre?" sin escanear la grilla entera a ojo.
  const availableCount = $derived(visibleLockers.filter((u) => u.status === "available").length);

  // Índice del corte entre disponibles (prioridad 0) y tomados (prioridad 1)
  // — hallazgo real de auditoría: el salto de numeración (A01 → A05 → A08)
  // parecía un error de numeración sin este rótulo explicativo.
  const firstTakenIndex = $derived(visibleLockers.findIndex((u) => unitPriority(u) === 1));

  // Precio del casillero antes de entrar al flujo (H10): el backend ya
  // resuelve el descuento de aportante. Silencioso si falla.
  let lockerPrice = $state<LockerPricePreview | null>(null);
  $effect(() => {
    if (!isAuthenticated()) return;
    fetchLockerPricePreview()
      .then((p) => (lockerPrice = p))
      .catch(() => {});
  });
</script>

<!-- display:none en vez de {#if} — mismo razonamiento que el comentario
     original: esto evita destruir/reconstruir la grilla de 108 nodos
     cada vez que el usuario navega fuera de Casilleros y regresa. El
     organism completo sigue montado; solo se oculta visualmente. -->
<div style:display={isActive ? "block" : "none"}>
  {#if lockersCategory}
    <div class="lockers-panel">
      {#if lockersError}
        <!-- H9: antes esto era un callejón sin salida ("intenta más
             tarde" y nada que tocar). Recargar es la única acción que
             de verdad reintenta la carga inicial de datos. -->
        <ErrorBanner
          message="No se pudo cargar la disponibilidad de casilleros."
          retry
        />
      {/if}

      <!-- role="search" + label sr-only: el placeholder comunica el
           propósito a la vista, pero un lector de pantalla necesita
           su propio nombre accesible. -->
      <div class="locker-search" role="search">
        <label for="locker-search-input" class="sr-only">Buscar casillero por número</label>
        <svg class="locker-search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input
          id="locker-search-input"
          class="locker-search-input"
          type="search"
          inputmode="text"
          placeholder="Buscar por número (ej. B05)"
          bind:value={numberQuery}
        />
      </div>

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

      <!-- H10 (ayuda) + H1 (estado): el precio solo aparecía DENTRO del
           modal, o sea que había que empezar el trámite para saber cuánto
           costaba. Acá se ve antes de tocar nada. -->
      {#if lockerPrice}
        <p class="locker-price-note">
          {lockerPrice.period ? `Alquiler del semestre ${lockerPrice.period.label}` : "Alquiler del semestre"}:
          <strong>${lockerPrice.price.PAYPHONE.toFixed(2)}</strong>
          {#if lockerPrice.discountPercent > 0}
            <span class="price-discount">
              −{lockerPrice.discountPercent}% por tu aportación {lockerPrice.tierName}
            </span>
          {/if}
        </p>
      {/if}

      <!-- H6 (reconocer en vez de recordar): antes había que deducir
           qué significaba cada color e ícono de la grilla. -->
      <ul class="locker-legend" aria-label="Qué significa cada estado">
        <li><span class="legend-dot legend-free" aria-hidden="true"></span>Libre — puedes alquilarlo</li>
        <li><span class="legend-dot legend-taken" aria-hidden="true"></span>Ocupado</li>
        <li><span class="legend-dot legend-reserved" aria-hidden="true"></span>Reservado — pago en trámite</li>
        {#if myRentedLocker}
          <li><span class="legend-dot legend-mine" aria-hidden="true"></span>Es tuyo</li>
        {/if}
      </ul>

      {#if lockersLoading}
        <!-- Esqueleto de carga: 12 celdas fantasma con un barrido de luz
             en cascada, como un sistema inicializando. Ocupan el mismo
             espacio que los casilleros reales, así nada salta de sitio. -->
        <div class="grid grid-skeleton" aria-hidden="true">
          {#each Array(12) as _, i}
            <div class="unit-skeleton" style="--skel-delay: {i * 90}ms"></div>
          {/each}
        </div>
        <LoadingSpinner label="Leyendo disponibilidad de casilleros…" />
      {/if}

      <div class="grid" class:grid-hidden={lockersLoading}>
        {#each visibleLockers as unit, i (unit.id)}
          {@const isMineRented = myRentedLocker?.lockerCode === unit.number}
          {@const clickable = unit.status === "available" || isMineRented}
          {#if i === firstTakenIndex && firstTakenIndex > 0}
            <!-- Explica el salto de numeración en vez de dejar que se
                 lea como un bug — hallazgo real de auditoría: sin este
                 rótulo, pasar de "A01" a "A05" parecía un error. -->
            <p class="grid-divider" role="separator">Ocupados y reservados</p>
          {/if}
          <button
            class="unit"
            class:dim={unit.status !== "available" && !isMineRented}
            class:mine-rented={isMineRented}
            disabled={!clickable}
            onclick={() => {
              if (isMineRented) {
                viewingMyLocker = myRentedLocker;
                return;
              }
              rentingLockerCode = unit.number;
            }}
            aria-label={isMineRented
              ? `Ver estado de tu casillero ${unit.number}`
              : `Alquilar casillero ${unit.number}`}
            style="--unit-hue: {unitHue(i)}; --unit-i: {Math.min(i, 16)}; animation-delay: {unitDelay(i)}ms"
          >
            {#if isMineRented}
              <!-- Casillero propio ya confirmado — ícono check, no
                   candado; se puede tocar para ver el estado. -->
              <span class="unit-check" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path fill="currentColor" d="m9.55 17.55-5.7-5.7 1.425-1.425L9.55 14.7l9.175-9.175L20.15 6.95Z" />
                </svg>
              </span>
            {:else if unit.status !== "available"}
              <!-- El candado se reconoce sin tener que leer nada —
                   apoya el mismo principio que .dim. -->
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
            <span class="unit-status status-{unit.status}" class:status-mine={isMineRented}>
              {#if isMineRented}
                Es tuyo — toca para ver
              {:else if unit.status === "available"}
                Toca para alquilar
              {:else}
                {statusLabel[unit.status]}
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if rentingLockerCode}
  <RentLockerModal
    lockerCode={rentingLockerCode}
    onclose={() => (rentingLockerCode = null)}
    onrented={() => onlockerrented?.()}
    ontaken={() => onlockerrented?.()}
  />
{/if}

{#if viewingMyLocker}
  <MyLockerStatusModal
    lockerCode={viewingMyLocker.lockerCode}
    zone={viewingMyLocker.zone}
    onclose={() => (viewingMyLocker = null)}
  />
{/if}

<style>
  /* Visualmente oculto, pero presente para lectores de pantalla */
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
  .locker-search-input::-webkit-search-cancel-button {
    filter: invert(0.7);
  }

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

  :global(.content-wrap.wide) .grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    padding: 20px 28px 40px;
  }

  .unit {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 6px;
    border-radius: 18px;
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
    font: inherit;
    color: inherit;
    cursor: pointer;
    width: 100%;
    opacity: 0;
    animation: unit-enter 0.45s ease-out forwards;
  }

  :global(.content-wrap.compact) .unit {
    opacity: 0;
    animation: unit-materialize 0.42s cubic-bezier(0.18, 0.9, 0.24, 1.08) forwards;
    animation-delay: calc(var(--unit-i, 0) * 14ms);
  }

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

  :global(.content-wrap.compact) .unit:not(.dim) {
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

  /* ---------- Esqueleto de carga ---------- */
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

  @media (prefers-reduced-motion: reduce) {
    :global(.content-wrap.compact) .unit,
    :global(.content-wrap.compact) .unit:not(.dim) {
      opacity: 1;
      animation: none;
      transform: none;
      filter: none;
    }
    .unit-skeleton::after,
    .loading-dot {
      animation: none;
    }
    .unit {
      animation: none;
      opacity: 1;
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

  .unit:not(.dim) {
    box-shadow: 0 0 14px hsla(var(--unit-hue), 75%, 60%, 0.18);
  }

  @media (hover: hover) and (pointer: fine) {
    .unit:hover:not(:disabled) {
      border-color: hsla(var(--unit-hue), 75%, 65%, 0.55);
      box-shadow: 0 0 16px hsla(var(--unit-hue), 75%, 60%, 0.25);
    }
    .unit.dim:hover {
      box-shadow: none;
    }
  }

  .unit:active {
    transform: scale(0.95);
  }

  .unit.dim {
    background: rgba(0, 0, 0, 0.18);
    border-color: rgba(255, 255, 255, 0.08);
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
</style>

