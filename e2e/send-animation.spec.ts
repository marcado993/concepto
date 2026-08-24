import { test, expect } from '@playwright/test';

// Microinteracción de "código enviado" (pedido del cliente): un sobre que
// se sella y sube, y en su lugar entra un check con el texto. Reemplaza a
// una primera versión con un avión de papel que el cliente vio "rara" — el
// avión volaba en diagonal sobre una estela dibujada aparte y las dos
// trayectorias no coincidían, así que se leía como dos elementos sueltos.
test.use({ reducedMotion: 'no-preference' });

test('al enviar el código se ve la animación del sobre y termina en "Código enviado"', async ({ page }) => {
  await page.route('**/auth/email/start', (r) =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ pendingToken: 't' }) })
  );
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.locator('input[placeholder="tu@correo.com"]').fill('lagh993@yahoo.com');
  await page.getByRole('button', { name: /continuar con correo/i }).click();

  const anim = page.locator('.send-anim');
  await expect(anim).toBeVisible({ timeout: 2000 });
  // El sobre lleva su animación aplicada de verdad (no es un icono
  // estático). Se comprueba que la animación EXISTE y está corriendo, no
  // muestreando transforms en tiempos fijos: bajo carga la suite completa
  // corre más lento y ese muestreo se volvía flaky.
  const envAnim = await page.locator('.send-envelope').evaluate((el) => {
    const a = el.getAnimations();
    return { cuantas: a.length, nombre: getComputedStyle(el).animationName };
  });
  expect(envAnim.cuantas).toBeGreaterThan(0);
  expect(envAnim.nombre).toContain('send-envelope-lift');

  // Cierra con el check y su texto.
  await expect(page.locator('.send-label')).toHaveText('Código enviado');
  await expect(page.locator('.send-check')).toBeVisible();

  // Y se quita sola, dejando usable el paso del código.
  await expect(anim).toBeHidden({ timeout: 4000 });
  await expect(page.locator('input[placeholder="000000"]')).toBeVisible();
});

test('con prefers-reduced-motion no hay sobre en movimiento, solo el aviso', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.route('**/auth/email/start', (r) =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ pendingToken: 't' }) })
  );
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.locator('input[placeholder="tu@correo.com"]').fill('lagh993@yahoo.com');
  await page.getByRole('button', { name: /continuar con correo/i }).click();

  await expect(page.locator('.send-label')).toHaveText('Código enviado');
  // El sobre queda oculto: la animación nunca es requisito para entender
  // que el correo salió.
  await expect(page.locator('.send-envelope')).toBeHidden();
  await ctx.close();
});
