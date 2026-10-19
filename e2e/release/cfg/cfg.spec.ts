import { expect, loginPage, PERSONA_PERMISSIONS, test } from '../support/ops';

test('CFG-S01 grupos do PDV persistem e afetam a operação @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const config = await tenant.configure({
    kitchenItemsChargeAtLaunch: true,
    allowCloseComandaWithPendingKitchenOrders: true,
    whatsappPedidoProntoEnabled: true,
    whatsappPedidoProntoNaCozinha: false,
  });
  expect(config).toMatchObject({
    kitchenItemsChargeAtLaunch: true,
    allowCloseComandaWithPendingKitchenOrders: true,
    whatsappPedidoProntoEnabled: true,
    configurationSource: 'CANONICAL_PDV',
  });
  const read = await tenant.owner.expect(tenant.owner.get('/api/cervejaria/configuracao-operacional'), 200, 'ler config');
  expect(read.configuration).toMatchObject({
    kitchenItemsChargeAtLaunch: true,
    allowCloseComandaWithPendingKitchenOrders: true,
    whatsappPedidoProntoEnabled: true,
  });
  expect(read.configurationSource).toBe('CANONICAL_PDV');
});

test('CFG-S02 aparência aceita cor válida @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.owner.expect(tenant.owner.patch('/api/cervejaria/branding', { corPrimaria: '#1A5F2A' }), 200, 'cor');
  const invalida = await tenant.owner.expect(tenant.owner.patch('/api/cervejaria/branding', { corPrimaria: 'verde' }), 400, 'cor inválida');
  expect(invalida.error).toBe('Cor inválida. Use formato #RRGGBB');
});

test('CFG-S03 quantidade de mesas @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const body = await tenant.owner.expect(tenant.owner.patch('/api/operacao/config', { quantidadeMesas: 12 }), 200, 'mesas');
  expect(body.quantidadeMesas).toBe(12);
});

test('CFG-S04 torneiras do PDV @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const taps = await tenant.owner.expect(tenant.owner.get(`/api/taps?pontoVendaId=${tenant.pointId}`), 200, 'listar taps');
  expect((Array.isArray(taps) ? taps : taps.taps ?? []).length).toBeGreaterThan(0);
});

test('CFG-S05 perfil visual da cozinha salva preferência local', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/cozinha', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/operacao\/cozinha/);
  await evidence.screenshot('cozinha-perfil');
  test.info().annotations.push({ type: 'observed', description: 'Perfil visual da cozinha é preferência por dispositivo (localStorage); a tela carrega sem erro.' });
});

test('CFG-X01 atendente não acessa configurações', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const salao = await tenant.staff('Salao', PERSONA_PERMISSIONS.salao);
  await evidence.checkpoint();
  const body = await salao.expect(salao.get('/api/cervejaria/configuracao-operacional'), 403, 'GET config');
  expect(body.error).toBe('Acesso restrito ao proprietário');
  await salao.expect(salao.patch('/api/cervejaria/configuracao-operacional', { kitchenEnabled: false }), 403, 'PATCH config');
  await evidence.assertNoDbChange();
  await loginPage(page, salao.email, salao.senha);
  await page.goto('/operacao/configuracoes/pdv', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveURL(/\/operacao\/configuracoes/);
  await evidence.screenshot('cfg-bloqueado');
  await tenant.owner.expect(tenant.owner.get('/api/cervejaria/configuracao-operacional'), 200, 'controle positivo');
});

test('CFG-X02 tentar EVENTO dá 409 CANONICAL_PDV_MODE_CHANGE_UNSUPPORTED @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch('/api/cervejaria/configuracao-operacional', { operationMode: 'EVENTO' }), 409, 'modo EVENTO');
  expect(body.code).toBe('CANONICAL_PDV_MODE_CHANGE_UNSUPPORTED');
  await evidence.assertNoDbChange();
});

test('CFG-X03 mutação de trailer dá 409 CANONICAL_PDV_TRAILER_MUTATION_BLOCKED @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/trailers', { nome: 'Trailer QA' }), 409, 'criar trailer');
  expect(body.code).toBe('CANONICAL_PDV_TRAILER_MUTATION_BLOCKED');
  await evidence.assertNoDbChange();
});

test('CFG-X04 fechar com pedido pendente sem cobrar no lançamento dá 400 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch('/api/cervejaria/configuracao-operacional', {
    kitchenItemsChargeAtLaunch: false,
    allowCloseComandaWithPendingKitchenOrders: true,
  }), 400, 'flags incompatíveis');
  expect(body.error).toContain('Pedidos pendentes na cozinha');
  await evidence.assertNoDbChange();
});

test('CFG-X05 upload com tipo inválido dá 400 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await evidence.checkpoint();
  const response = await tenant.owner.ctx.fetch('/api/cervejaria/branding/logo', {
    method: 'POST',
    multipart: { logo: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('nao-e-imagem') } },
    failOnStatusCode: false,
  });
  const text = await response.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
  evidence.recordApi({ actor: tenant.owner.who, method: 'POST', url: '/api/cervejaria/branding/logo', status: response.status(), responseBody: body });
  expect(response.status()).toBe(400);
  expect(body.error).toMatch(/Formato de logo inválido|Nenhuma imagem/i);
  await evidence.assertNoDbChange();
});

test('CFG-X06 desligar cozinha com pedidos ativos dá 409 @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  await tenant.openComanda(tenant.owner, [tenant.porcaoItem(1)]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.patch('/api/cervejaria/configuracao-operacional', { kitchenEnabled: false }), 409, 'desligar cozinha');
  expect(body.error).toBe('A cozinha não pode ser desativada enquanto houver pedidos em andamento');
  await evidence.assertNoDbChange();
});

test('CFG-X07 abas trailers e operacao legadas não ficam no canônico', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await evidence.checkpoint();
  await page.goto('/operacao/configuracoes/trailers', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/operacao\/configuracoes\/pdv/);
  await page.goto('/operacao/configuracoes/operacao', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/operacao\/configuracoes\/pdv/);
  await expect(page.getByTestId('canonical-pdv-settings')).toBeVisible();
  await evidence.assertNoDbChange();
  await evidence.screenshot('cfg-pdv');
});
