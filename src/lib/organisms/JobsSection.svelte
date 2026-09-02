<script lang="ts">
  // Bolsa de empleo — reemplaza a Emprendimientos en el menú.
  //
  // A diferencia del resto de secciones, esta pide sus datos POR SÍ MISMA y
  // no los recibe de App.svelte: el listado es filtrable y paginado, y ese
  // estado pertenece a la sección. Meterlo en la raíz de la app habría
  // obligado a App.svelte a conocer los filtros de empleos para poder
  // volver a pedirlos en cada cambio.
  import { fetchJobs, type JobFilters, type JobListResult, type JobOfferPublic } from "../api";

  let result = $state<JobListResult | null>(null);
  let loadError = $state(false);
  let loading = $state(true);

  // Filtros. `kind: "INTERNSHIP"` NO es el valor inicial a propósito: se
  // abre en "Todo" para que nadie crea que la app solo tiene pasantías,
  // pero el orden por relevancia ya las pone arriba solo (el motor les da
  // +30). Filtrar por defecto habría escondido las vacantes junior, que
  // para un estudiante de último semestre son igual de válidas.
  let search = $state("");
  let kind = $state<JobFilters["kind"] | "">("");
  let workMode = $state<JobFilters["workMode"] | "">("");
  let onlyEcuador = $state(true);
  let sort = $state<"relevance" | "recent">("relevance");
  let activeTag = $state<string>("");

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
    kind: kind || undefined,
    workMode: workMode || undefined,
    ecuador: onlyEcuador || undefined,
    tag: activeTag || undefined,
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

  const MODE_LABELS: Record<string, string> = {
    REMOTE: "Remoto",
    HYBRID: "Híbrido",
    ONSITE: "Presencial",
  };

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

    <div class="jobs-selects">
      <select bind:value={kind} aria-label="Tipo de oferta">
        <option value="">Todo tipo</option>
        <option value="INTERNSHIP">Pasantías</option>
        <option value="FULL_TIME">Tiempo completo</option>
        <option value="PART_TIME">Medio tiempo</option>
        <option value="CONTRACT">Por contrato</option>
      </select>

      <select bind:value={workMode} aria-label="Modalidad">
        <option value="">Toda modalidad</option>
        <option value="REMOTE">Remoto</option>
        <option value="HYBRID">Híbrido</option>
        <option value="ONSITE">Presencial</option>
      </select>

      <select bind:value={sort} aria-label="Orden">
        <option value="relevance">Más relevantes</option>
        <option value="recent">Más recientes</option>
      </select>
    </div>

    <!-- Encendido por defecto: para un estudiante en Quito, una vacante
         presencial en Berlín es ruido. Incluye las remotas, que sí son
         tomables desde acá (ver ecuadorFilter en el backend). -->
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
      {#if result.facets.remote > 0}
        · {result.facets.remote} remoto
      {/if}
    </p>
  {/if}

  <div class="jobs-list">
    {#if loading && !result}
      <p class="sec-note">Buscando ofertas…</p>
    {:else if loadError}
      <p class="sec-note">No se pudo cargar la bolsa de empleo.</p>
    {:else if jobs.length === 0}
      <p class="sec-note">
        No hay ofertas con esos filtros. Prueba desmarcando "solo Ecuador" o buscando otro término.
      </p>
    {:else}
      {#each jobs as job, i (job.id)}
        <article class="job-card list-in" class:is-internship={job.kind === "INTERNSHIP"} style="--li: {i}">
          <div class="job-head">
            <div class="job-titles">
              <h3 class="job-title">{job.title}</h3>
              <p class="job-company">
                {job.company}{#if job.location}<span class="job-sep">·</span>{job.location}{/if}
              </p>
            </div>
            {#if job.kind === "INTERNSHIP"}
              <span class="job-flag">Pasantía</span>
            {/if}
          </div>

          <div class="job-meta">
            <span class="job-chip mode-{job.workMode.toLowerCase()}">{MODE_LABELS[job.workMode]}</span>
            {#if job.kind !== "INTERNSHIP"}
              <span class="job-chip">{KIND_LABELS[job.kind]}</span>
            {/if}
            {#if job.salary}<span class="job-chip salary">{job.salary}</span>{/if}
            {#if job.postedAt}<span class="job-when">{relativeDate(job.postedAt)}</span>{/if}
          </div>

          {#if job.excerpt}
            <p class="job-excerpt">{job.excerpt}</p>
          {/if}

          {#if job.tags.length > 0}
            <div class="job-tags">
              {#each job.tags.slice(0, 6) as tag (tag)}
                <button
                  class="job-tag"
                  class:active={activeTag === tag}
                  onclick={() => toggleTag(tag)}
                  aria-pressed={activeTag === tag}
                >
                  {tag}
                </button>
              {/each}
            </div>
          {/if}

          <div class="job-foot">
            <!-- rel="noreferrer" además de noopener: la oferta va a un sitio
                 de terceros y no hay motivo para filtrarle de dónde vino el
                 estudiante. Mismo criterio que el CTA de WhatsApp. -->
            <a class="job-cta" href={job.url} target="_blank" rel="noreferrer">Ver oferta</a>
            <!-- Atribución de la fuente: Remote OK la exige explícitamente
                 en los términos de su API, y al estudiante le sirve saber a
                 qué bolsa va a caer antes de hacer clic. -->
            <span class="job-source">vía {job.source}</span>
          </div>
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

  .jobs-selects {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
  }

  .jobs-selects select {
    flex: 1 1 auto;
    min-width: 120px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #eef4fb;
    font-size: 12.5px;
  }
  .jobs-selects select:focus {
    outline: none;
    border-color: var(--sheet-accent, #5b8def);
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
    gap: 10px;
  }

  :global(.content-wrap.wide) .jobs-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 12px;
  }

  .job-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 15px;
    border-radius: var(--radius-md, 18px);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(255, 255, 255, 0.09);
    transition:
      transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 0.22s ease;
  }

  /* Las pasantías llevan un borde izquierdo marcado, no solo la etiqueta:
     es el tipo de oferta que este módulo existe para destacar, y un color
     de chip solo no se lee al escanear la lista rápido. */
  .job-card.is-internship {
    border-left: 3px solid var(--sheet-accent, #5b8def);
  }

  @media (hover: hover) and (pointer: fine) {
    .job-card:hover {
      transform: translateY(-3px);
      border-color: rgba(91, 141, 239, 0.5);
    }
  }
  .job-card:focus-within {
    border-color: rgba(91, 141, 239, 0.5);
  }

  .job-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .job-titles {
    flex: 1;
    min-width: 0;
  }

  .job-title {
    margin: 0 0 2px;
    font-family: var(--font-heading);
    font-weight: 600;
    font-size: 15px;
    line-height: 1.3;
    color: #f4f9ff;
  }

  .job-company {
    margin: 0;
    font-size: 12px;
    color: rgba(234, 255, 245, 0.62);
  }

  .job-sep {
    margin: 0 5px;
    opacity: 0.5;
  }

  .job-flag {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 4px 9px;
    border-radius: 999px;
    color: #04150d;
    background: var(--sheet-accent, #5b8def);
  }

  .job-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .job-chip {
    font-size: 10.5px;
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(234, 255, 245, 0.78);
  }

  /* Modalidad con color propio: es el dato que más cambia si la oferta
     sirve o no para alguien en Quito, y con todos los chips grises había
     que leerlos uno por uno. */
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
    margin-left: auto;
    font-size: 10.5px;
    color: rgba(234, 255, 245, 0.42);
  }

  .job-excerpt {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(234, 255, 245, 0.66);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
    margin-top: 2px;
  }

  .job-cta {
    padding: 8px 16px;
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
