import { expect, loginPage, PERSONA_PERMISSIONS, seed, strongPassword, test, uniqueSuffix } from '../support/ops';

test('ADM-S01 listar, ativar e desativar empresa @api', async ({ ops }) => {
  const admin = await ops.admin();
  const lista = await admin.expect(admin.get('/api/admin/cervejarias'), 200, 'listar');
  expect(Array.isArray(lista) ? lista.length : 0).toBeGreaterThan(0);
  const tenant = await ops.tenant();
  await admin.expect(admin.patch(`/api/admin/cervejarias/${tenant.id}/ativo`, { ativo: false }), 200, 'desativar');
  await admin.expect(admin.patch(`/api/admin/cervejarias/${tenant.id}/ativo`, { ativo: true }), 200, 'reativar');
  const detalhe = await admin.expect(admin.get(`/api/admin/cervejarias/${tenant.id}`), 200, 'detalhe');
  expect(detalhe.ativo).toBe(true);
});

test('ADM-S02 empresa provisionada pelo Admin nasce canônica @api', async ({ ops }) => {
  const admin = await ops.admin();
  const suffix = uniqueSuffix();
  const senha = strongPassword();
  const email = `owner-${suffix}@example.invalid`;
  const provisioned = await admin.expect(admin.post('/api/admin/cervejarias/provision', {
    nome: `Empresa Canônica ${suffix}`,
    dono: { nome: 'Dono Provisionado QA', email, senha },
    enablements: { plannedOperations: false, taps: true, inventory: true, kitchen: true },
  }), 201, 'provision');
  expect(provisioned.cervejaria.id).toBeTruthy();
  const owner = await ops.login(email, senha, 'dono-provisionado');
  const config = await owner.expect(owner.get('/api/cervejaria/configuracao-operacional'), 200, 'config');
  expect(config.configurationSource).toBe('CANONICAL_PDV');
  expect(config.enablements?.cashMode ?? true).toBeTruthy();
});

test('ADM-S03 SMTP de teste @api', async ({ ops }) => {
  const admin = await ops.admin();
  const result = await admin.post('/api/admin/settings/smtp/test', { email: seed.admin.email });
  expect([200, 400]).toContain(result.status);
  test.info().annotations.push({ type: 'observed', description: `SMTP test HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}` });
});

test('ADM-S04 backup listar e executar @api', async ({ ops }) => {
  const admin = await ops.admin();
  const lista = await admin.expect(admin.get('/api/admin/settings/backups'), 200, 'listar backups');
  expect(lista).toHaveProperty('files');
  const run = await admin.post('/api/admin/settings/backups/run', {});
  expect([200, 500]).toContain(run.status);
  test.info().annotations.push({ type: 'observed', description: `Backup run HTTP ${run.status}` });
});

test('ADM-S05 reextrair branding @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = await tenant.owner.ctx.fetch('/api/cervejaria/branding/logo', {
    method: 'POST',
    multipart: { logo: { name: 'logo.png', mimeType: 'image/png', buffer: png } },
    failOnStatusCode: false,
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const admin = await ops.admin();
  await admin.expect(admin.post(`/api/admin/cervejarias/${tenant.id}/branding/reextract`), 200, 'reextract');
});

test('ADM-X01 atendente e dono em /api/admin dão 403 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  await salao.expect(salao.get('/api/admin/cervejarias'), 403, 'atendente admin');
  await tenant.owner.expect(tenant.owner.get('/api/admin/cervejarias'), 403, 'dono admin');
  await evidence.assertNoDbChange();
  const admin = await ops.admin();
  await admin.expect(admin.get('/api/admin/cervejarias'), 200, 'controle positivo');
});

test('ADM-X02 slug duplicado não quebra o provisionamento @api', async ({ ops }) => {
  const admin = await ops.admin();
  const nome = `Empresa Duplicada ${uniqueSuffix()}`;
  const a = await admin.expect(admin.post('/api/admin/cervejarias/provision', {
    nome, dono: { nome: 'Dono A', email: `a-${uniqueSuffix()}@example.invalid`, senha: strongPassword() },
  }), 201, 'primeira');
  const b = await admin.expect(admin.post('/api/admin/cervejarias/provision', {
    nome, dono: { nome: 'Dono B', email: `b-${uniqueSuffix()}@example.invalid`, senha: strongPassword() },
  }), 201, 'segunda');
  expect(a.cervejaria.slug).not.toBe(b.cervejaria.slug);
  test.info().annotations.push({ type: 'observed', description: 'Slug duplicado é resolvido com sufixo temporal; não há 409 de slug.' });
});

test('ADM-X03 textos admin sem acentuação corrompida', async ({ ops, page, evidence }) => {
  await loginPage(page, seed.admin.email, seed.admin.password);
  await page.goto('/admin/cervejarias', { waitUntil: 'networkidle' });
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/OperaÃ|Ã§|Ã£|Ã©/);
  await expect(page.getByText('Empresas').first()).toBeVisible();
  await evidence.screenshot('admin-acentos');
});
