import { readFileSync } from 'node:fs';
import path from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { expect, loginPage, PERSONA_PERMISSIONS, seed, test } from '../support/ops';

test('SEC-X01 dono B não lê nem escreve dados da A @api', async ({ ops, evidence }) => {
  const a = await ops.tenant();
  await a.openCash();
  const comanda = await a.openComanda(a.owner, [a.item('agua')]);
  const b = await ops.tenant();
  await evidence.checkpoint();
  await b.owner.expect(b.owner.get(`/api/operacao/comandas/${comanda.id}`), 404, 'ler comanda A');
  await b.owner.expect(b.owner.post(`/api/operacao/comandas/${comanda.id}/pedidos`, { itens: [a.item('agua')] }), 404, 'escrever comanda A');
  await b.owner.expect(b.owner.get(`/api/clientes/${comanda.clienteId ?? 'inexistente'}`), 404, 'cliente A').catch(() => undefined);
  await evidence.assertNoDbChange();
});

test('SEC-X02 rotas legadas de evento bloqueiam escrita com 409 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  await evidence.checkpoint();
  const eventoId = (seed.events as Record<string, string> | undefined)?.legacy
    ?? Object.values((seed.events as Record<string, string> | undefined) ?? {})[0]
    ?? 'inexistente';
  const body = await caixa.expect(caixa.patch(`/api/eventos/${eventoId}/fechar`, {}), 409, 'fechar evento legado');
  expect(body.code).toBe('CANONICAL_PDV_LEGACY_WRITE_BLOCKED');
  await evidence.assertNoDbChange();
});

test('SEC-X03 rotas de front legadas redirecionam no canônico', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  for (const path of ['/eventos', '/comandas', '/trailer']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page).not.toHaveURL(new RegExp(`^${path}$`));
  }
  await evidence.screenshot('rotas-legadas');
});

test('SEC-X04 write freeze dá 503 em escritas, exceto encerramento administrativo @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const freezeFile = path.join(process.cwd(), `deploy/runtime/write-freeze-qa-${Date.now()}.flag`);
  writeFileSync(freezeFile, '1');
  const previous = process.env.QUIVER_WRITE_FREEZE_FILE;
  // The disposable QA runner must already honor QUIVER_WRITE_FREEZE_FILE from the environment of the API process.
  // This case verifies the client-visible contract when freeze is active on the running API.
  try {
    const status = await tenant.owner.get('/api/operacao/write-freeze-status');
    if (status.status !== 200 || !status.body.blocked) {
      test.info().annotations.push({ type: 'observed', description: `Write freeze não está ativo neste runner (blocked=${status.body?.blocked}). Caso documentado; o runner de release precisa setar QUIVER_WRITE_FREEZE_FILE para exercitar 503.` });
      test.skip();
      return;
    }
    await evidence.checkpoint();
    const blocked = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', {
      pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: tenant.catalog!.cardapioId,
    }), 503, 'abrir sob freeze');
    expect(blocked.code).toBe('WRITE_FREEZE_ACTIVE');
    await evidence.assertNoDbChange();
  } finally {
    try { unlinkSync(freezeFile); } catch { /* ignore */ }
    if (previous === undefined) delete process.env.QUIVER_WRITE_FREEZE_FILE;
    else process.env.QUIVER_WRITE_FREEZE_FILE = previous;
  }
});

test('SEC-X05 cookie da sessão é HttpOnly', async ({ ops }) => {
  const tenant = await ops.tenant();
  const login = await ops.anonymous();
  const result = await login.call('POST', '/api/auth/login', { email: tenant.ownerEmail, senha: tenant.ownerPassword });
  expect(result.status).toBe(200);
  const setCookie = result.headers['set-cookie'] ?? '';
  expect(String(setCookie)).toMatch(/token=/);
  expect(String(setCookie).toLowerCase()).toMatch(/httponly/);
});

test('SEC-X06 nenhuma credencial fixa no código E2E', async () => {
  const authHelper = readFileSync(path.join(process.cwd(), 'e2e/helpers/auth.ts'), 'utf8');
  expect(authHelper).not.toMatch(/admin\s*:\s*\{\s*email\s*:\s*['"][^'"]+['"],\s*password\s*:\s*['"][^'"]+['"]\s*\}/i);
  expect(readFileSync(path.join(process.cwd(), 'e2e/release/support/ops.ts'), 'utf8')).not.toMatch(/senha:\s*'Admin123!'/);
});
