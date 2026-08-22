import { test, expect } from '@playwright/test';

// Botón "Reenviar código" con espera de 3 minutos, pedido explícito tras
// un bug real en producción: un código de Logto puede vencer o quedar
// inválido después de usarse, y la ÚNICA forma de pedir uno nuevo era
// "‹ Usar otro correo" (que ni siquiera reenviaba nada, solo volvía al
// paso 1). Estos tests mockean /auth/email/start y /auth/email/verify —
// no hay forma de automatizar un login real contra Logto — y usan
// page.clock para adelantar los 3 minutos sin esperarlos de verdad.

async function mockEmailStart(page: import('@playwright/test').Page, pendingToken: string) {
  await page.route('**/auth/email/start', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ pendingToken }) })
  );
}

test('el botón de reenviar arranca deshabilitado con cuenta regresiva y se habilita a los 3 minutos', async ({ page }) => {
  await page.clock.install();
  await mockEmailStart(page, 'token-1');
  await page.goto('/');

  await page.locator('#login-email').fill('estudiante@epn.edu.ec');
  await page.locator('button', { hasText: 'Continuar con correo' }).click();

  const resendBtn = page.locator('button', { hasText: /Reenviar código/ });
  await expect(resendBtn).toBeVisible();
  await expect(resendBtn).toBeDisabled();
  await expect(resendBtn).toHaveText(/Reenviar código en \d:\d\d/);

  // A la mitad del plazo sigue deshabilitado — no se prueba el segundo
  // exacto del límite (179s vs 180s): cada assert con reintento que corre
  // ANTES del fastForward gasta tiempo real, y ese tiempo real se suma al
  // salto — perseguir el filo exacto de 1 segundo hace el test fràgil sin
  // probar nada que de verdad importe (a nadie le interesa el milisegundo
  // exacto, solo que espere ~3 minutos de verdad).
  await page.clock.fastForward(90_000);
  await expect(resendBtn).toBeDisabled();

  // Bien pasado el plazo, ya se habilitó.
  await page.clock.fastForward(95_000);
  await expect(resendBtn).toBeEnabled();
  await expect(resendBtn).toHaveText('Reenviar código');
});

test('tocar reenviar pide un código nuevo, limpia el campo y reinicia la cuenta regresiva', async ({ page }) => {
  await page.clock.install();
  let starts = 0;
  await page.route('**/auth/email/start', (route) => {
    starts++;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ pendingToken: `token-${starts}` }),
    });
  });
  await page.goto('/');

  await page.locator('#login-email').fill('estudiante@epn.edu.ec');
  await page.locator('button', { hasText: 'Continuar con correo' }).click();
  await expect(page.locator('input#login-otp')).toBeVisible();
  await page.locator('input#login-otp').fill('123456');

  await page.clock.fastForward(180_000);
  const resendBtn = page.locator('button', { hasText: /Reenviar código/ });
  await expect(resendBtn).toBeEnabled();
  await resendBtn.click();

  await expect.poll(() => starts).toBe(2);
  await expect(page.locator('input#login-otp')).toHaveValue('');
  await expect(resendBtn).toBeDisabled();
  // Rango amplio a propósito (no "2:5X" exacto) — confirma que la cuenta
  // reinició cerca de 3 minutos sin perseguir el segundo exacto, que es
  // frágil por el mismo motivo explicado en el primer test.
  await expect(resendBtn).toHaveText(/Reenviar código en [12]:\d\d/);
});
