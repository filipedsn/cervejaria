import { request as playwrightRequest, type Page } from '@playwright/test';
import { Api, baseURL, expect, test, uniquePhone, type Ops, type Tenant } from '../support/ops';

async function portalAberto(ops: Ops, settings?: Record<string, unknown>) {
  const tenant = await ops.tenant(undefined, settings);
  const sessao = await tenant.openCash(tenant.owner, 0);
  return Object.assign(tenant, { sessaoId: sessao.id as string });
}

const portalBase = (tenant: Tenant) => `/api/public/cervejarias/${tenant.slug}/pontos-venda/${tenant.pointId}`;

async function abrirNoPortal(page: Page, tenant: Tenant, nome: string) {
  await page.goto(`/c/${tenant.slug}/p/${tenant.pointId}`, { waitUntil: 'networkidle' });
  const busca = page.waitForResponse((response) => response.url().includes('/cliente-por-telefone'));
  await page.locator('#portal-pdv-telefone').fill(uniquePhone());
  await busca;
  await page.locator('#portal-pdv-nome').fill(nome);
  await page.getByRole('button', { name: 'Abrir comanda' }).click();
  await expect(page.getByText(/Comanda aberta · senha \d+\./)).toBeVisible();
}

async function clientePortal(ops: Ops, tenant: Tenant, nome = 'Cliente Portal QA') {
  const cliente = await ops.anonymous(`portal@${tenant.slug}`);
  const telefone = uniquePhone();
  const aberta = await cliente.expect(cliente.post(`${portalBase(tenant)}/comandas`, { nome, telefone }), 201, 'abrir comanda no portal');
  return { cliente, telefone, comanda: aberta.comanda };
}

test('POR-S01 cliente abre a comanda no QR do PDV com telefone e nome', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await abrirNoPortal(page, tenant, 'Cliente QR QA');
  await expect(page.getByRole('button', { name: 'Pedidos (0)' })).toBeVisible();
  await evidence.screenshot('comanda-aberta');
  const lista = await tenant.owner.expect(tenant.owner.get(`/api/operacao/comandas?pontoVendaId=${tenant.pointId}`), 200, 'comandas da equipe');
  const comandas = (Array.isArray(lista) ? lista : lista.comandas ?? lista.items) as Array<{ identificador: string; cliente?: { telefone?: string } }>;
  expect(comandas.find((c) => c.identificador === 'Cliente QR QA')).toBeTruthy();
});

test('POR-S02 cliente escolhe itens, limpa o carrinho e envia o pedido', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await abrirNoPortal(page, tenant, 'Cliente Pedido QA');
  await page.getByRole('button', { name: /Água QA/ }).click();
  await expect(page.getByRole('button', { name: 'Pedidos (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('button', { name: 'Pedidos (0)' })).toBeVisible();
  await page.getByRole('button', { name: /Lata QA/ }).click();
  await page.getByRole('button', { name: 'Aumentar Lata QA' }).click();
  await page.getByRole('button', { name: /Pilsen QA.*18,00/ }).click();
  await expect(page.getByRole('button', { name: 'Pedidos (2)' })).toBeVisible();
  await evidence.screenshot('carrinho');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByRole('button', { name: 'Pedidos (0)' })).toBeVisible();
  await page.getByRole('button', { name: 'Resumo da conta' }).click();
  await expect(page.getByText('2x Lata QA')).toBeVisible();
  await evidence.screenshot('resumo');
  const saldo = await tenant.stock();
  expect(saldo(tenant.catalog!.lata.id)).toBe(8);
  expect(saldo(tenant.catalog!.chope.id)).toBeCloseTo(49.5, 6);
  const lista = await tenant.owner.expect(tenant.owner.get(`/api/operacao/comandas?pontoVendaId=${tenant.pointId}`), 200, 'comandas da equipe');
  const comandas = (Array.isArray(lista) ? lista : lista.comandas ?? lista.items) as Array<{ identificador: string; total: number }>;
  expect(comandas.find((c) => c.identificador === 'Cliente Pedido QA')?.total).toBe(34);
});

test('POR-S03 o status do pedido muda no portal sem recarregar', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await abrirNoPortal(page, tenant, 'Cliente Status QA');
  await page.getByRole('button', { name: /Porção QA/ }).click();
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await page.getByRole('button', { name: 'Resumo da conta' }).click();
  await expect(page.getByText('1x Porção QA')).toBeVisible();
  const pedido = (await tenant.kitchenOrders(tenant.owner))[0] as { id: string };
  await tenant.advanceKitchen(tenant.owner, pedido.id, ['EM_PREPARO']);
  const inicio = Date.now();
  await expect(page.locator('.portal-pdv-summary article span').first()).toHaveText('EM_PREPARO', { timeout: 7_000 });
  test.info().annotations.push({ type: 'observed', description: `status refletido em ${Date.now() - inicio} ms; o portal exibe o código bruto do status (EM_PREPARO)` });
  await evidence.screenshot('status');
});

test('POR-S04 resumo do portal bate com a comanda da equipe @api', async ({ ops }) => {
  const tenant = await portalAberto(ops);
  const { cliente, comanda } = await clientePortal(ops, tenant);
  await cliente.expect(cliente.post(`${portalBase(tenant)}/comanda/pedidos`, { itens: [tenant.item('lata', 2), tenant.chopeItem(500, 1)] }), 201, 'pedido do portal');
  const doPortal = await cliente.expect(cliente.get(`${portalBase(tenant)}/comanda`), 200, 'resumo do portal');
  const daEquipe = await tenant.comanda(tenant.owner, comanda.id);
  expect(daEquipe.total).toBe(34);
  expect(doPortal.total).toBe(daEquipe.total);
  const itensPortal = doPortal.pedidos.flatMap((p: { itens: Array<{ nome: string; quantidade: number }> }) => p.itens).map((i: { nome: string; quantidade: number }) => `${i.quantidade}x ${i.nome}`).sort();
  const itensEquipe = daEquipe.pedidos.flatMap((p: { itens: Array<{ nome: string; quantidade: number }> }) => p.itens).map((i: { nome: string; quantidade: number }) => `${i.quantidade}x ${i.nome}`).sort();
  expect(itensPortal).toEqual(itensEquipe);
});

