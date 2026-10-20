import { readFileSync } from 'node:fs';
import { request as playwrightRequest } from '@playwright/test';
import { assertTestProdWriteGuard } from '../../../scripts/test-prod-write-guard.mjs';
import { baseURL, expect, loginPage, PERSONA_PERMISSIONS, seed, test } from '../support/ops';

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

test('SMK-X01 login inválido e tenant inativo são distinguidos sem alterar o banco @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const admin = await ops.admin();
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const active = await context.post('/api/auth/login', {
      data: { email: tenant.ownerEmail, senha: tenant.ownerPassword },
      failOnStatusCode: false,
    });
    expect(active.status()).toBe(200);
    await admin.expect(admin.patch(`/api/admin/cervejarias/${tenant.id}/ativo`, { ativo: false }), 200, 'desativar tenant de QA');
    await evidence.checkpoint();

    const invalid = await context.post('/api/auth/login', {
      data: { email: 'missing-user@example.invalid', senha: 'Qa-invalid-synthetic-password' },
      failOnStatusCode: false,
    });
    expect(invalid.status()).toBe(401);

    const inactive = await context.post('/api/auth/login', {
      data: { email: tenant.ownerEmail, senha: tenant.ownerPassword },
      failOnStatusCode: false,
    });
    expect(inactive.status()).toBe(403);
  } finally {
    await context.dispose();
  }

  await evidence.assertNoDbChange();
});
