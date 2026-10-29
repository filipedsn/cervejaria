import { request as playwrightRequest, type Page } from '@playwright/test';
import { Api, baseURL, expect, test, uniquePhone, type Ops, type Tenant } from '../support/ops';
import { prismaClient } from '../support/fixtures';

async function portalAberto(ops: Ops, settings?: Record<string, unknown>) {
  const tenant = await ops.tenant(undefined, settings);
  const sessao = await tenant.openCash(tenant.owner, 0);
  return Object.assign(tenant, { sessaoId: sessao.id as string });
}

const portalBase = (tenant: Tenant) => `/api/public/cervejarias/${tenant.slug}/pontos-venda/${tenant.pointId}`;

async function adicionarNoPortal(page: Page, nome: RegExp) {
  await page.getByRole('button', { name: nome }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
}

async function abrirNoPortal(page: Page, tenant: Tenant, nome: string, telefone = uniquePhone()) {
  await page.goto(`/c/${tenant.slug}/p/${tenant.pointId}`, { waitUntil: 'networkidle' });
  const busca = page.waitForResponse((response) => response.url().includes('/cliente-por-telefone'));
  await page.locator('#portal-pdv-telefone').fill(telefone);
  await busca;
  await page.locator('#portal-pdv-nome').fill(nome);
  await page.getByRole('button', { name: 'Abrir comanda' }).click();
  await expect(page.getByText(/Comanda (aberta · senha \d+|já está aberta)\./)).toBeVisible();
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
  await adicionarNoPortal(page, /Água QA/);
  await expect(page.getByRole('button', { name: 'Pedidos (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('button', { name: 'Pedidos (0)' })).toBeVisible();
  await adicionarNoPortal(page, /Lata QA/);
  await page.getByRole('button', { name: 'Aumentar Lata QA' }).click();
  await adicionarNoPortal(page, /Pilsen QA.*18,00/);
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

  const comanda = await prismaClient().comanda.findFirst({
    where: { pontoVendaId: tenant.pointId, identificador: 'Cliente Pedido QA' },
    select: { id: true },
  });
  expect(comanda).toBeTruthy();
  const pedidos = await prismaClient().pedidoOperacao.findMany({ where: { comandaId: comanda!.id }, select: { id: true } });
  const pedidoIds = pedidos.map((pedido: { id: string }) => pedido.id).sort();
  expect(pedidoIds.length).toBeGreaterThan(0);
  let auditRows: Array<{ entidadeId: string | null; metadata: unknown }> = [];
  await expect.poll(async () => {
    auditRows = await prismaClient().transacaoLog.findMany({
      where: {
        cervejariaId: tenant.id,
        tipo: 'PORTAL_PEDIDO_CRIADO',
        entidadeTipo: 'pedido_operacao',
        entidadeId: { in: pedidoIds },
      },
      select: { entidadeId: true, metadata: true },
    });
    return auditRows.length;
  }, { timeout: 10_000, intervals: [100, 250, 500, 1000] }).toBe(pedidoIds.length);
  expect(auditRows.map((row) => row.entidadeId).sort()).toEqual(pedidoIds);
  for (const row of auditRows) {
    expect(row.metadata).toMatchObject({
      origem: 'PORTAL_PDV',
      pontoVendaId: tenant.pointId,
      clienteId: expect.any(String),
      comandaId: comanda!.id,
    });
    expect(Object.keys(row.metadata as Record<string, unknown>).some((key) => /email|nome|telefone|senha|token|observacao/i.test(key))).toBe(false);
  }
});

test('POR-S03 o status do pedido muda no portal sem recarregar', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await abrirNoPortal(page, tenant, 'Cliente Status QA');
  await adicionarNoPortal(page, /Porção QA/);
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

test('POR-X02 cliente inativo não abre comanda nem envia pedidos pelo portal', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  const telefone = uniquePhone();
  const cliente = await tenant.owner.expect(tenant.owner.post('/api/clientes', {
    nome: 'Cliente Inativo Original QA', telefone, email: 'cliente-inativo@example.invalid', optInMarketing: true,
  }), 201, 'criar cliente ativo pela equipe');
  const visitante = await ops.anonymous('portal-cliente-inativo');
  const aberta = await visitante.expect(visitante.post(`${portalBase(tenant)}/comandas`, { nome: cliente.nome, telefone }), 201, 'controle positivo: cliente ativo abre comanda');
  const samePhone = `+55 (${telefone.slice(0, 2)}) ${telefone.slice(2)}`;
  const visitanteDuplicado = await ops.anonymous('portal-reenvio-concorrente');
  const resultadosReenvio = await Promise.all([
    visitante.post(`${portalBase(tenant)}/comandas`, { nome: cliente.nome, telefone: samePhone }),
    visitanteDuplicado.post(`${portalBase(tenant)}/comandas`, { nome: cliente.nome, telefone }),
  ]);
  expect(resultadosReenvio.map((item) => item.status).sort()).toEqual([200, 200]);
  expect(resultadosReenvio.map((item) => item.body.comanda.id)).toEqual([aberta.comanda.id, aberta.comanda.id]);

  const outroTenant = await portalAberto(ops);
  const mesmoTelefoneOutroTenant = await outroTenant.owner.expect(outroTenant.owner.post('/api/clientes', {
    nome: cliente.nome, telefone,
  }), 201, 'o mesmo telefone pode pertencer a outro tenant');
  expect(mesmoTelefoneOutroTenant.id).not.toBe(cliente.id);
  const portalOutroTenant = await ops.anonymous('portal-isolamento-tenant');
  const comandaOutroTenant = await portalOutroTenant.expect(portalOutroTenant.post(`${portalBase(outroTenant)}/comandas`, {
    nome: cliente.nome, telefone,
  }), 201, 'abertura isolada no outro tenant');
  await visitante.expect(visitante.post(`${portalBase(tenant)}/comanda/pedidos`, { itens: [tenant.item('lata', 2)] }), 201, 'pedido existente antes da desativação');
  const estoqueAoDesativar = await tenant.stock();

  await abrirNoPortal(page, tenant, cliente.nome, telefone);
  await adicionarNoPortal(page, /Água QA/);
  await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${cliente.id}`, { ativo: false }), 200, 'desativar pelo fluxo administrativo');
  await evidence.checkpoint();

  const leitura = await visitante.expect(visitante.get(`${portalBase(tenant)}/comanda`), 200, 'sessão anterior mantém consulta somente leitura');
  expect(leitura.id).toBe(aberta.comanda.id);
  expect(leitura.total).toBe(16);
  const pedidosAntesDoBloqueio = await prismaClient().pedidoOperacao.findMany({
    where: { comandaId: aberta.comanda.id },
    select: { id: true },
  });
  const pedidoIdsAntesDoBloqueio = pedidosAntesDoBloqueio.map((pedido: { id: string }) => pedido.id);
  const countAuditDoPortal = () => prismaClient().transacaoLog.count({
    where: {
      cervejariaId: tenant.id,
      tipo: 'PORTAL_PEDIDO_CRIADO',
      entidadeTipo: 'pedido_operacao',
      entidadeId: { in: pedidoIdsAntesDoBloqueio },
    },
  });
  await expect.poll(countAuditDoPortal, { timeout: 10_000, intervals: [100, 250, 500, 1000] }).toBe(pedidoIdsAntesDoBloqueio.length);
  const auditCountBeforeRejectedOrder = await countAuditDoPortal();
  const bloqueado = await visitante.post(`${portalBase(tenant)}/comanda/pedidos`, { itens: [tenant.item('agua', 1)] });
  expect(bloqueado.status).toBe(409);
  expect(bloqueado.body.error).toMatch(/Procure a equipe do ponto de venda/);
  expect(await countAuditDoPortal()).toBe(auditCountBeforeRejectedOrder);
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByRole('alert')).toContainText('Procure a equipe do ponto de venda');

  const tentativaDireta = await visitanteDuplicado.post(`${portalBase(tenant)}/comandas`, { nome: 'Nome enviado pelo portal QA', telefone: samePhone });
  expect(tentativaDireta.status).toBe(409);
  expect(tentativaDireta.headers['set-cookie']).toBeUndefined();
  const tentativaFormatoNormalizado = await (await ops.anonymous('portal-formato-normalizado')).post(`${portalBase(tenant)}/comandas`, {
    nome: 'Nome enviado pelo portal QA', telefone: `55${telefone}`,
  });
  expect(tentativaFormatoNormalizado.status).toBe(409);
  const clienteDoOutroTenant = await portalOutroTenant.expect(portalOutroTenant.post(`${portalBase(outroTenant)}/comandas`, {
    nome: cliente.nome, telefone: samePhone,
  }), 200, 'desativação não atravessa o tenant');
  expect(clienteDoOutroTenant.comanda.id).toBe(comandaOutroTenant.comanda.id);
  await expect(page.getByRole('button', { name: 'Pedidos (1)' })).toBeVisible();

  const estado = await prismaClient().cliente.findFirst({ where: { id: cliente.id }, select: { nome: true, email: true, ativo: true, optInMarketing: true } });
  expect(estado).toEqual({ nome: 'Cliente Inativo Original QA', email: 'cliente-inativo@example.invalid', ativo: false, optInMarketing: false });
  expect(await prismaClient().comanda.count({ where: { clienteId: cliente.id, pontoVendaId: tenant.pointId, status: 'ABERTA' } })).toBe(1);
  expect(await prismaClient().pedidoOperacao.count({ where: { comandaId: aberta.comanda.id } })).toBe(1);
  expect(await prismaClient().pagamento.count({ where: { comandaId: aberta.comanda.id } })).toBe(0);
  expect((await tenant.stock())(tenant.catalog!.lata.id)).toBe(estoqueAoDesativar(tenant.catalog!.lata.id));

  const atendente = await tenant.staff('cliente-sem-permissao-de-reativar', ['clients.manage']);
  expect((await atendente.patch(`/api/clientes/${cliente.id}`, { ativo: true })).status).toBe(403);
  await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${cliente.id}`, { ativo: true }), 200, 'reativar como proprietário');
  const reaberta = await visitanteDuplicado.expect(visitanteDuplicado.post(`${portalBase(tenant)}/comandas`, {
    nome: cliente.nome, telefone,
  }), 200, 'cliente reativado volta a reutilizar comanda');
  expect(reaberta.comanda.id).toBe(aberta.comanda.id);

  const novoTelefone = uniquePhone();
  const novo = await ops.anonymous('portal-cliente-novo');
  expect((await novo.post(`${portalBase(tenant)}/comandas`, { nome: 'Cliente Novo QA', telefone: novoTelefone })).status).toBe(201);
  const mesmoNome = await tenant.owner.expect(tenant.owner.post('/api/clientes', {
    nome: 'Cliente Inativo Original QA', telefone: uniquePhone(),
  }), 201, 'clientes homônimos com telefones distintos são permitidos');
  expect(mesmoNome.id).not.toBe(cliente.id);

  const clienteHistorico = await tenant.owner.expect(tenant.owner.post('/api/clientes', {
    nome: 'Cliente com Histórico QA', telefone: uniquePhone(),
  }), 201, 'criar cliente para preservar histórico pago');
  const portalHistorico = await ops.anonymous('portal-historico-pago');
  const comandaHistorica = await portalHistorico.expect(portalHistorico.post(`${portalBase(tenant)}/comandas`, {
    nome: clienteHistorico.nome, telefone: clienteHistorico.telefone,
  }), 201, 'abrir comanda de histórico');
  await portalHistorico.expect(portalHistorico.post(`${portalBase(tenant)}/comanda/pedidos`, { itens: [tenant.item('lata', 1)] }), 201, 'pedido pago antes da desativação');
  await tenant.owner.expect(tenant.pay(tenant.owner, comandaHistorica.comanda.id, [{ forma: 'PIX', valor: 8 }]), 200, 'pagar comanda histórica');
  await tenant.owner.expect(tenant.owner.patch(`/api/clientes/${clienteHistorico.id}`, { ativo: false }), 200, 'desativar cliente com histórico');
  const historico = await tenant.owner.expect(tenant.owner.get(`/api/clientes/${clienteHistorico.id}/historico`), 200, 'histórico administrativo após desativação');
  expect(historico.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: comandaHistorica.comanda.id, pagamentos: [expect.objectContaining({ forma: 'PIX', valor: 8 })] })]));

  const clienteCorrida = await tenant.owner.expect(tenant.owner.post('/api/clientes', {
    nome: 'Cliente Corrida QA', telefone: uniquePhone(),
  }), 201, 'criar cliente para concorrência');
  const portalCorrida = await ops.anonymous('portal-corrida-desativacao');
  const [aberturaCorrida, desativacaoCorrida] = await Promise.all([
    portalCorrida.post(`${portalBase(tenant)}/comandas`, { nome: clienteCorrida.nome, telefone: clienteCorrida.telefone }),
    tenant.owner.patch(`/api/clientes/${clienteCorrida.id}`, { ativo: false }),
  ]);
  expect(desativacaoCorrida.status).toBe(200);
  expect([200, 201, 409]).toContain(aberturaCorrida.status);
  expect((await prismaClient().cliente.findUnique({ where: { id: clienteCorrida.id }, select: { ativo: true } }))?.ativo).toBe(false);
  expect(await prismaClient().comanda.count({ where: { clienteId: clienteCorrida.id, pontoVendaId: tenant.pointId, status: 'ABERTA' } })).toBeLessThanOrEqual(1);
  if (aberturaCorrida.status !== 409) {
    expect((await portalCorrida.post(`${portalBase(tenant)}/comanda/pedidos`, { itens: [tenant.item('agua', 1)] })).status).toBe(409);
  }

  await evidence.checkpoint();
  await evidence.assertNoDbChange();
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

test('POR-X04 link de trailer descontinuado não abre portal de evento', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await evidence.checkpoint();
  await page.goto(`/c/${tenant.slug}/t/trailer-inexistente`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/Portal de evento descontinuado|Link inválido/).first()).toBeVisible();
  await expect(page.locator('#portal-pdv-telefone')).toHaveCount(0);
  await expect(page.locator('#portal-telefone')).toHaveCount(0);
  await evidence.screenshot('trailer');
  await evidence.assertNoDbChange();
});

test('POR-X05 link de cadastro mostra a página de link descontinuado', async ({ ops, page, evidence }) => {
  const tenant = await portalAberto(ops);
  await evidence.checkpoint();
  await page.goto(`/c/${tenant.slug}/cadastro`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/Este link de cadastro não abre comanda\./)).toBeVisible();
  await expect(page.getByText(/QR do caixa|ponto de venda/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Acesso da equipe' })).toBeVisible();
  await evidence.screenshot('cadastro');
  await evidence.assertNoDbChange();
});
