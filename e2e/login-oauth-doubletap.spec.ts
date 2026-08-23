import { test, expect } from '@playwright/test';

// Bug real reportado con captura: "la pantalla de carga sale dos veces" al
// entrar con GitHub. Causa: a diferencia de los demás botones de esta
// pantalla (todos guardados con `sending`), "Continuar con GitHub" no
// tenía ninguna guardia — un doble toque disparaba window.location.href
// DOS VECES, cortando la primera navegación e iniciando otra, que es
// justo lo que se ve como "la carga dos veces". Se interceptan las
// peticiones a /auth/social/start para poder contar cuántas veces se disparó la
// navegación sin dejar que realmente salga del sitio (Playwright no puede
// seguir un window.location.href real hacia un dominio externo en un
// test).

test('un doble clic en "Continuar con GitHub" dispara la navegación una sola vez', async ({ page }) => {
  const hits: string[] = [];
  await page.route('**/auth/social/start**', (route) => {
    hits.push(new URL(route.request().url()).search);
    // No cumple la redirección real — solo cuenta cuántas veces llegó.
    return route.fulfill({ status: 204 });
  });

  await page.goto('/');
  const githubBtn = page.locator('button.provider-btn.github');
  await expect(githubBtn).toBeEnabled();

  // Doble clic real, sin esperar entre uno y otro — el escenario exacto
  // del reporte.
  await githubBtn.dblclick();

  await expect(githubBtn).toBeDisabled();
  await expect.poll(() => hits.length).toBeGreaterThan(0);
  // Un pequeño respiro para que un segundo disparo (si el bug siguiera
  // presente) alcance a llegar antes de contar.
  await page.waitForTimeout(300);
  expect(hits.length).toBe(1);
  expect(hits[0]).toContain('connector=github');
});

test('un doble clic en "Continuar con Google" también dispara la navegación una sola vez', async ({ page }) => {
  const hits: string[] = [];
  await page.route('**/auth/social/start**', (route) => {
    hits.push(new URL(route.request().url()).search);
    return route.fulfill({ status: 204 });
  });

  await page.goto('/');
  const googleBtn = page.locator('button.provider-btn.google');
  await expect(googleBtn).toBeVisible();
  await googleBtn.dblclick();

  await expect(googleBtn).toBeDisabled();
  await expect.poll(() => hits.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(hits.length).toBe(1);
  expect(hits[0]).toContain('connector=google');
});

test('mientras GitHub está "conectando", el botón de Google también queda bloqueado (y viceversa)', async ({ page }) => {
  await page.route('**/auth/social/start**', (route) => route.fulfill({ status: 204 }));
  await page.goto('/');

  const githubBtn = page.locator('button.provider-btn.github');
  const googleBtn = page.locator('button.provider-btn.google');
  await githubBtn.click();

  await expect(githubBtn).toBeDisabled();
  await expect(googleBtn).toBeDisabled();
});
