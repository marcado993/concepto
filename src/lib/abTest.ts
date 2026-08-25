// Navegación principal — variante A = la rueda de siempre (ArcMenu);
// variante B = una lista simple y accesible (sin gesto de arrastre,
// botones reales, foco de teclado, sin depender de "adivinar" que el
// disco gira). Pedido real del cliente tras feedback de que la rueda "no
// es usable"; reportes repetidos de doble-tap en móvil llevaron a cerrar
// el experimento a favor de B para todos.
//
// Ahora es un feature flag REAL, editable desde el panel de administración
// (ver backend/src/shared/settings/ui-variant.service.ts) — antes vivía
// hardcodeado acá y cualquier cambio necesitaba un redeploy del frontend.
//
// getUiVariant() sigue siendo SÍNCRONA a propósito — se lee una sola vez
// al montar (ver App.svelte) y la variante de una sesión ya en curso NO
// debe cambiar a media sesión, así que no puede depender de esperar un
// fetch. Se resuelve así:
//   1. Devuelve YA MISMO lo último que haya en caché local (o "B" si es
//      la primera visita — mismo default que dejó el cierre del
//      experimento).
//   2. En paralelo, sin bloquear nada, pregunta al backend cuál es el
//      valor REAL configurado hoy y actualiza esa caché — para la
//      PRÓXIMA carga, nunca para esta.
import { fetchUiVariant } from "./api";

const STORAGE_KEY = "aeis_ui_variant";
const DEFAULT_VARIANT: UiVariant = "B";

export type UiVariant = "A" | "B";

function isUiVariant(value: string | null): value is UiVariant {
  return value === "A" || value === "B";
}

function refreshCacheInBackground(): void {
  fetchUiVariant()
    .then(({ variant }) => {
      try {
        localStorage.setItem(STORAGE_KEY, variant);
      } catch {
        // localStorage lleno/modo privado — no es crítico, la próxima
        // carga simplemente vuelve a intentar.
      }
    })
    .catch(() => {
      // Sin conexión o backend caído — se queda con lo último en caché
      // (o el default), no es crítico bloquear ni reintentar acá.
    });
}

export function getUiVariant(): UiVariant {
  let variant: UiVariant = DEFAULT_VARIANT;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isUiVariant(stored)) variant = stored;
  } catch {
    // Sin localStorage disponible — se queda con el default.
  }

  refreshCacheInBackground();

  return variant;
}
