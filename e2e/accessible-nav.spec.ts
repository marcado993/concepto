import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from './test-utils';

// Navegación móvil: dos pantallas que se REEMPLAZAN (inicio → sección →
// Volver), como Ajustes del iPhone. Nunca hay capas superpuestas, así que
// es estructuralmente imposible que algo intercepte un toque — que fue la
// causa de todos los bugs de doble toque reportados desde el celular.
//
// El proyecto "chromium" de playwright.config.ts usa devices['Desktop
// Chrome']; sin este test.use() la app cae en la rama de escritorio y
// estos selectores no existen.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function waitForSplash(page: Page) {
  await page.waitForFunction(() => {
    const boot = document.getElementById('boot');
    if (!boot) return true;
    const style = window.getComputedStyle(boot);
    return style.pointerEvents === 'none' || style.opacity === '0' || style.display === 'none';
  }, { timeout: 8_000 });
}

test.describe('AEIS App — navegación móvil (inicio → sección → volver)', () => {
  test('el inicio muestra las 6 opciones, sin panel ni barra encimada', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await expect(page.locator('.accessible-item')).toHaveCount(6);
    // Nada superpuesto que pueda tragarse un toque.
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('.scrim')).toHaveCount(0);
    await expect(page.locator('.wheel-slot')).toHaveCount(0);
  });

  test('las 6 opciones se ven a la vez: nada que desplazar ni recordar', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    const items = page.locator('.accessible-item');
    for (let i = 0; i < 6; i++) {
      await expect(items.nth(i)).toBeInViewport();
    }
  });

  test('tocar una opción entra a su sección en UN solo tap', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click({ timeout: 5_000 });
    await expect(page.locator('.compact-title')).toHaveText('Casilleros');
    await expect(page.locator('.unit')).toHaveCount(108, { timeout: 5_000 });
  });

  test('el botón Volver dice "Volver", es grande y regresa al inicio', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await page.locator('.accessible-item', { hasText: 'Eventos' }).click();
    await expect(page.locator('.compact-title')).toHaveText('Eventos');

    const back = page.locator('.back-btn');
    await expect(back).toContainText('Volver');
    // Objetivo táctil por encima del mínimo WCAG 2.5.5 (44px).
    const box = await back.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await back.click({ timeout: 3_000 });
    await expect(page.locator('.accessible-item')).toHaveCount(6);
  });

  // REGRESIÓN del bug de "dos toques" que se reportó una y otra vez desde
  // móvil. .click() de Playwright hace hit-testing real: si algo invisible
  // se interpone, falla por interceptación en vez de pasar en falso (que
  // es lo que enmascaraba un .click() de JS suelto).
  test('entrar y volver repetidas veces toma siempre UN tap por paso', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    for (let i = 0; i < 4; i++) {
      await page.locator('.accessible-item', { hasText: 'Eventos' }).click({ timeout: 3_000 });
      await expect(page.locator('.compact-title')).toHaveText('Eventos');
      await page.locator('.back-btn').click({ timeout: 3_000 });
      await expect(page.locator('.accessible-item')).toHaveCount(6);

      await page.locator('.accessible-item', { hasText: 'Aportaciones' }).click({ timeout: 3_000 });
      await expect(page.locator('.compact-title')).toHaveText('Aportaciones');
      await page.locator('.back-btn').click({ timeout: 3_000 });
      await expect(page.locator('.accessible-item')).toHaveCount(6);
    }
  });

  test('dentro de la sección el contenido empieza arriba, sin encabezado gigante', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
    await expect(page.locator('.unit').first()).toBeVisible({ timeout: 5_000 });

    const top = await page.locator('.unit').first().evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(844 * 0.6);
  });

  test('el gráfico de la categoría sigue presente (identidad visual)', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await page.locator('.accessible-item', { hasText: 'Recursos' }).click();

    await expect(page.locator('.compact-icon')).toBeVisible();
    await expect(page.locator('.compact-title')).toHaveText('Recursos');
  });
});
