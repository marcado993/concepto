import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

// import() dinámico, no un `import './lib/mapWarm'` estático — MapLibre GL
// pesa ~1MB sin comprimir (es la única dependencia real de producción del
// proyecto, ver package.json) y un import estático lo mete DENTRO del
// bundle crítico de arranque: el splash y el resto de la app quedaban
// esperando a que ese megabyte se descargue y parsee antes de volverse
// interactivos, aunque el usuario nunca abra Seguridad (hallazgo real de
// rendimiento, auditado con `npm run build` — antes de este cambio
// dist/assets/index-*.js pesaba ~1MB). El import dinámico hace que Vite lo
// separe en su propio chunk, cargado en paralelo apenas monta la app — el
// mapa se sigue precalentando durante el splash (mismo efecto que antes),
// pero ya no bloquea que el resto de la UI aparezca primero.
// requestIdleCallback (no un import() disparado directamente) — el import
// dinámico ya separa MapLibre en su propio chunk, pero descargarlo/
// parsearlo/ejecutar `new maplibregl.Map()` (contexto WebGL + worker) sigue
// compitiendo por el mismo hilo principal que la animación de entrada de
// Casilleros (la categoría por defecto al arrancar) en un celular de gama
// baja con 1-2 núcleos reales — hallazgo de auditoría de rendimiento móvil:
// no eran dos lags separados, era un choque de arranque compartido. El
// timeout de respaldo (1500ms) cubre navegadores sin idle real bajo carga
// continua, para que el precalentado del mapa no se postergue para siempre.
const warmMapWhenIdle = () => {
  import('./lib/mapWarm')
}
if ('requestIdleCallback' in window) {
  requestIdleCallback(warmMapWhenIdle, { timeout: 1500 })
} else {
  setTimeout(warmMapWhenIdle, 300)
}

// The boot screen lives in index.html so it paints before this bundle even
// arrives. Hand off once Svelte has mounted, keeping it up for a beat so a
// fast connection doesn't produce a jarring one-frame flash. 1500ms (not
// 600ms) on purpose — index.html's own inline script types out a short
// "system boot" log inside #bootLog, and cutting it off mid-sentence would
// look broken instead of intentional; the sequence finishes in ~1.3s.
//
// Excepción: PayPhone redirige de vuelta con una recarga COMPLETA de
// página (App.svelte lee ?id=&clientTransactionId= al montar) — sin esto,
// alguien que ya estaba en la app, fue a pagar y volvió, se topaba con el
// "arrancando sistema" completo de nuevo ANTES de ver si su pago se
// confirmó (reporte real: "es como que se recarga"). Ahí no hace falta la
// narrativa completa de arranque — se corta antes.
const boot = document.getElementById('boot')
if (boot) {
  const dismiss = () => {
    boot.classList.add('done')
    boot.addEventListener('transitionend', () => boot.remove(), { once: true })
  }
  const returningFromPayphone = new URLSearchParams(window.location.search).has('clientTransactionId')
  setTimeout(dismiss, returningFromPayphone ? 300 : 1500)
}

// Registra el Service Worker que cachea el style JSON, tiles, glyphs y
// sprites del mapa MapLibre. En la segunda visita (o conexión lenta) los
// assets del mapa salen de la caché local en vez de cruzar el Atlántico.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // El SW no es crítico — si falla, el mapa sigue funcionando, solo
      // sin la capa de caché offline.
    })
  })
}

export default app
