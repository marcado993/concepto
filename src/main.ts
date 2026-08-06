import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

// The boot screen lives in index.html so it paints before this bundle even
// arrives. Hand off once Svelte has mounted, keeping it up for a beat so a
// fast connection doesn't produce a jarring one-frame flash.
const boot = document.getElementById('boot')
if (boot) {
  const dismiss = () => {
    boot.classList.add('done')
    boot.addEventListener('transitionend', () => boot.remove(), { once: true })
  }
  setTimeout(dismiss, 600)
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
