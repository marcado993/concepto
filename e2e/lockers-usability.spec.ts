import { test, expect, type Page } from '@playwright/test';

// Auditoría de usabilidad real (crítica extrema pedida por el cliente):
// ¿qué tan fácil es alquilar un casillero mirando solo la grilla? Cuatro
// hallazgos reales encontrados y corregidos acá:
//   1. Las tarjetas libres no decían ninguna palabra de acción — solo
//      "Libre", nada que dijera "tocar aquí hace algo".
//   2. Sin buscador por número — con 108 casilleros, ir directo a "B05"
//      exigía escanear la grilla entera a ojo.
//   3. La leyenda mezclaba "Ocupado" y "Reservado" en una sola línea,
//      aunque la grilla ya los distingue con estilos distintos.
//   4. El reordenamiento (libres primero) salta números de casillero sin
//      explicar por qué — se lee como un bug de numeración, no una regla.
//
// Se mockea /lockers con datos sintéticos EN EL FORMATO REAL de la API
// (status en mayúsculas: AVAILABLE/RESERVED/RENTED, no el
// available/occupied/reserved interno) — usar el formato equivocado aquí
// hizo que la primera versión de este test pasara en falso (todo se veía
// "ocupado" porque el mapeo real no reconocía el valor).

function makeLockers(n: number, zoneCount = 2) {
  const zones = Array.from({ length: zoneCount }, (_, i) => String.fromCharCode(65 + i));
  const perZone = n / zoneCount;
  return Array.from({ length: n }, (_, i) => {
    const zone = zones[Math.floor(i / perZone)];
    const num = (i % perZone) + 1;
    let status: 'AVAILABLE' | 'RESERVED' | 'RENTED' = 'AVAILABLE';
    if (i % 4 === 1) status = 'RENTED';
    if (i % 4 === 2) status = 'RESERVED';
    return { id: `l${i}`, code: `${zone}${String(num).padStart(2, '0')}`, zone, status };
  });
}

async function gotoLockers(page: Page, lockerCount = 18) {
  await page.route('**/lockers', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeLockers(lockerCount)) })
  );
  await page.route('**/security/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"zones":[],"points":{"type":"FeatureCollection","features":[]},"labels":{"type":"FeatureCollection","features":[]}}',
    })
  );
  await page.route('**/ventures', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/subscriptions/tiers', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.addInitScript(() => {
    localStorage.setItem('aeis_access_token', 'e2e-fake-token');
    localStorage.setItem('aeis_ui_variant', 'B');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(2200);
  await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
  await page.waitForTimeout(1200);
}

test('cada casillero libre dice explícitamente "Toca para alquilar" — no solo "Libre"', async ({ page }) => {
  await gotoLockers(page);
  const firstAvailable = page.locator('.unit:not(.dim)').first();
  await expect(firstAvailable.locator('.unit-status')).toHaveText('Toca para alquilar');
});

test('el buscador filtra por número real, sin necesitar saber la zona de memoria', async ({ page }) => {
  await gotoLockers(page);
  await expect(page.locator('.unit')).toHaveCount(18);

  await page.locator('.locker-search-input').fill('B01');
  await expect(page.locator('.unit')).toHaveCount(1);
  await expect(page.locator('.unit-number')).toHaveText('B01');

  await page.locator('.locker-search-input').fill('');
  await expect(page.locator('.unit')).toHaveCount(18);
});

test('la leyenda distingue Ocupado de Reservado por separado, igual que ya distingue la grilla', async ({ page }) => {
  await gotoLockers(page);
  const legend = page.locator('.locker-legend');
  await expect(legend).toContainText('Libre');
  await expect(legend).toContainText('Ocupado');
  await expect(legend).toContainText('Reservado');
});

test('el salto de numeración (libres primero) queda explicado con un rótulo, no se ve como un bug', async ({ page }) => {
  await gotoLockers(page);
  await expect(page.locator('.grid-divider')).toHaveText('Ocupados y reservados');

  // El rótulo va justo donde termina el grupo de libres/tuyos y empieza
  // el de ocupados/reservados — nunca antes del primer libre.
  const unitsAndDivider = page.locator('.unit, .grid-divider');
  const count = await unitsAndDivider.count();
  let dividerIndex = -1;
  for (let i = 0; i < count; i++) {
    const cls = await unitsAndDivider.nth(i).getAttribute('class');
    if (cls?.includes('grid-divider')) dividerIndex = i;
  }
  expect(dividerIndex).toBeGreaterThan(0);
});

test('con todos los casilleros disponibles (ningún ocupado), no aparece ningún rótulo de corte', async ({ page }) => {
  await page.route('**/lockers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, code: `A0${i + 1}`, zone: 'A', status: 'AVAILABLE' }))
      ),
    })
  );
  await page.route('**/security/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"zones":[],"points":{"type":"FeatureCollection","features":[]},"labels":{"type":"FeatureCollection","features":[]}}',
    })
  );
  await page.route('**/ventures', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/subscriptions/tiers', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.addInitScript(() => {
    localStorage.setItem('aeis_access_token', 'e2e-fake-token');
    localStorage.setItem('aeis_ui_variant', 'B');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(2200);
  await page.locator('.accessible-item', { hasText: 'Casilleros' }).click();
  await page.waitForTimeout(1200);

  await expect(page.locator('.unit')).toHaveCount(6);
  await expect(page.locator('.grid-divider')).toHaveCount(0);
});
