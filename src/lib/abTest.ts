// Test A/B de la navegación principal — pedido real del cliente tras
// feedback de que la rueda (ArcMenu) "no es usable". Variante A = la rueda
// de siempre; variante B = una lista simple y accesible (sin gesto de
// arrastre, botones reales, foco de teclado, sin depender de "adivinar"
// que el disco gira). Cada dispositivo queda fijo en su variante — un
// experimento A/B solo sirve si la misma persona ve siempre la misma
// interfaz, no una distinta cada vez que abre la app.
const STORAGE_KEY = "aeis_ui_variant";

export type UiVariant = "A" | "B";

export function getUiVariant(): UiVariant {
  if (typeof localStorage === "undefined") return "A";
  let variant: string | null = null;
  try {
    variant = localStorage.getItem(STORAGE_KEY);
  } catch {
    return "A";
  }
  if (variant === "A" || variant === "B") return variant;

  const assigned: UiVariant = Math.random() < 0.5 ? "A" : "B";
  try {
    localStorage.setItem(STORAGE_KEY, assigned);
  } catch {
    // Si no se puede guardar (modo privado, cuota llena), sigue
    // funcionando — solo que no queda fija entre sesiones.
  }
  return assigned;
}
