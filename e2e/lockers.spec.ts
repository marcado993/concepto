import { test, expect, type Page } from '@playwright/test';

// Caja negra de verdad — contra el build de producción real (npm run
// preview, ver playwright.config.ts) y el backend real corriendo en
// localhost:3000 (docker-compose.yml). Sin mockear fetch ni el backend:
// si el directorio de casilleros no tiene los 108 reales (o el backend no
// responde), este test lo nota.

async function waitForSplash(page: Page) {
  await page.waitForFunction(() => {
    const boot = document.getElementById('boot');
    if (!boot) return true;
    const style = window.getComputedStyle(boot);
    return style.pointerEvents === 'none' || style.opacity === '0' || style.display === 'none';
  }, { timeout: 8_000 });
}

// El fetch a GET /lockers se dispara apenas App.svelte monta (un $effect,
// no una acción del usuario) — hay que empezar a escuchar la respuesta
// ANTES de navegar, o la promesa se registra después de que la petición
// ya resolvió y espera para siempre algo que nunca vuelve a pasar.
async function openLockersSheet(page: Page) {
  const lockersResponse = page.waitForResponse(
    (res) => res.url().includes('/lockers') && res.request().method() === 'GET' && res.status() === 200,
    { timeout: 10_000 }
  );

  await page.goto('/');
  await waitForSplash(page);
  await lockersResponse;

  const openPill = page.locator('.open-pill');
  if (await openPill.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await openPill.click();
    await page.waitForTimeout(400);
  }
}

test.describe('AEIS App — casilleros (directorio real + modal de alquiler)', () => {
  test('el directorio muestra los 108 casilleros reales del backend, no datos mock', async ({ page }) => {
    // openLockersSheet ya espera la respuesta real de GET /lockers
    // internamente — un segundo waitForResponse aquí esperaría para
    // siempre un evento que ya pasó.
    await openLockersSheet(page);

    const units = page.locator('.unit');
    await expect(units).toHaveCount(108, { timeout: 5_000 });

    // Códigos reales sembrados por prisma/seed.ts (zona + 2 dígitos, "A01"),
    // no los "A1".."A9" que generaba el mock viejo de data.ts.
    await expect(page.locator('.unit-number').first()).toHaveText('A01');
  });

  test('click en un casillero disponible abre el modal de alquiler', async ({ page }) => {
    await openLockersSheet(page);

    const firstAvailable = page.locator('.unit:not([disabled])').first();
    await firstAvailable.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/Casillero /)).toBeVisible();
  });

  test('sin sesión iniciada, el modal pide login en vez de mostrar el formulario de pago', async ({ page }) => {
    await openLockersSheet(page);

    const firstAvailable = page.locator('.unit:not([disabled])').first();
    await firstAvailable.click();

    // Scoped al dialog — el brandbar de arriba también tiene un botón
    // "Iniciar sesión" propio, getByRole sin scope matcheaba los dos.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
    // El formulario de método de pago (PayPhone/comprobante) NO debe
    // aparecer para un visitante sin sesión — sería un bypass del guard.
    await expect(page.getByText('PayPhone')).not.toBeVisible();
  });

  test('cerrar el modal con la X vuelve a la grilla', async ({ page }) => {
    await openLockersSheet(page);

    await page.locator('.unit:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Scoped al dialog — el scrim que lo envuelve también tiene
    // role="button" aria-label="Cerrar" (para cerrar con click afuera),
    // getByRole sin scope matcheaba los dos.
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('AEIS App — presupuesto de rendimiento (regresión del bundle)', () => {
  test('el JS que carga en el arranque no vuelve a pesar ~1MB (maplibre-gl debe seguir en su propio chunk)', async ({
    page,
  }) => {
    const jsRequests: { url: string; size: number }[] = [];
    page.on('response', async (res) => {
      if (res.url().endsWith('.js') && res.status() === 200) {
        const body = await res.body().catch(() => null);
        if (body) jsRequests.push({ url: res.url(), size: body.length });
      }
    });

    await page.goto('/');
    await waitForSplash(page);
    await page.waitForTimeout(1_000); // dar tiempo al import() dinámico de mapWarm

    // El chunk de entrada (index-*.js, sin el hash de maplibre/mapWarm en
    // el nombre) es el que bloquea el primer render — ese es el que
    // importa para "la app se siente lenta". 300KB es un techo generoso
    // (94KB medido tras el fix, con margen para crecimiento futuro real)
    // — si esto falla, algo volvió a colarse en el bundle crítico.
    const entryChunk = jsRequests.find((r) => /\/index-[\w-]+\.js$/.test(r.url));
    expect(entryChunk, 'no se encontró el chunk de entrada index-*.js').toBeTruthy();
    expect(entryChunk!.size).toBeLessThan(300 * 1024);
  });
});
