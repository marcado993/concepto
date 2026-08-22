import { test, expect } from '@playwright/test';
import { gotoApp } from './test-utils';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// El resplandor del "próximo" se pintaba sobre TODA la fila del grid
// (fecha + línea de tiempo incluidas), con border-radius y sin relleno
// propio: se veía una caja con el texto arriba y un hueco enorme abajo.
// Estos tests fijan que la fila quede alineada como una línea de tiempo.
test('la fila del próximo evento queda alineada, sin caja ni hueco', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2200);
  await page.locator('.accessible-item', { hasText: 'Eventos' }).click();
  await expect(page.locator('.event-row').first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const row = document.querySelector('.event-row.event-next')!;
    const dia = row.querySelector('.event-day')!.getBoundingClientRect();
    const tags = row.querySelector('.event-tags')!.getBoundingClientRect();
    const cs = getComputedStyle(row);
    return {
      // La fecha y la fila de etiquetas deben arrancar casi a la misma
      // altura: son lo primero de cada columna.
      desfaseArriba: Math.abs(dia.top - tags.top),
      fondoFila: cs.backgroundColor,
      radioFila: cs.borderRadius,
      // El día del próximo va con el acento (así se distingue sin caja).
      colorDia: getComputedStyle(row.querySelector('.event-day')!).color,
      colorDiaOtro: getComputedStyle(
        document.querySelectorAll('.event-row:not(.event-next) .event-day')[0]
      ).color,
    };
  });

  expect(m.desfaseArriba).toBeLessThan(10);
  // Sin caja: ni fondo pintado ni esquinas redondeadas en la fila.
  expect(m.fondoFila).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(m.radioFila).toBe('0px');
  // Y el próximo sí se distingue del resto.
  expect(m.colorDia).not.toBe(m.colorDiaOtro);
});
