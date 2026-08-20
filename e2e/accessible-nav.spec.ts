import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from './test-utils';

// Navegación móvil: UNA sola pantalla con pestañas fijas arriba y el
// contenido debajo. Antes era una lista de 6 categorías y encima un panel
// deslizante que la tapaba — dos navegaciones para lo mismo, y el origen
// de todos los bugs de toques (scrim a pantalla completa, gesto de
// arrastre, spring). Quitar el panel eliminó esa clase entera de fallos.
//
// El proyecto "chromium" de playwright.config.ts usa devices['Desktop
// Chrome'], así que sin este test.use() la app cae en la rama de
// escritorio y estos selectores no existen.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function waitForSplash(page: Page) {
  await page.waitForFunction(() => {
    const boot = document.getElementById('boot');
    if (!boot) return true;
    const style = window.getComputedStyle(boot);
    return style.pointerEvents === 'none' || style.opacity === '0' || style.display === 'none';
  }, { timeout: 8_000 });
}

test.describe('AEIS App — navegación móvil (pestañas)', () => {
  test('se ven pestañas de categoría, no la rueda ni el panel deslizante', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expect(page.locator('.wheel-slot')).toHaveCount(0);
    await expect(page.locator('.open-pill')).toHaveCount(0);
    // Ya no existe panel encimado: nada puede taparse a nada.
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('.scrim')).toHaveCount(0);
  });

  test('cada categoría es un botón real con texto visible', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(6);
    await expect(tabs.first()).toHaveText(/Casilleros/);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('el contenido de la categoría activa se ve de entrada, sin abrir nada', async ({ page }) => {
    const lockersResponse = page.waitForResponse(
      (res) => res.url().includes('/lockers') && res.request().method() === 'GET' && res.status() === 200,
      { timeout: 10_000 }
    );

    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await lockersResponse;

    // Casilleros es la categoría por defecto: cero toques para llegar a lo
    // que la mayoría viene a hacer.
    await expect(page.locator('.unit')).toHaveCount(108, { timeout: 5_000 });
  });

  // REGRESIÓN del bug de "dos toques para cambiar" que se reportó desde
  // móvil una y otra vez. .click() de Playwright SÍ hace hit-testing real
  // (falla si algo intercepta el punto), a diferencia de un .click() de JS
  // suelto, que se lo salta — por eso las verificaciones viejas pasaban
  // con el bug vivo.
  test('cambiar de categoría toma UN solo tap', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await page.locator('[role="tab"]', { hasText: 'Eventos' }).click({ timeout: 5_000 });
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Eventos');

    await page.locator('[role="tab"]', { hasText: 'Aportaciones' }).click({ timeout: 5_000 });
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Aportaciones');
  });

  test('ir y volver entre categorías sigue tomando un tap cada vez', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    for (let i = 0; i < 4; i++) {
      await page.locator('[role="tab"]', { hasText: 'Eventos' }).click({ timeout: 3_000 });
      await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Eventos');
      await page.locator('[role="tab"]', { hasText: 'Casilleros' }).click({ timeout: 3_000 });
      await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Casilleros');
    }
  });

  test('las etiquetas de las pestañas se leen completas, sin truncarse', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    const tab = page.locator('[role="tab"]', { hasText: 'Emprendimientos' });
    const truncated = await tab.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);

    const box = await tab.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('el contenido empieza arriba: sin encabezado gigante robando pantalla', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await expect(page.locator('.unit').first()).toBeVisible({ timeout: 5_000 });

    // El primer casillero tiene que verse sin desplazarse. Antes, entre el
    // título, el ícono de 128px y el subtítulo, la grilla arrancaba muy
    // por debajo del pliegue.
    const top = await page.locator('.unit').first().evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(844 * 0.6);
  });
});
