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

export default app
