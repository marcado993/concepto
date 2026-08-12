// Carga del SDK oficial de la Cajita de Pagos de PayPhone
// (https://cdn.payphonetodoesposible.com/box/v2.0/...) — un script y una
// hoja de estilos que PayPhone pide insertar en el <head>. Se cargan una
// sola vez (idempotente) y solo cuando el estudiante de verdad elige pagar
// con PayPhone — no tiene sentido bajar este script en cada visita a la
// app si nadie abre el modal de alquiler.

declare global {
  interface Window {
    PPaymentButtonBox?: new (config: PayphoneWidgetConfig) => { render(containerId: string): void };
  }
}

export interface PayphoneWidgetConfig {
  token: string;
  clientTransactionId: string;
  amount: number; // centavos
  amountWithoutTax: number; // centavos — AEIS no aplica impuesto sobre el alquiler
  currency: "USD";
  storeId: string;
  reference: string;
  lang: "es";
}

const SDK_JS = "https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.js";
const SDK_CSS = "https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.css";

let loadPromise: Promise<void> | null = null;

export function loadPayphoneSdk(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.PPaymentButtonBox) {
      resolve();
      return;
    }

    if (!document.querySelector(`link[href="${SDK_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = SDK_CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector(`script[src="${SDK_JS}"]`);
    if (existing) {
      pollForGlobal(resolve, reject);
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = SDK_JS;
    script.onload = () => pollForGlobal(resolve, reject);
    script.onerror = () => reject(new Error("No se pudo cargar el SDK de PayPhone"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

// El script es `type="module"` — su onload confirma que se descargó y
// ejecutó, pero el global que expone puede tardar un tick más en quedar
// asignado. Un poll corto es más robusto que asumir sincronía exacta.
function pollForGlobal(resolve: () => void, reject: (err: Error) => void, attempt = 0) {
  if (window.PPaymentButtonBox) {
    resolve();
    return;
  }
  if (attempt > 40) {
    reject(new Error("El SDK de PayPhone no expuso PPaymentButtonBox a tiempo"));
    return;
  }
  setTimeout(() => pollForGlobal(resolve, reject, attempt + 1), 100);
}
