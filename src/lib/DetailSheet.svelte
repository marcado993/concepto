<script lang="ts">
  import { spring } from "svelte/motion";
  import CategoryContent from "./CategoryContent.svelte";
  import SheetCategoryTabs from "./SheetCategoryTabs.svelte";
  import type { Category } from "./data";

  interface Props {
    category: Category;
    open?: boolean;
    onclose?: () => void;
    /** Lista completa de categorías + cuál está activa, para el selector
        horizontal de arriba del sheet. Sin esto, cambiar de categoría
        obligaba a CERRAR el sheet primero (el tap se lo comía el .scrim,
        que cubre toda la pantalla por encima de la lista) y recién con un
        SEGUNDO tap elegir otra — el bug real de "dos toques para cambiar"
        que se reportó desde móvil. */
    categories?: Category[];
    selectedIndex?: number;
    onselect?: (i: number) => void;
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
    categories,
    selectedIndex = 0,
    onselect,
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

  // CAUSA REAL del "toca hacer doble click" al cerrar deslizando el handle
  // hacia abajo (reporte textual: "creo que no detecta que se cierra").
  // onPointerUp estaba atado SOLO a .handle-zone, pero al arrastrar hacia
  // abajo el dedo se sale de esa zona; si la captura de puntero no se
  // aplicaba (e.target podía ser un nodo interno), el pointerup caía en
  // otro elemento y este gesto NUNCA terminaba: el sheet quedaba
  // VIÉNDOSE cerrado pero con open=true por dentro. El siguiente tap se lo
  // comía entonces el scrim (invisible pero aún activo) cerrando "de
  // verdad", y recién el segundo tap llegaba al botón. Con el listener a
  // nivel de window el gesto siempre termina, suelte donde suelte el dedo.
  // Se decide por los PÍXELES que el dedo recorrió — la intención real del
  // usuario — no por la posición del sheet. Las dos alternativas fallaban
  // por depender del tiempo, y se reprodujeron con entrada real:
  //  - Posición absoluta ($progress > umbral): si el gesto empezaba con el
  //    sheet aún animándose al abrir, startProgress no era 0 y 40px ya
  //    bastaban para cerrar sin que el usuario lo pidiera.
  //  - Delta de progreso ($progress - startProgress): el Math.min(1, …) de
  //    onPointerMove satura el valor, así que empezando cerca de 1 (sheet
  //    a medio abrir) un arrastre largo de verdad producía un delta
  //    diminuto y NO cerraba.
  // Los píxeles no se saturan ni dependen de en qué punto de la animación
  // se enganchó el gesto.
  const CLOSE_FRACTION = 0.25;
  const sheetHeightPx = () => window.innerHeight * 0.86;
  let draggedPx = 0;

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);

    if (draggedPx >= sheetHeightPx() * CLOSE_FRACTION) {
      // progress.set(1) explícito: si `open` ya era false, reasignarlo NO
      // vuelve a disparar el $effect, y el sheet se quedaría clavado justo
      // donde lo soltó el dedo — "no se cierra del todo y sigue estando ahí".
      progress.set(1);
      if (open) {
        open = false;
        onclose?.();
      }
    } else {
      // Vuelve a donde de verdad corresponde según el estado, no siempre a
      // "abierto" — así un arrastre corto nunca deja apariencia y estado
      // contradiciéndose.
      progress.set(open ? 0 : 1);
    }
  }

  function onPointerDown(e: PointerEvent) {
    // currentTarget (la .handle-zone), no target (que puede ser el .handle
    // de adentro) — más predecible para capturar el puntero.
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragging = true;
    startY = e.clientY;
    startProgress = $progress;
    draggedPx = 0;
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (dy < 0) return;
    draggedPx = dy;
    progress.set(Math.min(1, startProgress + dy / sheetHeightPx()), { hard: true });
  }

  // Si el componente se destruye a mitad de un arrastre, los listeners de
  // window no deben quedar colgados.
  $effect(() => () => {
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  });

  const contentOpacity = $derived(Math.max(0, 1 - $progress * 1.4));
  const theme = $derived(category.theme);
  // Interactividad atada al MISMO valor que la apariencia ($progress del
  // spring), no al booleano `open`. `open` cambia en un frame pero la
  // animación tarda ~700ms: con el booleano, al abrir el scrim ya se comía
  // toda la pantalla estando aún invisible, y al cerrar el sheet seguía
  // VIÉNDOSE pero los taps lo atravesaban hasta la lista de atrás. Mismo
  // hallazgo que ya se había corregido en RentLockerModal.
  // Apenas `open` es false, NI el sheet NI el scrim vuelven a interceptar
  // nada — aunque el sheet siga viéndose deslizarse hacia abajo esos
  // ~700ms que dura el spring. Esto es lo que hacía falta un segundo tap:
  // al cerrar arrastrando, el sheet seguía capturando toques sobre el 86%
  // de la pantalla mientras se iba, así que el tap para abrir otra
  // categoría se lo comía él y no llegaba a la lista de atrás. El scrim
  // pide además estar visible, para no tragarse taps mientras aparece.
  const scrimInteractive = $derived(open && $progress < 0.98);
  const sheetStyle = $derived(
    `transform: translateY(${$progress * 100}%); pointer-events: ${open ? "auto" : "none"};` +
      `--sheet-dim: ${theme.accentDim}; --sheet-deep: ${theme.deep};`
  );
</script>

<div
  class="scrim"
  style="opacity: {1 - $progress}"
  class:interactive={scrimInteractive}
  onclick={() => { open = false; onclose?.(); }}
></div>

<section class="sheet" style={sheetStyle} aria-hidden={!open}>
  <div
    class="handle-zone"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <div class="handle"></div>
  </div>

  {#if categories && onselect}
    <!-- Selector SIEMPRE alcanzable con el sheet abierto — es lo que
         convierte "cerrar y luego elegir" (dos toques) en "elegir" (uno). -->
    <SheetCategoryTabs {categories} {selectedIndex} onselect={(i) => onselect?.(i)} />
  {/if}

  <!-- Salir tenía que ser tan fácil de tocar como entrar: antes la ÚNICA
       salida era tocar el scrim (que se ve como fondo muerto, no como un
       control) o arrastrar el handle. 44px = mínimo de objetivo táctil
       WCAG 2.5.5, mismo criterio que las X de los modales. -->
  <button class="sheet-close" onclick={() => { open = false; onclose?.(); }} aria-label="Cerrar">×</button>

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
      onheaderpointerup={endDrag}
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
    overflow: hidden;
    will-change: transform;
    transition: background 0.4s ease;
  }

  /* touch-action: none SOLO acá, no en .sheet entero — hallazgo real: el
     gesto de arrastre (onPointerDown/Move/Up) solo arranca desde esta zona
     y desde .sheet-header (ver el mismo patrón, ya correcto, en
     CategoryContent.svelte). Aplicarlo al .sheet completo apagaba el
     manejo nativo de touch en TODO lo de adentro — casilleros, tarjetas de
     tier, cualquier botón — que es exactamente la clase de bug que hace
     que un navegador móvil necesite un segundo toque para registrar un
     tap real en vez de interpretarlo como el inicio de un gesto.
  */
  .handle-zone {
    padding: 14px 0 6px;
    display: flex;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }

  .handle {
    width: 44px;
    height: 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.35);
  }

  .sheet-close {
    position: absolute;
    top: 6px;
    right: 8px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.07);
    border: none;
    color: #eef4fb;
    font-size: 26px;
    line-height: 1;
    cursor: pointer;
    z-index: 2;
  }

  .sheet-inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    transition: opacity 0.2s ease;
  }
</style>
