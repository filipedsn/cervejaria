import { expect, test } from '../support/fixtures';
import { readFileSync } from 'node:fs';
import { assertTestProdWriteGuard } from '../../../scripts/test-prod-write-guard.mjs';
import { personaStorageState, type PersonaKey } from '../support/personas';

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

test('SMK-S04 login leva cada persona à tela operacional correta', async ({ browser }) => {
  for (const [persona, expected] of [['owner', /\/operacao\/comandas/], ['cashier', /\/operacao\/comandas/], ['kitchen', /\/operacao\/cozinha/]] as const) {
    const isolated = await browser.newContext({ baseURL, storageState: personaStorageState(persona as PersonaKey), serviceWorkers: 'block' });
    try {
      const page = await isolated.newPage();
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(expected);
    } finally {
      await isolated.close();
    }
  }
});
