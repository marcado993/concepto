import type { Page } from '@playwright/test';

// La app vive detrás de un login gate (App.svelte: `{#if !authed}<Login/>{:else}...{/if}`,
// ver src/lib/auth.svelte.ts) — sin esto, TODO test que navegue a '/' se queda
// atascado en la pantalla de login y nunca ve .brandbar, el mapa, ni dispara
// GET /lockers. Los e2e no necesitan un login real (GitHub/OTP no son
// automatizables acá): isAuthenticated() solo mira si hay un token en
// sessionStorage, y las rutas que estos tests ejercitan (/lockers, /security/*)
// son @Public() en el backend — no validan el token, así que un valor
// cualquiera basta para pasar el gate del FRONTEND.
//
// addInitScript() corre antes que cualquier script de la página, así que la
// sesión ya existe en sessionStorage para cuando App.svelte monta y lee
// isAuthenticated() por primera vez.
// uiVariant se asigna al azar por dispositivo (src/lib/abTest.ts, test A/B
// de navegación: rueda vs. lista accesible) — sin fijarlo acá, cada
// contexto nuevo de Playwright (localStorage vacío) tira una moneda al
// aire, y toda esta suite (escrita contra la rueda: .open-pill,
// .wheel-slot) sería flaky ~50% de las corridas. "A" acá replica el
// comportamiento de siempre; e2e/accessible-nav.spec.ts prueba B aparte.
export async function gotoApp(page: Page, path = '/', variant: 'A' | 'B' = 'A') {
  await page.addInitScript((v) => {
    sessionStorage.setItem('aeis_access_token', 'e2e-fake-token');
    localStorage.setItem('aeis_ui_variant', v);
  }, variant);
  await page.goto(path);
}
