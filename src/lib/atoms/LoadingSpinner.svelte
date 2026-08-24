<!--
  Atom: spinner genérico de carga.
  Heredó de los estados de carga dispersos por CategoryContent (locker
  skeleton, "cargando indicadores…", etc.) — centralizados acá para no
  repetir el patrón en cada organism nuevo.
  
  `label` se anuncia al lector de pantalla vía role="status"; en la UI
  visible solo aparece el punto animado.
-->
<script lang="ts">
  interface Props {
    label?: string;
  }
  let { label = "Cargando…" }: Props = $props();
</script>

<p class="loading-line" role="status">
  <span class="loading-dot" aria-hidden="true"></span>
  {label}
</p>

<style>
  .loading-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: rgba(234, 255, 245, 0.55);
    padding: 12px 20px;
    margin: 0;
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sheet-accent, #3fffa2);
    animation: pulse-dot 1.1s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.25; transform: scale(0.8); }
    50%       { opacity: 1;    transform: scale(1.15); }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-dot { animation: none; opacity: 0.6; }
  }
</style>
