// Test A/B de la navegación principal — pedido real del cliente tras
// feedback de que la rueda (ArcMenu) "no es usable". Variante A = la rueda
// de siempre; variante B = una lista simple y accesible (sin gesto de
// arrastre, botones reales, foco de teclado, sin depender de "adivinar"
// que el disco gira).
//
// EXPERIMENTO CERRADO (pedido real: "hazle list of rows ahorita en todo") —
// reportes repetidos de doble-tap en móvil llevaron a decidir B para
// TODOS de una vez, sin esperar a que cada dispositivo migre solo.
// getUiVariant() ahora siempre devuelve "B", incluso si un dispositivo
// venía con "A" guardado de antes del cierre del experimento. El código
// de la rueda (ArcMenu.svelte) NO se borra — sigue en el repo por si se
// retoma el experimento — solo deja de estar en la ruta real que ve
// cualquier estudiante.
const STORAGE_KEY = "aeis_ui_variant";

export type UiVariant = "A" | "B";

export function getUiVariant(): UiVariant {
  try {
    localStorage.setItem(STORAGE_KEY, "B");
  } catch {
    // Si no se puede guardar (modo privado, cuota llena, o no hay
    // localStorage en este entorno), no importa — igual devuelve "B".
  }
  return "B";
}
