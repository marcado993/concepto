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
export async function gotoApp(page: Page, path = '/') {
  await page.addInitScript(() => {
    sessionStorage.setItem('aeis_access_token', 'e2e-fake-token');
  });
  await page.goto(path);
}
