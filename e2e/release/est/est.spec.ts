import { expect, loginPage, PERSONA_PERMISSIONS, randomUUID, test, type Ops } from '../support/ops';

async function estoquePronto(ops: Ops, enablements?: Parameters<Ops['tenant']>[0]) {
  const tenant = await ops.tenant(enablements);
  await tenant.openCash(tenant.owner, 0);
  return tenant;
}

test('EST-S01 entrada, saída e ajuste atualizam o saldo @api', async ({ ops }) => {
  const tenant = await estoquePronto(ops);
  const estoquista = await tenant.staff('Estoque', PERSONA_PERMISSIONS.estoque);
  const lata = tenant.catalog!.lata.id;
  const base = { pontoVendaId: tenant.pointId, produtoId: lata };
  await estoquista.expect(estoquista.post('/api/operacao/estoque/entrada', { ...base, quantidade: 5, observacao: 'Compra QA' }), 201, 'entrada');
  expect((await tenant.stock(estoquista))(lata)).toBe(15);
  await estoquista.expect(estoquista.post('/api/operacao/estoque/saida', { ...base, tipo: 'PERDA', quantidade: 2 }), 201, 'saida');
  expect((await tenant.stock(estoquista))(lata)).toBe(13);
  await estoquista.expect(estoquista.post('/api/operacao/estoque/ajuste', { ...base, quantidadeNova: 20, observacao: 'Contagem' }), 201, 'ajuste');
  expect((await tenant.stock(estoquista))(lata)).toBe(20);
});

test('EST-S02 venda baixa unidades e litros do chope por volume @api', async ({ ops }) => {
  const tenant = await estoquePronto(ops);
  await tenant.openComanda(tenant.owner, [tenant.chopeItem(500, 1), tenant.chopeItem(300, 2), tenant.item('lata', 3)]);
  const saldo = await tenant.stock();
  expect(saldo(tenant.catalog!.chope.id)).toBeCloseTo(50 - 0.5 - 0.6, 6);
  expect(saldo(tenant.catalog!.lata.id)).toBe(7);
});

test('EST-S03 cancelamento de item devolve ao estoque @api', async ({ ops }) => {
  const tenant = await estoquePronto(ops);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.chopeItem(700, 1), tenant.item('agua')]);
  expect((await tenant.stock())(tenant.catalog!.chope.id)).toBeCloseTo(49.3, 6);
  const chope = comanda.pedidos.flatMap((p: { itens: Array<{ id: string; produtoId: string }> }) => p.itens).find((i: { produtoId: string }) => i.produtoId === tenant.catalog!.chope.id);
  await tenant.owner.expect(tenant.owner.delete(`/api/operacao/comandas/${comanda.id}/itens/${chope.id}`, { motivo: 'Lançado por engano', quantidade: 1, quantidadeEsperada: 1, tratamentoEstoque: 'ERRO_LANCAMENTO', idempotencyKey: randomUUID() }), 200, 'cancelar chope');
  expect((await tenant.stock())(tenant.catalog!.chope.id)).toBeCloseTo(50, 6);
});

test('EST-S04 tela de estoque alerta estoque baixo e esgotado', async ({ ops, page, evidence }) => {
  const tenant = await estoquePronto(ops);
  const o = tenant.owner;
  await o.expect(o.put('/api/operacao/estoque/minimo', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.lata.id, estoqueMinimo: 3 }), 200, 'mínimo');
  await tenant.openComanda(o, [tenant.item('lata', 8)]);
  await o.expect(o.post('/api/operacao/estoque/ajuste', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.porcao.id, quantidadeNova: 0 }), 201, 'zerar porção');
  const linhas = await o.expect(o.get(`/api/operacao/estoque?pontoVendaId=${tenant.pointId}`), 200, 'saldos');
  expect(linhas.find((l: { produtoId: string }) => l.produtoId === tenant.catalog!.lata.id)).toMatchObject({ quantidade: 2, estoqueMinimo: 3, statusEstoque: 'LOW' });
  expect(linhas.find((l: { produtoId: string }) => l.produtoId === tenant.catalog!.porcao.id)).toMatchObject({ quantidade: 0, statusEstoque: 'OUT_OF_STOCK' });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/estoque', { waitUntil: 'networkidle' });
  await expect(page.getByText(/^Estoque baixo · restam 2 \S+$/).first()).toBeVisible();
  await expect(page.getByText('Esgotado', { exact: true }).first()).toBeVisible();
  await evidence.screenshot('alertas');
});

