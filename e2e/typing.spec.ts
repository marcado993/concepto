import { test, expect } from '@playwright/test';
import { gotoApp } from './test-utils';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// El tecleo arrancaba detrás del splash (570ms de escritura contra 1500ms
// de splash), así que terminaba antes de que la pantalla se descubriera y
// el usuario solo veía el texto ya completo. Se mide DESPUÉS del splash,
// que es cuando alguien realmente lo mira.
async function esperarSplash(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 8000 });
}

test('el titulo del inicio se escribe como en el login, y se ve escribirse', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await esperarSplash(page);

  const lecturas: string[] = [];
  for (let i = 0; i < 8; i++) {
    lecturas.push(await page.locator('.home-title').innerText());
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(900);
  const final = await page.locator('.home-title').innerText();

  expect(final).toContain('¿Qué necesitas?');
  // Con el splash ya fuera hubo texto PARCIAL: se ve escribirse.
  expect(lecturas.some((t) => !t.includes('necesitas?'))).toBe(true);
  await expect(page.locator('.home-title .caret')).toHaveCount(1);
});

test('al volver de una sección teclea de inmediato (sin esperar un splash que ya no existe)', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await esperarSplash(page);
  await page.waitForTimeout(1200);

  await page.locator('.accessible-item', { hasText: 'Eventos' }).click();
  await expect(page.locator('.compact-title')).toHaveText('Eventos');
  await page.locator('.back-btn').click();

  // Sin tiempo muerto: en menos de 1.2s ya terminó de escribirse.
  await page.waitForTimeout(1200);
  await expect(page.locator('.home-title')).toContainText('¿Qué necesitas?');
});
