<script lang="ts">
  // Bolsa de empleo — reemplaza a Emprendimientos en el menú.
  //
  // A diferencia del resto de secciones, esta pide sus datos POR SÍ MISMA y
  // no los recibe de App.svelte: el listado es filtrable y paginado, y ese
  // estado pertenece a la sección. Meterlo en la raíz de la app habría
  // obligado a App.svelte a conocer los filtros de empleos para poder
  // volver a pedirlos en cada cambio.
  import { fetchJobs, type JobFilters, type JobListResult, type JobOfferPublic } from "../api";
  import Select from "../Select.svelte";
  import { tituloLegible } from "../jobTitle";

  let result = $state<JobListResult | null>(null);
  let loadError = $state(false);
  let loading = $state(true);

  let search = $state("");
  // El desplegable propio trabaja con `string` (es lo que maneja cualquier
  // control de formulario); acá se estrecha al tipo real del filtro en un
  // solo lugar, en vez de castear en cada uso.
  let kindValue = $state("");
  let workModeValue = $state("");
  // Arranca en "Más recientes" y no en "Más relevantes": con la ventana
  // acotada a 2 semanas, todo lo que se ve ya pasó el filtro de calidad del
  // motor, así que lo que de verdad decide si vale la pena postular es qué
  // tan fresco es. La relevancia sigue ordenando dentro de la misma fecha
  // (ver orderBy en el backend), y el otro orden queda a un toque.
  let sortValue = $state("recent");

  const kind = $derived((kindValue || undefined) as JobFilters["kind"] | undefined);
  const workMode = $derived((workModeValue || undefined) as JobFilters["workMode"] | undefined);
  const sort = $derived(sortValue as "relevance" | "recent");

  let onlyEcuador = $state(true);
  let activeTag = $state<string>("");

  /**
   * Ventana de antigüedad. Arranca en 1 semana y el techo es 2.
   *
   * Antes llegaba hasta "1 mes" y "Todo", y se recortó por cómo funcionan de
   * verdad estas convocatorias: pasadas dos semanas el proceso normalmente
   * ya se cerró aunque el aviso siga publicado — nadie baja una vacante
   * llena. Ofrecer ventanas más anchas era ofrecer ofertas a las que ya no
   * se puede postular, y eso hace perder más tiempo del que ahorra.
   *
   * Consecuencia deliberada: las ofertas SIN fecha quedan siempre fuera. El
   * filtro responde "¿qué sigue abierto?" y de una oferta sin fecha no se
   * puede afirmar eso (ver el filtro por maxAgeDays en el backend).
   */
  const AGE_OPTIONS: { label: string; days: number }[] = [
    { label: "3 días", days: 3 },
    { label: "1 semana", days: 7 },
    { label: "2 semanas", days: 14 },
  ];
  let maxAgeDays = $state(7);

  /**
   * Días bajo los cuales una oferta se marca como "reciente".
   *
   * 3 días y no 1: los portales publican por lotes y muchas vacantes
   * aparecen fechadas "ayer" o "hace 2 días" el mismo día que salen. Con
   * un umbral de 24 h el distintivo casi nunca se veía.
   */
  const RECIENTE_DIAS = 3;

  function esReciente(iso: string | null): boolean {
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() <= RECIENTE_DIAS * 86_400_000;
  }

  /** La tarjeta abierta. null = todas plegadas. */
  let expandedId = $state<string | null>(null);

  // Debounce de la búsqueda: sin esto cada tecla disparaba un GET, y el
  // endpoint hace tres `contains` sobre la tabla. Escribir "desarrollador"
  // eran 13 consultas de las que solo la última importaba.
  let searchDebounced = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const value = search;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => (searchDebounced = value), 350);
    return () => clearTimeout(debounceTimer);
  });

  const filters = $derived<JobFilters>({
    q: searchDebounced.trim() || undefined,
    kind,
    workMode,
    ecuador: onlyEcuador || undefined,
    tag: activeTag || undefined,
    maxAgeDays,
    sort,
    limit: 40,
  });

  $effect(() => {
    // Se lee `filters` acá arriba para que el efecto dependa del objeto
    // entero: leerlo dentro del .then() lo dejaría fuera del rastreo de
    // Svelte y la lista no se actualizaría al cambiar un filtro.
    const current = filters;
    loading = true;
    let cancelled = false;

    fetchJobs(current)
      .then((data) => {
        // Guard de carrera: cambiar dos filtros rápido lanza dos peticiones
        // y la primera puede responder DESPUÉS de la segunda, pisando el
        // resultado correcto con el viejo. El cleanup marca la obsoleta.
        if (cancelled) return;
        result = data;
        loadError = false;
        // Al cambiar los filtros la tarjeta abierta ya no está en la lista;
        // dejar el id vivo hacía que otra oferta apareciera expandida al
        // azar cuando su posición coincidía.
        expandedId = null;
      })
      .catch(() => {
        if (!cancelled) loadError = true;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  const KIND_LABELS: Record<string, string> = {
    INTERNSHIP: "Pasantía",
    FULL_TIME: "Tiempo completo",
    PART_TIME: "Medio tiempo",
    CONTRACT: "Por contrato",
  };
  const MODE_LABELS: Record<string, string> = { REMOTE: "Remoto", HYBRID: "Híbrido", ONSITE: "Presencial" };

  /**
   * Color de marca por fuente, para el sello de origen.
   *
   * Un color reconocible (el azul de LinkedIn, el verde de la EPN) se
   * identifica de un vistazo al escanear la lista; el nombre en texto hay
   * que leerlo. Se usa un sello propio y NO el logotipo oficial de cada
   * portal: reproducir marcas de terceros en la app tiene un problema de
   * uso de marca que un color no tiene.
   */
  const SOURCE_STYLE: Record<string, { bg: string; fg: string; short: string }> = {
    "Bolsa EPN": { bg: "#0d5c3a", fg: "#7df0c6", short: "EPN" },
    LinkedIn: { bg: "#0a66c2", fg: "#ffffff", short: "in" },
    Indeed: { bg: "#2557a7", fg: "#ffffff", short: "id" },
    Multitrabajos: { bg: "#7b2ff2", fg: "#ffffff", short: "MT" },
    Computrabajo: { bg: "#e8542f", fg: "#ffffff", short: "CT" },
    "Remote OK": { bg: "#ff4742", fg: "#ffffff", short: "OK" },
    Remotive: { bg: "#1c3d5a", fg: "#8fd3ff", short: "Rm" },
    Arbeitnow: { bg: "#334155", fg: "#cbd5e1", short: "An" },
  };
  const sourceStyle = (s: string) => SOURCE_STYLE[s] ?? { bg: "#334155", fg: "#cbd5e1", short: s.slice(0, 2) };

  function initials(name: string): string {
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?"
    );
  }

  /** "hace 3 días" — más legible que una fecha absoluta para algo que se mide en frescura. */
  function relativeDate(iso: string | null): string {
    if (!iso) return "";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return "hoy";
    if (days === 1) return "ayer";
    if (days < 7) return `hace ${days} días`;
    if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
    return `hace ${Math.floor(days / 30)} meses`;
  }

  function toggleTag(tag: string) {
    activeTag = activeTag === tag ? "" : tag;
  }

  function toggleCard(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  const jobs = $derived<JobOfferPublic[]>(result?.jobs ?? []);
</script>

<div class="jobs-wrap">
  <div class="jobs-controls">
    <input
      class="jobs-search"
      type="search"
      placeholder="Buscar: java, pasantía, QA…"
      bind:value={search}
      aria-label="Buscar ofertas"
    />

    <!-- Antigüedad: lo primero después de buscar, porque es el filtro que
         más cambia si lo que ves sigue abierto o no. -->
    <div class="chip-row" role="group" aria-label="Antigüedad de la oferta">
      {#each AGE_OPTIONS as opt (opt.label)}
        <button
          class="chip"
          class:active={maxAgeDays === opt.days}
          onclick={() => (maxAgeDays = opt.days)}
          aria-pressed={maxAgeDays === opt.days}
        >
          {opt.label}
        </button>
      {/each}
    </div>

    <div class="jobs-selects">
      <Select
        bind:value={kindValue}
        label="Tipo de oferta"
        options={[
          { value: "", label: "Todo tipo" },
          { value: "INTERNSHIP", label: "Pasantías" },
          { value: "FULL_TIME", label: "Tiempo completo" },
          { value: "PART_TIME", label: "Medio tiempo" },
          { value: "CONTRACT", label: "Por contrato" },
        ]}
      />

      <Select
        bind:value={workModeValue}
        label="Modalidad"
        options={[
          { value: "", label: "Toda modalidad" },
          { value: "REMOTE", label: "Remoto" },
          { value: "HYBRID", label: "Híbrido" },
          { value: "ONSITE", label: "Presencial" },
        ]}
      />

      <Select
        bind:value={sortValue}
        label="Orden"
        options={[
          { value: "recent", label: "Más recientes" },
          { value: "relevance", label: "Más relevantes" },
        ]}
      />
    </div>

    <label class="jobs-toggle">
      <input type="checkbox" bind:checked={onlyEcuador} />
      <span>Solo lo que puedo tomar desde Ecuador (incluye remoto)</span>
    </label>
  </div>

  {#if activeTag}
    <button class="tag-clear" onclick={() => (activeTag = "")}>
      Filtrando por <strong>{activeTag}</strong> · quitar ✕
    </button>
  {/if}

  {#if result && !loading}
    <p class="jobs-count">
      {result.total}
      {result.total === 1 ? "oferta" : "ofertas"}
      {#if result.facets.internships > 0}
        · {result.facets.internships} {result.facets.internships === 1 ? "pasantía" : "pasantías"}
      {/if}
      · últimos {maxAgeDays} días
    </p>
  {/if}

  <div class="jobs-list">
    {#if loading && !result}
      <p class="sec-note">Buscando ofertas…</p>
    {:else if loadError}
      <p class="sec-note">No se pudo cargar la bolsa de empleo.</p>
    {:else if jobs.length === 0}
      <p class="sec-note">
        No hay ofertas con esos filtros. Prueba ampliando la antigüedad a "2 semanas" o desmarcando
        "solo Ecuador".
      </p>
    {:else}
      {#each jobs as job, i (job.id)}
        {@const open = expandedId === job.id}
        {@const src = sourceStyle(job.source)}
        <article class="job-card list-in" class:is-internship={job.kind === "INTERNSHIP"} class:open style="--li: {i}">
          <!-- La tarjeta ENTERA es el botón de expandir: en móvil obligar a
               acertar un chevron de 20px es la diferencia entre usarlo y no.
               El link de la oferta va aparte, dentro del panel abierto, para
               que nunca se dispare por error al querer solo leer más. -->
          <button class="job-head" onclick={() => toggleCard(job.id)} aria-expanded={open}>
            <span class="job-logo" style="--src-bg: {src.bg}; --src-fg: {src.fg}">
              {#if job.companyLogo}
                <!-- La imagen viene de un CDN de terceros: si falla, se
                     esconde y queda la inicial que ya está debajo. -->
                <img
                  src={job.companyLogo}
                  alt=""
                  loading="lazy"
                  onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              {/if}
              <span class="job-logo-fallback">{initials(job.company || job.title)}</span>
              <span class="job-source-badge" title={job.source}>{src.short}</span>
            </span>

            <span class="job-titles">
              <span class="job-title">{tituloLegible(job.title)}</span>
              <span class="job-company">
                {job.company || "Confidencial"}{#if job.location}<span class="job-sep">·</span>{job.location}{/if}
              </span>
              <span class="job-meta">
                {#if job.kind === "INTERNSHIP"}<span class="job-flag">Pasantía</span>{/if}
                <span class="job-chip mode-{job.workMode.toLowerCase()}">{MODE_LABELS[job.workMode]}</span>
                {#if job.salary}<span class="job-chip salary">{job.salary}</span>{/if}
                {#if esReciente(job.postedAt)}
                  <span class="job-fresh" title="Publicada hace {RECIENTE_DIAS} días o menos">
                    <span class="job-fresh-dot" aria-hidden="true"></span>Reciente
                  </span>
                {/if}
                {#if job.postedAt}<span class="job-when">{relativeDate(job.postedAt)}</span>{/if}
              </span>
            </span>

            <span class="job-score" aria-label="Relevancia {job.relevance} de 100">{job.relevance}</span>
          </button>

          {#if open}
            <div class="job-detail">
              {#if job.kind !== "INTERNSHIP"}
                <p class="detail-line"><strong>Tipo:</strong> {KIND_LABELS[job.kind] ?? job.kind}</p>
              {/if}

              {#if job.description}
                <p class="job-description">{job.description}</p>
              {:else}
                <p class="sec-note">Esta fuente no publica la descripción en el listado — ábrela para verla.</p>
              {/if}

              {#if job.tags.length > 0}
                <div class="job-tags">
                  {#each job.tags as tag (tag)}
                    <button class="job-tag" class:active={activeTag === tag} onclick={() => toggleTag(tag)}>
                      {tag}
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="job-foot">
                <a class="job-cta" href={job.url} target="_blank" rel="noreferrer">Ver oferta y postular</a>
                <span class="job-source">vía {job.source}</span>
              </div>
            </div>
          {/if}
        </article>
      {/each}
    {/if}
  </div>
</div>

<style>
  .jobs-wrap {
    padding: 8px 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  :global(.content-wrap.wide) .jobs-wrap {
    padding: 16px 28px 40px;
  }

  .jobs-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .jobs-search {
    width: 100%;
    padding: 10px 13px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 13.5px;
  }
  .jobs-search:focus {
    outline: none;
    border-color: var(--sheet-accent, #5b8def);
  }

  .chip-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .chip {
    padding: 6px 13px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: rgba(234, 255, 245, 0.7);
    font-size: 12px;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }
  .chip.active {
    border-color: var(--sheet-accent, #5b8def);
    background: rgba(91, 141, 239, 0.18);
    color: #eef4fb;
    font-weight: 600;
  }

  .jobs-selects {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
  }


  .jobs-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(234, 255, 245, 0.72);
    cursor: pointer;
  }
  .jobs-toggle input {
    accent-color: var(--sheet-accent, #5b8def);
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .tag-clear {
    align-self: flex-start;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--sheet-accent, #5b8def);
    background: rgba(91, 141, 239, 0.16);
    color: #eef4fb;
    font-size: 11.5px;
    cursor: pointer;
  }

  .jobs-count {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: rgba(234, 255, 245, 0.5);
  }

  .jobs-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* En escritorio el listado NO pasa a grilla: la tarjeta se expande hacia
     abajo, y en una grilla de 3 columnas eso empuja de golpe toda la fila y
     hace perder el sitio donde estabas leyendo. Una sola columna ancha
     mantiene el desplazamiento predecible. */
  :global(.content-wrap.wide) .jobs-list {
    max-width: 860px;
  }

  .job-card {
    border-radius: var(--radius-md, 18px);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(255, 255, 255, 0.09);
    overflow: hidden;
    transition: border-color 0.22s ease;
  }

  /* Las pasantías llevan un borde izquierdo marcado, no solo la etiqueta:
     es el tipo de oferta que este módulo existe para destacar, y un color
     de chip solo no se lee al escanear la lista rápido. */
  .job-card.is-internship {
    border-left: 3px solid var(--sheet-accent, #5b8def);
  }
  .job-card.open {
    border-color: rgba(91, 141, 239, 0.55);
  }
  @media (hover: hover) and (pointer: fine) {
    .job-card:hover {
      border-color: rgba(91, 141, 239, 0.4);
    }
  }

  .job-head {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .job-head:focus-visible {
    outline: 2px solid var(--sheet-accent, #5b8def);
    outline-offset: -2px;
  }

  .job-logo {
    position: relative;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.07);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }
  .job-logo img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 12px;
    background: #fff;
    z-index: 1;
  }
  .job-logo-fallback {
    font-family: var(--font-heading);
    font-size: 15px;
    font-weight: 700;
    color: rgba(234, 255, 245, 0.75);
  }

  /* Sello de origen pegado al logo. Va con el color de la marca pero SIN su
     logotipo: reproducir marcas de terceros en la app trae un problema de
     uso de marca que un color no tiene. */
  .job-source-badge {
    position: absolute;
    right: -5px;
    bottom: -5px;
    z-index: 2;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 6px;
    background: var(--src-bg);
    color: var(--src-fg);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
    box-shadow: 0 0 0 2px rgba(10, 14, 25, 0.9);
  }

  .job-titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Atkinson Hyperlegible (--font-display), NO la display condensada.
     El propio app.css dice que --font-heading es "SOLO títulos cortos y
     etiquetas, nunca oraciones largas", y un puesto como "Pasante Business
     Intelligence" es exactamente una oración larga. Atkinson es del Braille
     Institute, hecha para dislexia y baja visión: diferencia I/l/1 y O/0, y
     tiene siluetas de palabra mucho más marcadas.

     El interlineado sube a 1.4 y el tamaño a 15px por el mismo motivo:
     apretado y condensado se lee peor, y este texto es el dato principal de
     la tarjeta, no un adorno. */
  .job-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 15px;
    line-height: 1.4;
    letter-spacing: 0.005em;
    color: #f4f9ff;
    /* Una sola línea con elipsis: con títulos de 3 líneas las tarjetas
       cambiaban de alto y la lista se volvía imposible de escanear. El
       título completo se ve al expandir. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-company {
    font-family: var(--font-display);
    font-size: 12px;
    /* De 0.55 a 0.68 de opacidad: a 12 px, 0.55 sobre este fondo quedaba
       por debajo del contraste mínimo legible. */
    color: rgba(234, 255, 245, 0.68);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .job-sep {
    margin: 0 5px;
    opacity: 0.5;
  }

  .job-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 3px;
  }

  .job-flag {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 999px;
    color: #04150d;
    background: var(--sheet-accent, #5b8def);
  }

  .job-chip {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(234, 255, 245, 0.7);
  }
  .job-chip.mode-remote {
    background: rgba(33, 224, 160, 0.16);
    color: #7df0c6;
  }
  .job-chip.mode-hybrid {
    background: rgba(224, 178, 60, 0.16);
    color: #f0d18a;
  }
  .job-chip.salary {
    background: rgba(91, 141, 239, 0.16);
    color: #a9c4f7;
  }

  .job-when {
    font-size: 10px;
    color: rgba(234, 255, 245, 0.4);
  }

  /* "Reciente" — la señal que mas importa al escanear, porque separa lo que
     sigue abierto de lo que probablemente ya se cerro. Verde y con punto,
     no solo texto: a 10 px entre otros cuatro chips grises, el texto solo
     se pierde. */
  .job-fresh {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 7px 2px 6px;
    border-radius: 999px;
    color: #7df0c6;
    background: rgba(33, 224, 160, 0.14);
    border: 1px solid rgba(33, 224, 160, 0.3);
  }

  .job-fresh-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #21e0a0;
    animation: fresh-pulse 2.4s ease-in-out infinite;
  }

  @keyframes fresh-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 rgba(33, 224, 160, 0.5);
    }
    50% {
      opacity: 0.65;
      box-shadow: 0 0 0 3px rgba(33, 224, 160, 0);
    }
  }

  /* El latido es un adorno, no informacion: quien pide menos movimiento ve
     el mismo punto quieto y no pierde nada. */
  @media (prefers-reduced-motion: reduce) {
    .job-fresh-dot {
      animation: none;
    }
  }

  /* Al pasar el cursor por la tarjeta, el distintivo se realza — el efecto
     que se pidio, atado a la tarjeta entera y no al chip, porque el chip
     mide 60 px y apuntarle seria mas trabajo que leerlo. */
  @media (hover: hover) and (pointer: fine) {
    .job-card:hover .job-fresh {
      background: rgba(33, 224, 160, 0.24);
      border-color: rgba(33, 224, 160, 0.55);
    }
  }

  /* tabular-nums: sin esto los números bailan de ancho y la columna deja de
     leerse como una escala. */
  .job-score {
    flex-shrink: 0;
    align-self: flex-start;
    min-width: 30px;
    padding: 3px 7px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(234, 255, 245, 0.8);
    font-size: 11.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .job-detail {
    padding: 0 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    padding-top: 12px;
    margin: 0 0 0 0;
    animation: detail-in 0.2s ease;
  }
  @keyframes detail-in {
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
    .job-detail {
      animation: none;
    }
  }

  .detail-line {
    margin: 0;
    font-size: 12px;
    color: rgba(234, 255, 245, 0.65);
  }
  .detail-line strong {
    color: rgba(234, 255, 245, 0.85);
  }

  .job-description {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.6;
    color: rgba(234, 255, 245, 0.72);
    /* Tope de alto con scroll propio: algunas descripciones pasan de 4000
       caracteres y sin esto una sola tarjeta abierta ocupaba diez pantallas. */
    max-height: 260px;
    overflow-y: auto;
    white-space: pre-line;
  }

  .job-tags {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .job-tag {
    font-size: 10.5px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: rgba(234, 255, 245, 0.7);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .job-tag.active {
    border-color: var(--sheet-accent, #5b8def);
    color: #eef4fb;
    background: rgba(91, 141, 239, 0.16);
  }
  @media (hover: hover) and (pointer: fine) {
    .job-tag:hover {
      border-color: rgba(91, 141, 239, 0.6);
      color: #eef4fb;
    }
  }

  .job-foot {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .job-cta {
    padding: 9px 18px;
    border-radius: 999px;
    background: var(--sheet-accent, #5b8def);
    color: #04122e;
    font-size: 12.5px;
    font-weight: 700;
    text-decoration: none;
    transition:
      filter 0.15s ease,
      transform 0.15s ease;
  }
  @media (hover: hover) and (pointer: fine) {
    .job-cta:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
  }

  .job-source {
    font-size: 10.5px;
    color: rgba(234, 255, 245, 0.4);
  }

  .sec-note {
    font-size: 12px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.45);
    margin: 8px 0;
  }

  .list-in {
    opacity: 0;
    animation: list-materialize 0.44s cubic-bezier(0.18, 0.9, 0.24, 1.06) forwards;
    /* Tope en 12: con 40 tarjetas, escalonar todas dejaba la última
       apareciendo casi 2 s después de abrir la sección. */
    animation-delay: calc(min(var(--li, 0), 12) * 38ms);
  }

  @keyframes list-materialize {
    0% {
      opacity: 0;
      transform: translateY(12px) scale(0.97);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .list-in {
      opacity: 1;
      animation: none;
      transform: none;
    }
  }
</style>
