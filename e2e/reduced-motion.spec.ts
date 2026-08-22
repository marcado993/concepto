import { test, expect } from '@playwright/test';
import { gotoApp } from './test-utils';

// Accesibilidad de las animaciones: son 100% decorativas, así que con el
// sistema pidiendo menos movimiento todo tiene que quedar VISIBLE y
// QUIETO. Nunca puede pasar que algo dependa de la animación para verse
// (si `opacity:0` se quedara pegado, la pantalla quedaría en blanco).
//
// emulateMedia() explícito, no test.use({reducedMotion}) — verificado que
// esa vía no llegaba a aplicar la emulación (matchMedia devolvía false).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('con prefers-reduced-motion todo queda visible y quieto', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2500);

  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const filas = await page.locator('.accessible-item').evaluateAll((els) =>
    els.map((e) => ({ anim: getComputedStyle(e).animationName, op: getComputedStyle(e).opacity }))
  );
  expect(filas.length).toBe(6);
  for (const f of filas) {
    expect(f.anim).toBe('none');
    expect(Number(f.op)).toBe(1);
  }

  await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
  await page.waitForTimeout(1200);
  const u = await page.locator('.unit').first().evaluate((e) => ({
    anim: getComputedStyle(e).animationName,
    op: getComputedStyle(e).opacity,
  }));
  expect(u.anim).toBe('none');
  expect(Number(u.op)).toBe(1);
});

test('sin esa preferencia, las animaciones SÍ corren', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2500);

  const anim = await page.locator('.accessible-item').first().evaluate((e) => getComputedStyle(e).animationName);
  expect(anim).toContain('item-materialize');
});
