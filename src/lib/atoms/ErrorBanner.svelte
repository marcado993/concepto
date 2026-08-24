<!--
  Atom: mensaje de error genérico para secciones que no pudieron cargar
  datos del backend. Centraliza el patrón repetido en las 6 secciones
  de CategoryContent ("No se pudo cargar…").

  `retry` es opcional — solo aparece cuando tiene sentido ofrecer un
  reintento (ej. casilleros, donde location.reload() sí recarga el dato).
-->
<script lang="ts">
  interface Props {
    message: string;
    retry?: boolean;
  }
  let { message, retry = false }: Props = $props();
</script>

<p class="fetch-error" role="alert">
  {message}
  {#if retry}
    <button class="retry-btn" onclick={() => location.reload()}>Reintentar</button>
  {/if}
</p>

<style>
  .fetch-error {
    font-size: 13px;
    color: rgba(255, 180, 140, 0.85);
    background: rgba(255, 120, 60, 0.08);
    border: 1px solid rgba(255, 120, 60, 0.18);
    border-radius: 8px;
    padding: 10px 14px;
    margin: 12px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .retry-btn {
    background: rgba(255, 120, 60, 0.18);
    border: 1px solid rgba(255, 120, 60, 0.35);
    border-radius: 6px;
    color: rgba(255, 200, 160, 0.95);
    font-size: 12px;
    padding: 4px 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: rgba(255, 120, 60, 0.28);
  }
</style>
