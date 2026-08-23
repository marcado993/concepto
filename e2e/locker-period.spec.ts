import { test, expect, type Page } from '@playwright/test';

// Hallazgo real de auditoría (Nielsen H2 "coincidencia con el mundo real"),
// y de paso un bug con peso contractual:
//
//   1. "Alquiler del periodo: $6.50" no decía de cuánto tiempo se habla —
//      un monto sin unidad no se puede evaluar (¿por mes? ¿por semestre?).
//   2. Peor: el texto de términos que el estudiante ACEPTA (y que queda
//      archivado firmado en AuditLog como prueba) decía "hasta fin del
//      semestre 2026-A" escrito a mano, mientras el periodo activo real en
//      producción ya era 2026-B. Se estaba firmando un semestre incorrecto.
//
// El arreglo hace que el semestre salga del backend — del MISMO dato con el
// que se asigna el alquiler (PeriodService.getCurrentPeriod). Estos tests
// fijan las dos mitades: que se muestre, y que no reviente cuando el
// backend todavía no lo manda.

const BASE_PRICE = { basePrice: 6.5, discountPercent: 0, tierName: null, price: { PAYPHONE: 6.5 } };

function makeLockers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    code: `A${String(i + 1).padStart(2, '0')}`,
    zone: 'A',
    status: 'AVAILABLE' as const,
  }));
}

async function gotoLockers(page: Page, myPriceBody: Record<string, unknown>) {
  await page.route('**/lockers', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeLockers(6)) })
  );
  // El mock TIENE que estar puesto antes de la carga: el preview de precio
  // se pide una sola vez al montar CategoryContent, no al cambiar de
  // categoría (comprobado a mano: cambiar de sección no vuelve a pedirlo).
  await page.route('**/lockers/my-price', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(myPriceBody) })
  );
  await page.route('**/security/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"zones":[],"points":{"type":"FeatureCollection","features":[]},"labels":{"type":"FeatureCollection","features":[]}}',
    })
  );
  await page.route('**/ventures', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/subscriptions/tiers', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/lockers/mine/rented', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  );

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

test('el precio nombra el semestre real que manda el backend, no uno escrito a mano', async ({ page }) => {
  await gotoLockers(page, { ...BASE_PRICE, period: { label: '2026-B', endsAt: '2027-02-28T00:00:00.000Z' } });

  await expect(page.locator('.locker-price-note')).toContainText('Alquiler del semestre 2026-B');
  await expect(page.locator('.locker-price-note')).toContainText('$6.50');
});

test('si el backend manda OTRO semestre, la UI lo sigue — nunca se queda con uno fijo', async ({ page }) => {
  await gotoLockers(page, { ...BASE_PRICE, period: { label: '2027-A', endsAt: '2027-08-31T00:00:00.000Z' } });

  await expect(page.locator('.locker-price-note')).toContainText('Alquiler del semestre 2027-A');
  await expect(page.locator('.locker-price-note')).not.toContainText('2026');
});

// El frontend (Vercel) se despliega en segundos y el backend (GitHub
// Actions → VPS) tarda minutos: SIEMPRE hay una ventana real en la que
// esta versión del frontend habla con un backend que todavía no manda
// `period`. Sin guarda, eso era un "cannot read properties of undefined"
// justo en la pantalla donde se ve el precio.
test('con un backend viejo que aún no manda el periodo, la pantalla no revienta y el precio se sigue viendo', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));

  await gotoLockers(page, BASE_PRICE); // sin `period`

  await expect(page.locator('.locker-price-note')).toContainText('$6.50');
  await expect(page.locator('.locker-price-note')).toContainText('Alquiler del semestre');
  await expect(page.locator('.unit').first()).toBeVisible();
  expect(errores.filter((m) => /undefined|null/i.test(m))).toEqual([]);
});
