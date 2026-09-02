import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

// El precalentado del mapa (MapLibre, ~243 KB comprimidos) YA NO vive acá.
// Se movió a App.svelte, condicionado a que el usuario haya iniciado
// sesión — ver el comentario de `precalentarMapa()` allá para el porqué.
// The boot screen lives in index.html so it paints before this bundle even
// arrives. Hand off once Svelte has mounted, keeping it up for a beat so a
// fast connection doesn't produce a jarring one-frame flash.
//
// 930ms, no 1500ms: el número no es libre, tiene que cubrir la animación de
// tecleo de #bootLog en index.html — cortarla a media frase se ve rota, no
// intencional. Lo que se hizo fue ACELERAR esa animación (11ms por carácter
// y 90ms entre líneas, antes 18 y 140) en vez de recortarla: se siguen
// viendo las tres líneas escribiéndose, solo que 570ms antes. Si se cambian
// esos tiempos allá, hay que recalcular este número: 60 caracteres × 11ms +
// 3 líneas × 90ms = 930ms.
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
  setTimeout(dismiss, returningFromPayphone ? 300 : 930)
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
