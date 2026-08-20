import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from './test-utils';

// Variante B del test A/B de navegación (src/lib/abTest.ts) — lista
// accesible en vez de la rueda (ArcMenu), pedido real del cliente tras
// feedback de que la rueda "no es usable". Mismo estilo de caja negra que
// el resto de la suite: build de producción real, backend real.
//
// App.svelte decide rueda/lista-A11y VS. el sidebar de escritorio mirando
// `(pointer: fine) and (min-width: 720px)` — el proyecto "chromium" de
// playwright.config.ts usa devices['Desktop Chrome'] (mouse, ≥720px), así
// que SIEMPRE cae en la rama de escritorio salvo que se fuerce lo
// contrario acá. Sin esto, .accessible-nav nunca aparece y estos tests
// fallan siempre — no por un bug real, sino por probar la rama equivocada.
//
// Solo viewport/touch a mano, NO devices['iPhone ...'] completo — esos
// presets traen defaultBrowserType:'webkit', y este repo solo tiene
// instalado el navegador chromium (mismo que el resto de la suite).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function waitForSplash(page: Page) {
  await page.waitForFunction(() => {
    const boot = document.getElementById('boot');
    if (!boot) return true;
    const style = window.getComputedStyle(boot);
    return style.pointerEvents === 'none' || style.opacity === '0' || style.display === 'none';
  }, { timeout: 8_000 });
}

test.describe('AEIS App — navegación variante B (accesible)', () => {
  test('en variante B se ve la lista de categorías, no la rueda', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await expect(page.locator('.accessible-nav')).toBeVisible();
    await expect(page.locator('.wheel-slot')).toHaveCount(0);
    await expect(page.locator('.open-pill')).toHaveCount(0);
  });

  test('cada categoría es un botón real con texto visible — no depende de un gesto de arrastre', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    const items = page.locator('.accessible-item');
    await expect(items).toHaveCount(6);
    await expect(items.first()).toHaveText(/Casilleros/);
    // aria-current marca cuál es la categoría activa — sin esto un lector
    // de pantalla no tiene forma de saber cuál está seleccionada.
    await expect(items.first()).toHaveAttribute('aria-current', 'true');
  });

  test('tocar una categoría la abre directo — un solo tap, sin paso intermedio de "deslizar arriba"', async ({ page }) => {
    const lockersResponse = page.waitForResponse(
      (res) => res.url().includes('/lockers') && res.request().method() === 'GET' && res.status() === 200,
      { timeout: 10_000 }
    );

    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await lockersResponse;

    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();

    const units = page.locator('.unit');
    await expect(units).toHaveCount(108, { timeout: 5_000 });
  });

  // REGRESIÓN del bug real de "dos toques para cambiar" reportado desde
  // móvil. El punto ciego de la suite era este: los tests de arriba solo
  // abren UNA categoría desde la pantalla inicial (sheet cerrado, lista
  // expuesta) — nunca probaban CAMBIAR de categoría con el sheet ya
  // abierto, que es justo cuando fallaba. Con el sheet abierto, el .scrim
  // (z-index 20, pantalla completa) tapaba la lista (z-index 5), así que
  // el primer tap solo cerraba el sheet y hacía falta un segundo para
  // elegir. Este test usa .click() de Playwright, que SÍ hace hit-testing
  // real (falla si otro elemento intercepta el punto) — a diferencia de
  // un .click() de JS suelto, que se lo salta y por eso nunca lo detectó.
  test('con el sheet YA abierto, cambiar de categoría toma UN solo tap (no hay que cerrarlo primero)', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
    await expect(page.locator('[role="tablist"]')).toBeVisible({ timeout: 5_000 });

    // Un único click, sin cerrar nada antes — si algo lo intercepta,
    // Playwright falla acá en vez de pasar en falso.
    await page.locator('[role="tab"]', { hasText: 'Eventos' }).click({ timeout: 5_000 });

    await expect(page.locator('.sheet-header h2')).toHaveText('Eventos', { timeout: 5_000 });
    // La pestaña activa tiene que REFLEJAR el cambio — si no, el usuario no
    // tiene forma de saber en qué categoría quedó (visibilidad del estado).
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Eventos');
  });

  test('las etiquetas de las pestañas se leen completas, sin truncarse ni encimarse', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
    await expect(page.locator('[role="tablist"]')).toBeVisible({ timeout: 5_000 });

    // "Emprendimientos" es la más larga — es la que se cortaba antes.
    const tab = page.locator('[role="tab"]', { hasText: 'Emprendimientos' });
    const truncated = await tab.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);

    // Objetivo táctil mínimo WCAG 2.5.5 en alto.
    const box = await tab.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('el sheet tiene un botón de cerrar alcanzable (no solo tocar el fondo o arrastrar)', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);

    await page.locator('.accessible-item', { hasText: 'Eventos' }).click();
    const closeBtn = page.locator('.sheet-close');
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });

    // Objetivo táctil mínimo WCAG 2.5.5 (44x44).
    const box = await closeBtn.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await closeBtn.click();
    await expect(page.locator('.accessible-item', { hasText: 'Eventos' })).toBeVisible();
  });
});
