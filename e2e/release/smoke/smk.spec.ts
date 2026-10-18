import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { assertTestProdWriteGuard } from '../../../scripts/test-prod-write-guard.mjs';

const context = JSON.parse(readFileSync(process.env.RELEASE_QA_CONTEXT!, 'utf8'));
const baseURL = process.env.RELEASE_QA_BASE_URL!;

test('SMK-S01 health informa o commit da execução', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect((await response.json()).releaseSha).toBe(context.releaseSha);
});

test('SMK-S02 readiness responde 200', async ({ request }) => {
  const response = await request.get('/api/ready');
  expect(response.status()).toBe(200);
});

test('SMK-S03 guard recusa alvo de produção', async () => {
  expect(() => assertTestProdWriteGuard({ apiBase: 'http://127.0.0.1:3001', context: 'SMK-S03' })).toThrow(/production-like/);
});

test('SMK-S04 login leva cada persona à tela operacional correta', async ({ browser }, testInfo) => {
  for (const [persona, expected] of [['owner', /\/operacao\/comandas/], ['cashier', /\/operacao\/comandas/], ['kitchen', /\/operacao\/cozinha/]] as const) {
    const credentials = context.users[persona];
    const use = testInfo.project.use;
    const isolated = await browser.newContext({
      baseURL,
      viewport: use.viewport as { width: number; height: number } | undefined,
      isMobile: use.isMobile as boolean | undefined,
      deviceScaleFactor: use.deviceScaleFactor as number | undefined,
      serviceWorkers: 'block',
    });
    try {
      const page = await isolated.newPage();
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.getByLabel('E-mail').fill(credentials.email);
      await page.locator('#password').fill(credentials.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page).toHaveURL(expected);
    } finally {
      await isolated.close();
    }
  }
});
