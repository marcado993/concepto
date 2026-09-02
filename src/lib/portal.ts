/**
 * Mueve un elemento a `document.body`.
 *
 * Existe por un bug real y muy difícil de ver leyendo el CSS: el scrim de
 * los modales tiene `z-index: 60` y la barra superior solo `z-index: 10`,
 * así que "obviamente" el modal debería taparla. No lo hacía — la barra
 * seguía brillando encima del velo oscuro.
 *
 * El motivo es que `.mobile-main` tiene `position: relative; z-index: 5`, y
 * eso crea un CONTEXTO DE APILAMIENTO. Dentro de él, el 60 del modal solo
 * compite contra sus hermanos: el subárbol entero se pinta como si fuera
 * una sola capa en z-index 5, por debajo del 10 de la barra. Subir el
 * número del modal a 9999 no habría cambiado nada, que es justo lo que hace
 * que este bug se persiga por horas.
 *
 * Sacar el elemento al `<body>` lo saca de ese contexto: pasa a competir
 * contra los elementos de nivel raíz y su z-index vuelve a significar lo
 * que uno espera.
 *
 * Uso:
 *   <div class="scrim" use:portal> … </div>
 */
export function portal(node: HTMLElement) {
  // `document.body` y no un contenedor propio: no hace falta un nodo extra
  // y así el elemento queda de verdad al nivel más alto posible.
  document.body.appendChild(node);

  return {
    // Svelte llama a destroy() al desmontar. Como el nodo ya no está donde
    // Svelte lo puso, es esta función la que tiene que quitarlo — si no, el
    // modal se quedaría pegado en la página para siempre.
    destroy() {
      node.remove();
    },
  };
}
