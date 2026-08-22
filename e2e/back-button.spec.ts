import { test, expect } from '@playwright/test';
import { gotoApp } from './test-utils';

// El "atrás" del teléfono/navegador sacaba de la app (con login por GitHub
// caía en las URLs del flujo OAuth que quedaron en el historial, o sea de
// vuelta al login) porque la app no registraba historial propio. Estos
// tests fijan el comportamiento esperado en un celular.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('atrás desde una sección vuelve al menú, no sale de la app', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2200);

  await page.locator('.accessible-item', { hasText: 'Eventos' }).click();
  await expect(page.locator('.compact-title')).toHaveText('Eventos');

  await page.goBack();

  await expect(page.locator('.accessible-item')).toHaveCount(6);
  // Sigue dentro de la app y con sesión: nunca la pantalla de login.
  await expect(page.getByRole('dialog', { name: 'Iniciar sesión' })).toHaveCount(0);
});

test('el botón Volver y el atrás del teléfono comparten historial (no se desincronizan)', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2200);

  // Entrar con el dedo, salir con el botón de la pantalla.
  await page.locator('.accessible-item', { hasText: 'Recursos' }).click();
  await expect(page.locator('.compact-title')).toHaveText('Recursos');
  await page.locator('.back-btn').click();
  await expect(page.locator('.accessible-item')).toHaveCount(6);

  // Si el historial hubiera quedado desincronizado, este "atrás" saltaría
  // fuera de la app en vez de quedarse en el menú.
  await page.locator('.accessible-item', { hasText: 'Eventos' }).click();
  await expect(page.locator('.compact-title')).toHaveText('Eventos');
  await page.goBack();
  await expect(page.locator('.accessible-item')).toHaveCount(6);
  await expect(page.getByRole('dialog', { name: 'Iniciar sesión' })).toHaveCount(0);
});

test('entrar y salir varias veces mantiene el historial coherente', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2200);

  for (let i = 0; i < 3; i++) {
    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
    await expect(page.locator('.compact-title')).toHaveText('Casilleros');
    await page.goBack();
    await expect(page.locator('.accessible-item')).toHaveCount(6);
  }
  await expect(page.getByRole('dialog', { name: 'Iniciar sesión' })).toHaveCount(0);
});
