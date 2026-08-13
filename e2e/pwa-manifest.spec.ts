import { expect, test } from '@playwright/test';

test.describe('PWA', () => {
  test('manifest.webmanifest está publicado', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();

    const manifest = (await res.json()) as { name?: string; start_url?: string };
    expect(manifest.name).toContain('Quiver Tap');
    expect(manifest.start_url).toBeTruthy();
  });

  test('login expõe favicon', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /.+/);
  });
});