test('POR-S05 pedido do portal entra no caixa e no fechamento @api', async ({ ops }) => {
  const tenant = await portalAberto(ops);
  const { cliente, comanda } = await clientePortal(ops, tenant);
  await cliente.expect(cliente.post(`${portalBase(tenant)}/comanda/pedidos`, { itens: [tenant.item('lata', 1)] }), 201, 'pedido do portal');
  expect((await tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 8 }])).status).toBe(200);
  const estado = await tenant.cashState();
  expect(estado.sessao.esperado.pix).toBe(8);
  await tenant.closeCash();
  const relatorio = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa/sessoes/${tenant.sessaoId}`), 200, 'resumo do turno');
  expect(relatorio).toMatchObject({ comandasAtendidas: 1, vendasTotal: 8 });
});

test('POR-X01 slug, PDV ou empresa inválidos não abrem o portal', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  const anon = await ops.anonymous();
  await anon.expect(anon.get(`${portalBase(tenant)}/info`), 200, 'controle positivo');
  await evidence.checkpoint();
  const slugInvalido = await anon.expect(anon.get(`/api/public/cervejarias/slug-inexistente-qa/pontos-venda/${tenant.pointId}/info`), 404, 'slug inválido');
  expect(slugInvalido.error).toBe('Link inválido');
  const pdvInvalido = await anon.expect(anon.get(`/api/public/cervejarias/${tenant.slug}/pontos-venda/pdv-inexistente/info`), 404, 'PDV inválido');
  expect(pdvInvalido.error).toBe('Link inválido');
  await page.goto(`/c/slug-inexistente-qa/p/${tenant.pointId}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Este QR Code não é válido.')).toBeVisible();
  await evidence.screenshot('link-invalido');
  await evidence.assertNoDbChange();
  const admin = await ops.admin();
  await admin.expect(admin.patch(`/api/admin/cervejarias/${tenant.id}/ativo`, { ativo: false }), 200, 'desativar empresa');
  await evidence.checkpoint();
  const inativa = await anon.expect(anon.get(`${portalBase(tenant)}/info`), 404, 'empresa inativa');
  expect(inativa.error).toBe('Link inválido');
  await evidence.assertNoDbChange();
});

test.fixme('POR-X02 cliente bloqueado não abre comanda pelo portal', async () => {
  test.info().annotations.push({ type: 'product-gap', description: 'Não existe bloqueio de cliente. Cliente desativado (ativo:false) é reativado ao abrir comanda pelo portal (registerOrUpdateCliente faz upsert com ativo:true).' });
});

test('POR-X03 sessão ausente, adulterada ou de comanda encerrada é recusada @api', async ({ ops, evidence }) => {
  const tenant = await portalAberto(ops);
  const semCookie = await ops.anonymous('sem-cookie');
  await evidence.checkpoint();
  const ausente = await semCookie.expect(semCookie.get(`${portalBase(tenant)}/comanda`), 401, 'sem sessão');
  expect(ausente.error).toBe('Sessão expirada. Identifique-se novamente.');
  const ctx = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Cookie: 'cliente_pdv_token=adulterado.qa.token' } });
  try {
    const adulterado = new Api(ctx, 'cookie-adulterado', evidence);
    const invalida = await adulterado.expect(adulterado.get(`${portalBase(tenant)}/comanda`), 401, 'sessão adulterada');
    expect(invalida.error).toBe('Sessão inválida.');
  } finally {
    await ctx.dispose();
  }
  await evidence.assertNoDbChange();
  const { cliente, comanda } = await clientePortal(ops, tenant);
  await cliente.expect(cliente.get(`${portalBase(tenant)}/comanda`), 200, 'controle positivo');
  await tenant.owner.expect(tenant.owner.post(`/api/operacao/comandas/${comanda.id}/cancelar`, { motivo: 'Cliente foi embora' }), 200, 'equipe cancela');
  await evidence.checkpoint();
  const encerrada = await cliente.expect(cliente.get(`${portalBase(tenant)}/comanda`), 401, 'comanda encerrada');
  expect(encerrada.error).toBe('Comanda encerrada. Identifique-se novamente.');
  await evidence.assertNoDbChange();
});

test('POR-X04 link de trailer em empresa canônica não abre portal', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await evidence.checkpoint();
  await page.goto(`/c/${tenant.slug}/t/trailer-inexistente`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Link inválido').first()).toBeVisible();
  await expect(page.locator('#portal-pdv-telefone')).toHaveCount(0);
  await evidence.screenshot('trailer');
  await evidence.assertNoDbChange();
});

test('POR-X05 link de cadastro mostra a página de link descontinuado', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await evidence.checkpoint();
  await page.goto(`/c/${tenant.slug}/cadastro`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/Este link de cadastro não abre comanda\./)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Acesso da equipe' })).toBeVisible();
  test.info().annotations.push({ type: 'observed', description: 'A página orienta escanear o QR do "trailer"; no modelo canônico o QR é do ponto de venda.' });
  await evidence.screenshot('cadastro');
  await evidence.assertNoDbChange();
});
