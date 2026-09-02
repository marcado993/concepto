<script lang="ts">
  // Bolsa de empleo — lo que el estudiante ve, más el botón de refresco.
  //
  // La lista NO es editable a propósito: las ofertas se ingestan de bolsas
  // externas (Bolsa EPN, Multitrabajos, Computrabajo, Indeed y LinkedIn,
  // más las APIs de Remotive/Remote OK/Arbeitnow), no las publica AEIS. Dejar que la directiva editara un título o un sueldo acá
  // significaría mostrarle al estudiante algo distinto de lo que dice la
  // oferta real, y el link lleva a esa oferta real. Lo que sí necesita el
  // panel es poder VER qué está publicado y forzar una actualización.
  import {
    ingestJobs,
    fetchAdminJobsSnapshot,
    AdminApiError,
    type JobIngestReport,
    type AdminJobsSnapshot,
  } from "./adminApi";

  let snapshot = $state<AdminJobsSnapshot | null>(null);
  let snapshotError = $state<string | null>(null);
  let loading = $state(true);

  function loadSnapshot() {
    loading = true;
    snapshotError = null;
    fetchAdminJobsSnapshot()
      .then((data) => (snapshot = data))
      .catch((err) => {
        snapshotError = err instanceof AdminApiError ? err.message : "No se pudo cargar la bolsa de empleo.";
      })
      .finally(() => (loading = false));
  }
  $effect(loadSnapshot);

  let busy = $state(false);
  let report = $state<JobIngestReport | null>(null);
  let ingestError = $state<string | null>(null);

  async function doIngest() {
    if (busy) return;
    busy = true;
    ingestError = null;
    report = null;
    try {
      report = await ingestJobs();
      loadSnapshot();
    } catch (err) {
      ingestError = err instanceof AdminApiError ? err.message : "No se pudo actualizar la bolsa de empleo.";
    } finally {
      busy = false;
    }
  }

  const KIND_LABELS: Record<string, string> = {
    INTERNSHIP: "Pasantía",
    FULL_TIME: "Completo",
    PART_TIME: "Medio",
    CONTRACT: "Contrato",
  };
  const MODE_LABELS: Record<string, string> = { REMOTE: "Remoto", HYBRID: "Híbrido", ONSITE: "Presencial" };

  function relativeDate(iso: string | null): string {
    if (!iso) return "sin fecha";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return "hoy";
    if (days === 1) return "ayer";
    if (days < 30) return `hace ${days} d`;
    return `hace ${Math.floor(days / 30)} m`;
  }
</script>

