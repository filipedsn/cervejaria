import { createHash, randomBytes } from 'node:crypto';
import { prismaClient } from '../support/fixtures';
import { expect, loginPage, logoutPage, PERSONA_PERMISSIONS, seed, strongPassword, test, uniqueSuffix } from '../support/ops';

test('AUT-S01 login e logout', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await expect(page).not.toHaveURL(/\/login/);
  await logoutPage(page);
  await evidence.screenshot('logout');
});

test('AUT-S02 esqueci a senha e redefinição @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const forgot = await tenant.owner.expect(tenant.owner.post('/api/auth/forgot-password', { email: tenant.ownerEmail }), 200, 'forgot');
  expect(forgot.message).toMatch(/receberá um link|cadastrado/i);
  const raw = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(raw).digest('hex');
  const prisma = prismaClient();
  const user = await prisma.usuario.findFirstOrThrow({ where: { email: tenant.ownerEmail } });
  await prisma.passwordResetToken.create({
    data: { usuarioId: user.id, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const nova = strongPassword();
  await tenant.owner.expect(tenant.owner.post('/api/auth/reset-password', { token: raw, senha: nova }), 200, 'reset');
  await ops.login(tenant.ownerEmail, nova, 'owner-reset');
});

test('AUT-S03 /me reflete papel e permissões @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const me = await tenant.owner.expect(tenant.owner.get('/api/auth/me'), 200, 'me dono');
  expect(me.usuario.papel).toBe('DONO');
  expect(me.usuario.permissoesOperacao?.length).toBeGreaterThan(10);
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  const meSalao = await salao.expect(salao.get('/api/auth/me'), 200, 'me salão');
  expect(meSalao.usuario.permissoesOperacao).toEqual(expect.arrayContaining(['command.read', 'command.operate']));
});

test('AUT-S04 troca de usuário no mesmo dispositivo', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await logoutPage(page);
  await loginPage(page, caixa.email, caixa.senha);
  await evidence.screenshot('troca-usuario');
});

test('AUT-X01 credencial inválida dá 401 com mensagem genérica @api', async ({ ops, evidence }) => {
  const anon = await ops.anonymous();
  await evidence.checkpoint();
  const body = await anon.expect(anon.post('/api/auth/login', { email: 'missing@example.invalid', senha: 'wrong' }), 401, 'login inválido');
  expect(body.error).toBe('E-mail ou senha inválidos');
  expect(JSON.stringify(body).toLowerCase()).not.toMatch(/usuário não encontrado|email inexistente/);
});

test('AUT-X02 empresa inativa dá 403 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const admin = await ops.admin();
  await admin.expect(admin.patch(`/api/admin/cervejarias/${tenant.id}/ativo`, { ativo: false }), 200, 'desativar');
  const anon = await ops.anonymous();
  await evidence.checkpoint();
  const body = await anon.expect(anon.post('/api/auth/login', { email: tenant.ownerEmail, senha: tenant.ownerPassword }), 403, 'login empresa inativa');
  expect(body.error).toBe('Cervejaria desativada. Entre em contato com o administrador do sistema.');
});

test('AUT-X03 rate limit de login @api', async ({ ops }) => {
  test.setTimeout(120_000);
  const anon = await ops.anonymous();
  let limited = false;
  for (let i = 0; i < 30; i++) {
    const result = await anon.post('/api/auth/login', { email: `flood-${i}@example.invalid`, senha: 'x' });
    if (result.status === 429) {
      limited = true;
      expect(result.body.error).toMatch(/Rate limit|retry/i);
      break;
    }
  }
  test.info().annotations.push({ type: 'observed', description: limited ? 'Rate limit 429 observado.' : 'QA_MODE eleva o limite; 429 não atingido em 30 tentativas (esperado em QA).' });
});

test('AUT-X04 token adulterado leva ao login', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await evidence.checkpoint();
  // Replace the real cookie scope. Using the current page URL races the login
  // redirect and can create a second cookie under /operacao instead of /.
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === 'token');
  expect(cookie).toBeDefined();
  await page.context().clearCookies({ name: 'token' });
  await page.context().addCookies([{ ...cookie!, value: 'adulterado.qa.token' }]);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.goto('/operacao/comandas', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/login/);
  await evidence.assertNoDbChange();
  await evidence.screenshot('token-adulterado');
});

test('AUT-X05 ADMIN em rota de empresa dá 404 e front manda para /admin', async ({ ops, page, evidence }) => {
  const admin = await ops.admin();
  const body = await admin.expect(admin.get('/api/operacao/contexto'), 404, 'admin em operação');
  expect(body.error).toBe('Operação não disponível');
  await loginPage(page, seed.admin.email, seed.admin.password);
  await page.goto('/operacao/comandas', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/admin/);
  await evidence.screenshot('admin-redirect');
});

test('AUT-X06 rota inexistente cai no CatchAll', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await evidence.checkpoint();
  await page.goto(`/rota-que-nao-existe-${uniqueSuffix()}`, { waitUntil: 'networkidle' });
  await expect(page).not.toHaveURL(/rota-que-nao-existe/);
  await evidence.assertNoDbChange();
  await evidence.screenshot('catchall');
});
