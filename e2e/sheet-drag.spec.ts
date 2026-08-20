import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from './test-utils';

// Reproduce el gesto REAL de cerrar el sheet arrastrando el handle hacia
// abajo, con entrada de verdad (page.mouse / touchscreen), no con
// dispatchEvent. Esa distinción importa: los PointerEvent sintéticos no
// pasan por el hit-testing ni por la captura de puntero del navegador, y
// por eso las verificaciones anteriores daban "todo bien" mientras el bug
// seguía vivo en el celular del usuario.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function waitForSplash(page: Page) {
  await page.waitForFunction(() => {
    const boot = document.getElementById('boot');
    if (!boot) return true;
    const s = window.getComputedStyle(boot);
    return s.pointerEvents === 'none' || s.opacity === '0' || s.display === 'none';
  }, { timeout: 8_000 });
}

/** Espera a que el sheet TERMINE de animarse. Sin esto el handle es un
 *  blanco en movimiento: boundingBox() devuelve una posición que ya quedó
 *  vieja y el ratón presiona donde el handle ya no está — el gesto no
 *  arranca y el test falla por un artefacto del arnés, no por la app.
 *  (Una persona real espera a ver el sheet antes de arrastrarlo.) */
async function waitForSheetSettled(page: Page, wantOpen: boolean) {
  await page.waitForFunction(
    (open) => {
      const el = document.querySelector('.sheet');
      if (!el) return false;
      const top = el.getBoundingClientRect().top;
      // No basta con "ya está en zona": el spring sigue moviéndose después
      // de cruzar cualquier umbral, y el handle mide 25px de alto — apuntar
      // a una posición vieja lo erra por completo. Se exige que la posición
      // DEJE DE CAMBIAR entre dos lecturas.
      const w = window as unknown as { __prevSheetTop?: number };
      const prev = w.__prevSheetTop;
      w.__prevSheetTop = top;
      const stable = prev !== undefined && Math.abs(prev - top) < 0.5;
      const inPlace = open ? top < window.innerHeight * 0.25 : top >= window.innerHeight - 2;
      return stable && inPlace;
    },
    wantOpen,
    { timeout: 6_000, polling: 100 }
  );
}

async function openFirstCategory(page: Page) {
  await gotoApp(page, '/', 'B');
  await waitForSplash(page);
  await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
  await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'false');
  await waitForSheetSettled(page, true);
}

/** Arrastra el handle hacia abajo con entrada real y suelta. */
async function dragHandleDown(page: Page, distance = 400) {
  const handle = page.locator('.handle-zone');
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  // Varios pasos: un solo salto no produce los pointermove intermedios que
  // el gesto necesita para ir siguiendo el dedo.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x, y + (distance * i) / 8);
  }
  await page.mouse.up();
}

test.describe('AEIS App — cerrar el sheet arrastrando el handle', () => {
  test('arrastrar el handle hacia abajo cierra el sheet DEL TODO (no queda a medias)', async ({ page }) => {
    await openFirstCategory(page);
    await dragHandleDown(page);

    // El estado interno tiene que reflejar el cierre, no solo la apariencia.
    await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'true', { timeout: 3_000 });

    // Y tiene que quedar fuera de la pantalla de verdad, no "casi".
    await page.waitForTimeout(900); // que asiente el spring
    const offscreen = await page.locator('.sheet').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= window.innerHeight - 2;
    });
    expect(offscreen).toBe(true);
  });

  test('tras cerrar arrastrando, abrir otra categoría toma UN solo tap', async ({ page }) => {
    await openFirstCategory(page);
    await dragHandleDown(page);
    await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'true', { timeout: 3_000 });
    await page.waitForTimeout(900);

    // Nada invisible debe estar interceptando el tap. Si el scrim (o el
    // propio sheet) quedó activo, este click falla por interceptación en
    // vez de pasar en falso.
    await page.locator('.accessible-item', { hasText: 'Eventos' }).click({ timeout: 3_000 });

    await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'false', { timeout: 3_000 });
    await expect(page.locator('.sheet-header h2')).toHaveText('Eventos');
  });

  test('un arrastre corto (menos del umbral) NO cierra: el sheet vuelve a su lugar', async ({ page }) => {
    await openFirstCategory(page);
    await dragHandleDown(page, 40);

    await page.waitForTimeout(900);
    await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'false');
    const settledOpen = await page.locator('.sheet').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 0.25;
    });
    expect(settledOpen).toBe(true);
  });

  // Sin esperar a que el spring termine de abrir. Acá estaba la condición
  // de carrera: con el umbral basado en la posición ABSOLUTA, empezar el
  // gesto a media animación hacía que 40px bastaran para cerrar. El
  // umbral por delta arrastrado lo vuelve independiente del tiempo.
  test('arrastre corto empezado ANTES de que termine la animación de apertura tampoco cierra', async ({ page }) => {
    await gotoApp(page, '/', 'B');
    await waitForSplash(page);
    await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
    // A propósito sin waitForTimeout: se arrastra en plena animación.
    await dragHandleDown(page, 40);

    await page.waitForTimeout(900);
    await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'false');
  });

  // Repetido: una carrera que solo falla a veces no está arreglada.
  test('el ciclo cerrar-arrastrando → abrir-en-un-tap aguanta repeticiones', async ({ page }) => {
    await openFirstCategory(page);

    for (let i = 0; i < 4; i++) {
      await dragHandleDown(page);
      await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'true', { timeout: 3_000 });

      // Un solo click, SIN esperar a que el sheet termine de irse — si
      // mientras se desliza sigue interceptando toques, Playwright falla
      // acá por interceptación. Ese era justo el segundo tap de más.
      await page.locator('.accessible-item', { hasText: 'Casilleros' }).click({ timeout: 3_000 });
      await expect(page.locator('.sheet')).toHaveAttribute('aria-hidden', 'false', { timeout: 3_000 });
      await waitForSheetSettled(page, true);
    }
  });
});