<section class="flex flex-col gap-6">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="font-heading text-xl text-ink">Bolsa de empleo</h2>
      <p class="mt-1 max-w-prose text-sm text-ink-2">
        Pasantías y vacantes de Sistemas que la app muestra a los estudiantes. Se actualizan solas cada 3 horas
        desde la Bolsa EPN, Multitrabajos, Computrabajo, Indeed y LinkedIn.
      </p>
    </div>
    <button
      class="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-[#04150d] transition
             hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      onclick={doIngest}
      disabled={busy}
    >
      {busy ? "Buscando ofertas…" : "Actualizar ahora"}
    </button>
  </header>

  {#if busy}
    <!-- El aviso importa: la ingesta hace scraping real de varias bolsas y
         puede tardar un par de minutos. Sin esto parecía colgado. -->
    <p class="rounded-xl border border-line-soft/70 bg-panel/30 px-4 py-3 text-sm text-ink-2">
      Consultando las bolsas de empleo… puede tardar un par de minutos.
    </p>
  {/if}

  {#if ingestError}
    <p class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ff8a8a]">{ingestError}</p>
  {/if}

  {#if report}
    <div class="rounded-xl border border-line-soft/70 bg-panel/30 p-4">
      <p class="text-sm text-ink">
        Listo: <strong>{report.created}</strong>
        {report.created === 1 ? "oferta nueva" : "ofertas nuevas"},
        <strong>{report.updated}</strong> actualizadas, <strong>{report.archived}</strong> archivadas{#if report.deactivated > 0}, <strong>{report.deactivated}</strong> dadas de baja por dejar de ser del área{/if}.
      </p>
      <!-- Se muestra el embudo completo y no solo "N nuevas": que de 300
           ofertas crudas queden 40 es lo ESPERADO (el motor descarta lo que
           no es de Sistemas), y sin verlo parecería que algo falló. -->
      <p class="mt-1 text-xs text-ink-3">
        {report.fetched} encontradas → {report.afterDedupe} sin duplicados → {report.relevant} relevantes para
        Sistemas.
      </p>
      {#if report.failedSources.length > 0}
        <p class="mt-2 text-xs text-[#f0d18a]">
          No respondieron: {report.failedSources.join(", ")} — las demás sí entraron.
        </p>
      {/if}
    </div>
  {/if}

  {#if loading && !snapshot}
    <p class="text-sm text-ink-3">Cargando…</p>
  {:else if snapshotError}
    <p class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ff8a8a]">{snapshotError}</p>
  {:else if snapshot}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#each [{ label: "Publicadas", value: snapshot.total }, { label: "Pasantías", value: snapshot.facets.internships }, { label: "Remotas", value: snapshot.facets.remote }, { label: "Desde Ecuador", value: snapshot.facets.ecuador }] as stat (stat.label)}
        <div class="rounded-xl border border-line-soft/70 bg-panel/30 p-4">
          <p class="font-heading text-2xl text-ink">{stat.value}</p>
          <p class="mt-0.5 text-xs text-ink-3">{stat.label}</p>
        </div>
      {/each}
    </div>

    {#if snapshot.total === 0}
      <p class="rounded-xl border border-line-soft/70 bg-panel/30 px-4 py-3 text-sm text-ink-2">
        Todavía no hay ofertas publicadas. Toca "Actualizar ahora" para traerlas.
      </p>
    {:else}
      <div class="overflow-x-auto rounded-xl border border-line-soft/70">
        <table class="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-line-soft/70 bg-panel/40 text-left text-xs uppercase tracking-wide text-ink-3">
              <th class="px-4 py-3 font-medium">Puesto</th>
              <th class="px-4 py-3 font-medium">Tipo</th>
              <th class="px-4 py-3 font-medium">Modalidad</th>
              <th class="px-4 py-3 font-medium">Fuente</th>
              <th class="px-4 py-3 text-right font-medium">Relevancia</th>
            </tr>
          </thead>
          <tbody>
            {#each snapshot.jobs as job (job.id)}
              <tr class="border-b border-line-soft/40 last:border-0">
                <td class="px-4 py-3">
                  <a
                    class="font-medium text-ink underline-offset-2 hover:underline"
                    href={job.url}
                    target="_blank"
                    rel="noreferrer">{job.title}</a
                  >
                  <span class="block text-xs text-ink-3">{job.company} · {relativeDate(job.postedAt)}</span>
                </td>
                <td class="px-4 py-3 text-ink-2">
                  {#if job.kind === "INTERNSHIP"}
                    <span class="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">Pasantía</span>
                  {:else}
                    <span class="text-xs">{KIND_LABELS[job.kind] ?? job.kind}</span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-xs text-ink-2">{MODE_LABELS[job.workMode] ?? job.workMode}</td>
                <td class="px-4 py-3 text-xs text-ink-3">{job.source}</td>
                <!-- tabular-nums: sin esto los números bailan de ancho y la
                     columna deja de leerse como una escala. -->
                <td class="px-4 py-3 text-right text-xs tabular-nums text-ink-2">{job.relevance}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-ink-3">
        Se muestran las {snapshot.jobs.length} más relevantes de {snapshot.total}. El orden es el mismo que ve el
        estudiante: pasantías y perfiles junior en Quito primero.
      </p>
    {/if}
  {/if}
</section>
