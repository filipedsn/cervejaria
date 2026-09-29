import { expect, test, type Page } from '@playwright/test';

async function ensureServiceWorkerControls(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.active?.state === 'activated';
    },
    undefined,
    { timeout: 30_000 },
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (controlled) return;

    // A newly activated service worker can take control while this reload is
    // in flight. Chromium then reports ERR_ABORTED even though the next
    // document is correctly controlled; treat that takeover as expected and
    // assert the resulting page state below.
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (!String(error).includes('ERR_ABORTED')) throw error;
    }
    await expect(page.locator('#email')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.active?.state === 'activated';
      },
      undefined,
      { timeout: 15_000 },
    );
  }

  await expect
    .poll(async () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 10_000 })
    .toBe(true);
}

test.describe('PWA offline', () => {
  test('service worker controla a página e login segue interativo offline', async ({ page, context }) => {
    test.setTimeout(60_000);

    await ensureServiceWorkerControls(page);

    const swInfo = await page.evaluate(async () => ({
      hasRegistration: Boolean(await navigator.serviceWorker.getRegistration()),
      controlled: Boolean(navigator.serviceWorker.controller),
      scope: (await navigator.serviceWorker.getRegistration())?.scope ?? '',
      state: (await navigator.serviceWorker.getRegistration())?.active?.state ?? '',
    }));

    expect(swInfo.hasRegistration).toBe(true);
    expect(swInfo.controlled).toBe(true);
    expect(swInfo.state).toBe('activated');
    expect(swInfo.scope).toContain(new URL(page.url()).origin);

    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    await page.locator('#email').fill('offline@qa.test');
    await context.setOffline(true);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#password')).toBeVisible({ timeout: 15_000 });
    await page.locator('#password').fill('123456');

    await expect(page.locator('#email')).toHaveValue('offline@qa.test');
    await expect(page.locator('#password')).toHaveValue('123456');
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });
});
