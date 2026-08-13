import { expect, test } from '@playwright/test';

test.describe('Modo TV fullscreen', () => {
  test('demo entra e sai da tela cheia nativa', async ({ page }) => {
    await page.goto('/ranking/tv/x?demo=5', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.qt-tv')).toBeVisible();

    const enterBtn = page.getByRole('button', { name: 'Tela cheia do navegador' });
    await expect(enterBtn).toBeVisible();

    await enterBtn.click();

    await expect
      .poll(
        async () => page.evaluate(() => document.fullscreenElement?.classList.contains('qt-tv') ?? false),
        { timeout: 10_000 },
      )
      .toBe(true);

    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });

    await expect
      .poll(async () => page.evaluate(() => document.fullscreenElement === null), { timeout: 10_000 })
      .toBe(true);
  });
});
