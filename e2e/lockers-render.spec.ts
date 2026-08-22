import { test, expect } from '@playwright/test';
import { gotoApp } from './test-utils';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// Verificación de que la optimización de carga diferida NO deja casilleros
// en blanco: las imágenes que están en pantalla deben cargarse de verdad, y
// la animación de entrada debe terminar en opacidad 1 (si se quedara en 0,
// la grilla se vería vacía — sería mucho peor que el problema que se
// intentaba resolver).
test('los casilleros visibles cargan su imagen y quedan opacos', async ({ page }) => {
  await gotoApp(page, '/', 'B');
  await page.waitForTimeout(2200);
  await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
  await expect(page.locator('.unit').first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1800); // que terminen entrada + carga

  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.unit img')] as HTMLImageElement[];
    const enPantalla = imgs.filter((i) => {
      const b = i.getBoundingClientRect();
      return b.top < window.innerHeight && b.bottom > 0;
    });
    const units = [...document.querySelectorAll('.unit')];
    const visibles = units.filter((u) => {
      const b = u.getBoundingClientRect();
      return b.top < window.innerHeight && b.bottom > 0;
    });
    return {
      total: imgs.length,
      enPantalla: enPantalla.length,
      enPantallaCargadas: enPantalla.filter((i) => i.complete && i.naturalWidth > 0).length,
      fueraCargadas: imgs.length - imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      opacidadMinVisible: Math.min(...visibles.map((u) => Number(getComputedStyle(u).opacity))),
    };
  });

  expect(r.total).toBe(108);
  // Las de pantalla SÍ cargan (nada en blanco).
  expect(r.enPantallaCargadas).toBe(r.enPantalla);
  // Y la entrada termina visible, no atascada en opacidad 0.
  expect(r.opacidadMinVisible).toBe(1);
  // El ahorro real: hay imágenes fuera de pantalla aún sin cargar.
  expect(r.fueraCargadas).toBeGreaterThan(0);
  console.log('RENDER', JSON.stringify(r));
});
