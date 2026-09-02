<script lang="ts">
  // Desplegable propio.
  //
  // Reemplaza a <select> por un motivo que no tiene vuelta: la LISTA de un
  // select nativo la dibuja el sistema operativo, no la página. Se puede
  // estilizar el campo cerrado, pero las <option> abiertas salen siempre
  // con el tema del SO — fondo blanco y resaltado azul claro sobre una app
  // oscura. No hay CSS que lo arregle; hay que dibujar la lista uno mismo.
  //
  // Lo que sí hay que devolver a mano, porque el nativo lo traía gratis:
  // teclado completo, roles ARIA y cierre al tocar fuera. Un desplegable
  // bonito que no se puede usar con el teclado es un retroceso, no una
  // mejora.

  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    value: string;
    options: Option[];
    /** Se lee en voz alta y también sirve de título del popup. */
    label: string;
    onchange?: (value: string) => void;
  }

  let { value = $bindable(), options, label, onchange }: Props = $props();

  let open = $state(false);
  let botonEl = $state<HTMLButtonElement | null>(null);
  let listaEl = $state<HTMLDivElement | null>(null);
  /** Opción resaltada con el teclado — separada de la seleccionada. */
  let activeIndex = $state(0);

  // Posición calculada contra la ventana (position: fixed) y no contra el
  // padre: esta sección vive dentro de un contenedor con overflow, y una
  // lista posicionada en absolute quedaba recortada por ese borde al abrir
  // el último desplegable.
  let coords = $state({ top: 0, left: 0, width: 0, arriba: false });

  const selected = $derived(options.find((o) => o.value === value) ?? options[0]);

  function medir() {
    if (!botonEl) return;
    const r = botonEl.getBoundingClientRect();
    // Alto estimado de la lista para decidir si abre hacia abajo o hacia
    // arriba. Sin esto, un desplegable cerca del borde inferior abría fuera
    // de la pantalla en móvil.
    const alto = Math.min(options.length * 40 + 12, 260);
    const abajoLibre = window.innerHeight - r.bottom;
    const arriba = abajoLibre < alto && r.top > abajoLibre;
    coords = {
      top: arriba ? r.top - alto - 6 : r.bottom + 6,
      left: r.left,
      width: r.width,
      arriba,
    };
  }

  function abrir() {
    medir();
    activeIndex = Math.max(
      0,
      options.findIndex((o) => o.value === value)
    );
    open = true;
  }

  function cerrar(devolverFoco = true) {
    open = false;
    if (devolverFoco) botonEl?.focus();
  }

  function elegir(v: string) {
    value = v;
    onchange?.(v);
    cerrar();
  }

  function onBotonKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir();
    }
  }

  function onListaKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        cerrar();
        break;
      case "ArrowDown":
        e.preventDefault();
        activeIndex = (activeIndex + 1) % options.length;
        break;
      case "ArrowUp":
        e.preventDefault();
        activeIndex = (activeIndex - 1 + options.length) % options.length;
        break;
      case "Home":
        e.preventDefault();
        activeIndex = 0;
        break;
      case "End":
        e.preventDefault();
        activeIndex = options.length - 1;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        elegir(options[activeIndex].value);
        break;
      case "Tab":
        // Tab cierra sin elegir — el foco tiene que poder salir del
        // control, igual que en un select nativo.
        cerrar(false);
        break;
    }
  }

  // Al abrir, el foco va a la lista para que el teclado la maneje; ARIA
  // apunta a la opción activa vía aria-activedescendant.
  $effect(() => {
    if (open) listaEl?.focus();
  });

  // Cerrar al hacer scroll o redimensionar. Recalcular la posición en cada
  // scroll sería lo "elegante", pero con un contenedor scrolleable de por
  // medio termina persiguiendo el botón con un fotograma de retraso; cerrar
  // es lo que hace el select nativo y no engaña a nadie.
  $effect(() => {
    if (!open) return;
    const cerrarPorMovimiento = () => cerrar(false);
    window.addEventListener("scroll", cerrarPorMovimiento, true);
    window.addEventListener("resize", cerrarPorMovimiento);
    return () => {
      window.removeEventListener("scroll", cerrarPorMovimiento, true);
      window.removeEventListener("resize", cerrarPorMovimiento);
    };
  });

  function onDocPointerDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (botonEl?.contains(t) || listaEl?.contains(t)) return;
    cerrar(false);
  }
