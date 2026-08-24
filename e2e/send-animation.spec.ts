import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'no-preference' });

test('animación de avión al enviar el código', async ({ page }) => {
  await page.route('**/auth/email/start', (r) =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ pendingToken: 't' }) })
  );
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.locator('input[placeholder="tu@correo.com"]').fill('lagh993@yahoo.com');
  await page.getByRole('button', { name: /continuar con correo/i }).click();

  // El overlay de envío aparece
  const anim = page.locator('.send-anim');
  await expect(anim).toBeVisible({ timeout: 2000 });

  // Capturar el avión en vuelo (~280ms): muestrear el transform real
  await page.waitForTimeout(280);
  const mid = await page.locator('.send-plane').evaluate((el) => getComputedStyle(el).transform);

  // Screenshot en pleno vuelo

  // El check "Código enviado" termina apareciendo
  await page.waitForTimeout(700);
  const label = await page.locator('.send-label').textContent();

  console.log('PLANE_TRANSFORM_MID=', mid);
  console.log('LABEL=', label);
  expect(label).toContain('Código enviado');
});
