import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // maplibre-gl loads a worker via a relative new URL(...) that Vite's
  // dependency pre-bundler rewrites incorrectly, producing a 404 for
  // maplibre-gl-worker.mjs that silently stalls the map (no console error,
  // no tile requests — it just never renders). Excluding it from the
  // optimizer lets the browser load its native ESM build instead, where
  // that worker path resolves correctly.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
