import { readFileSync } from 'node:fs';
import { assertTestProdWriteGuard } from '../../../scripts/test-prod-write-guard.mjs';
import { expect, loginPage, PERSONA_PERMISSIONS, seed, test } from '../support/ops';

test('SMK-S01 health informa o commit da execução @api', async ({ ops }) => {
  const anon = await ops.anonymous();
  const body = await anon.expect(anon.get('/api/health'), 200, 'health');
  expect(body.releaseSha).toBe(seed.releaseSha);
});

test('SMK-S02 readiness responde 200 @api', async ({ ops }) => {
  const anon = await ops.anonymous();
  await anon.expect(anon.get('/api/ready'), 200, 'ready');
});

test('SMK-S03 guard recusa alvo de produção', async () => {
  expect(() => assertTestProdWriteGuard({ apiBase: 'http://127.0.0.1:3001', context: 'SMK-S03' })).toThrow(/production-like/);
});

test('SMK-S04 login leva cada persona à tela operacional correta', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  const cozinha = await tenant.staff('Cozinha', PERSONA_PERMISSIONS.cozinha);
  for (const [email, senha, expected] of [
    [tenant.ownerEmail, tenant.ownerPassword, /\/operacao\/comandas/],
    [caixa.email, caixa.senha, /\/operacao\/comandas/],
    [cozinha.email, cozinha.senha, /\/operacao\/cozinha/],
  ] as const) {
    await loginPage(page, email, senha);
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(expected);
    await page.context().clearCookies();
  }
  await evidence.screenshot('personas');
});