</script>

<svelte:document onpointerdown={onDocPointerDown} />

<div class="sel-wrap">
  <button
    class="sel-btn"
    class:open
    bind:this={botonEl}
    onclick={() => (open ? cerrar() : abrir())}
    onkeydown={onBotonKeydown}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
  >
    <span class="sel-value">{selected?.label ?? ""}</span>
    <svg class="sel-caret" class:up={open} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <div
      class="sel-list"
      class:arriba={coords.arriba}
      bind:this={listaEl}
      style="top: {coords.top}px; left: {coords.left}px; min-width: {coords.width}px"
      role="listbox"
      aria-label={label}
      aria-activedescendant="sel-{label}-{activeIndex}"
      tabindex="-1"
      onkeydown={onListaKeydown}
    >
      {#each options as opt, i (opt.value)}
        <div
          class="sel-opt"
          class:active={i === activeIndex}
          class:selected={opt.value === value}
          id="sel-{label}-{i}"
          role="option"
          aria-selected={opt.value === value}
          tabindex="-1"
          onclick={() => elegir(opt.value)}
          onkeydown={(e) => e.key === "Enter" && elegir(opt.value)}
          onpointerenter={() => (activeIndex = i)}
        >
          <span>{opt.label}</span>
          {#if opt.value === value}
            <svg class="sel-check" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6.2 4.8 8.5 9.5 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sel-wrap {
    position: relative;
    flex: 1 1 auto;
    min-width: 120px;
  }

  /* El campo cerrado conserva exactamente la misma caja que tenía el
     <select> para no mover el layout de la fila de filtros. */
  .sel-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 12.5px;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .sel-btn:focus-visible {
    outline: none;
    border-color: var(--sheet-accent, #5b8def);
    box-shadow: 0 0 0 2px rgba(91, 141, 239, 0.25);
  }
  .sel-btn.open {
    border-color: var(--sheet-accent, #5b8def);
  }
  @media (hover: hover) and (pointer: fine) {
    .sel-btn:hover {
      border-color: rgba(91, 141, 239, 0.5);
    }
  }

  .sel-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sel-caret {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: rgba(234, 255, 245, 0.5);
    transition: transform 0.18s ease;
  }
  .sel-caret.up {
    transform: rotate(180deg);
  }

  /* position: fixed y z-index alto — la sección vive dentro de un
     contenedor con overflow, y en absolute la lista quedaba recortada. */
  .sel-list {
    position: fixed;
    z-index: 80;
    max-height: 260px;
    overflow-y: auto;
    padding: 5px;
    border-radius: 12px;
    background: #10141f;
    border: 1px solid rgba(120, 200, 255, 0.18);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    animation: sel-in 0.14s ease;
  }
  .sel-list.arriba {
    transform-origin: bottom;
  }

  @keyframes sel-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sel-list {
      animation: none;
    }
    .sel-caret {
      transition: none;
    }
  }

  .sel-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    /* 40px de alto: mínimo cómodo para tocar en un celular, y coincide con
       el alto que estima medir() para decidir si abre hacia arriba. */
    min-height: 40px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: rgba(234, 255, 245, 0.82);
    cursor: pointer;
  }

  /* Un solo estilo de resaltado para el ratón y para el teclado: activeIndex
     se actualiza también con pointerenter, así que nunca hay dos filas
     resaltadas a la vez diciendo cosas distintas. */
  .sel-opt.active {
    background: rgba(91, 141, 239, 0.18);
    color: #f4f9ff;
  }
  .sel-opt.selected {
    color: var(--sheet-accent, #5b8def);
    font-weight: 600;
  }

  .sel-check {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
</style>
