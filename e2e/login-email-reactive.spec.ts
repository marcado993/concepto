import { test, expect } from '@playwright/test';

// Reproduce el bug reportado: correo → código → verificar debe entrar a la
// app SIN refrescar. Se mockea el backend del flujo de correo para no
// depender de Logto/Resend reales.
test('el login por correo entra a la app sin refrescar', async ({ page }) => {
  await page.route('**/auth/email/start', (r) =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ pendingToken: 'tok-1' }) })
  );
  await page.route('**/auth/email/verify', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fake-access-token' }) })
  );
  // Datos que la app pide una vez adentro
  await page.route('**/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fullName: 'Test', uniqueCode: 'PENDIENTE-x', role: 'ESTUDIANTE', cedula: null, phone: null }) })
  );
  await page.route('**/lockers', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/security/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"zones":[],"points":{"type":"FeatureCollection","features":[]},"labels":{"type":"FeatureCollection","features":[]}}' }));
  await page.route('**/ventures', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/subscriptions/tiers', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('/');
  await page.waitForTimeout(1500);

  // Paso 1: correo
  await page.locator('input[placeholder="tu@correo.com"]').fill('estudiante@epn.edu.ec');
  await page.getByRole('button', { name: /continuar con correo/i }).click();

  // Paso 2: código
  await expect(page.locator('input[placeholder="000000"]')).toBeVisible({ timeout: 5000 });
  await page.locator('input[placeholder="000000"]').fill('123456');
  await page.getByRole('button', { name: /confirmar código/i }).click();

  // La pantalla de login DEBE desaparecer sola (sin reload). "Inicia sesión"
  // ya no debe estar visible, y debe aparecer la navegación de la app.
  await expect(page.getByRole('heading', { name: /inicia sesión/i })).toBeHidden({ timeout: 5000 });
  await expect(page.locator('.nav-item, .accessible-item').first()).toBeVisible({ timeout: 5000 });
});
