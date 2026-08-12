// defineConfig from 'vitest/config', not 'vite' — the plain Vite one
// doesn't type the `test` property below, which made `tsc` (npm run check)
// fail even though Vitest itself ran fine. vitest/config re-exports a
// version merged with Vitest's config types.
import { defineConfig } from 'vitest/config'
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
  test: {
    // TDD unit tests (fast, no browser) — e2e/BDD-flavored specs stay in
    // Playwright (e2e/*.spec.ts), which already covers user-facing flows.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