test('EST-S05 dono define o estoque mínimo @api', async ({ ops }) => {
  const tenant = await estoquePronto(ops);
  const o = tenant.owner;
  await o.expect(o.put('/api/operacao/estoque/minimo', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.porcao.id, estoqueMinimo: 5 }), 200, 'definir mínimo');
  const linhas = await o.expect(o.get(`/api/operacao/estoque?pontoVendaId=${tenant.pointId}`), 200, 'saldos');
  expect(linhas.find((l: { produtoId: string }) => l.produtoId === tenant.catalog!.porcao.id)).toMatchObject({ estoqueMinimo: 5, statusEstoque: 'NORMAL' });
  await o.expect(o.put('/api/operacao/estoque/minimo', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.porcao.id, estoqueMinimo: null }), 200, 'remover mínimo');
  const depois = await o.expect(o.get(`/api/operacao/estoque?pontoVendaId=${tenant.pointId}`), 200, 'saldos');
  expect(depois.find((l: { produtoId: string }) => l.produtoId === tenant.catalog!.porcao.id).estoqueMinimo).toBeNull();
});

test('EST-X01 saldo insuficiente bloqueia a venda @api', async ({ ops, evidence }) => {
  const tenant = await estoquePronto(ops);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/comandas', { pontoVendaId: tenant.pointId, tipo: 'APELIDO', identificador: 'Sem saldo', itens: [tenant.item('lata', 11)] }), 400, 'vender além do saldo');
  expect(body.error).toBe('Estoque insuficiente de Lata QA');
  await evidence.assertNoDbChange();
  await tenant.openComanda(tenant.owner, [tenant.item('lata', 10)]);
});

test('EST-X02 litros com mais de três casas decimais são recusados @api', async ({ ops, evidence }) => {
  const tenant = await estoquePronto(ops);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.chope.id, quantidade: 1.2345 }), 400, 'quatro casas');
  expect(body.error).toBe('Informe litros com no máximo três casas decimais');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.chope.id, quantidade: 1.234 }), 201, 'controle positivo');
});

test('EST-X03 produto por unidade não aceita quantidade fracionada @api', async ({ ops, evidence }) => {
  const tenant = await estoquePronto(ops);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.lata.id, quantidade: 1.5 }), 400, 'fracionado');
  expect(body.error).toBe('Produtos vendidos por unidade exigem quantidade inteira');
  await evidence.assertNoDbChange();
});

test('EST-X04 quantidade zero ou negativa é recusada @api', async ({ ops, evidence }) => {
  const tenant = await estoquePronto(ops);
  const base = { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.lata.id };
  await evidence.checkpoint();
  for (const quantidade of [0, -1]) {
    const entrada = await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/entrada', { ...base, quantidade }), 400, `entrada ${quantidade}`);
    expect(entrada.error).toBe('O valor deve ser maior que zero');
    const saida = await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/saida', { ...base, tipo: 'PERDA', quantidade }), 400, `saida ${quantidade}`);
    expect(saida.error).toBe('O valor deve ser maior que zero');
  }
  const ajuste = await tenant.owner.expect(tenant.owner.post('/api/operacao/estoque/ajuste', { ...base, quantidadeNova: -1 }), 400, 'ajuste negativo');
  expect(ajuste.error).toBe('O valor não pode ser negativo');
  await evidence.assertNoDbChange();
});

test('EST-X05 atendente não define estoque mínimo @api', async ({ ops, evidence }) => {
  const tenant = await estoquePronto(ops);
  const estoquista = await tenant.staff('Estoque', PERSONA_PERMISSIONS.estoque);
  const body = { pontoVendaId: tenant.pointId, produtoId: tenant.catalog!.lata.id, estoqueMinimo: 4 };
  await evidence.checkpoint();
  const negado = await estoquista.expect(estoquista.put('/api/operacao/estoque/minimo', body), 403, 'atendente define mínimo');
  expect(negado.error).toBe('Acesso restrito ao proprietário');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.put('/api/operacao/estoque/minimo', body), 200, 'controle positivo');
});

test('EST-X06 com o estoque desligado a API devolve 404 e a rota some', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant({ inventory: false }, {});
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.get(`/api/operacao/estoque?pontoVendaId=${tenant.pointId}`), 404, 'estoque desligado');
  expect(body.error).toBe('Operação sem controle de estoque');
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/estoque', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveURL(/\/operacao\/estoque/);
  await expect(page.getByRole('link', { name: /^Estoque$/ })).toHaveCount(0);
  await evidence.screenshot('sem-estoque');
  await evidence.assertNoDbChange();
});
