import { expect, loginPage, PERSONA_PERMISSIONS, test, uniquePhone, type Ops } from '../support/ops';

/**
 * Known month: comanda A (owner) chope 500 + porção = 48 in PIX; comanda B (Caixa) 2 latas = 16 in cash;
 * walk-in sale (owner) água = 5 on debit; comanda C (Caixa) 1 lata = 8 left pending. Shift closed.
 */
async function massaConhecida(ops: Ops) {
  const tenant = await ops.tenant();
  const sessao = await tenant.openCash(tenant.owner, 0);
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  const a = await tenant.openComanda(tenant.owner, [tenant.chopeItem(500), tenant.porcaoItem(1)], { identificador: 'Mesa A' });
  const pedido = a.pedidos.find((p: { itens: Array<{ produtoId: string }> }) => p.itens.some((i) => i.produtoId === tenant.catalog!.porcao.id));
  await tenant.advanceKitchen(tenant.owner, pedido.id, ['EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  await tenant.owner.expect(tenant.pay(tenant.owner, a.id, [{ forma: 'PIX', valor: 48 }]), 200, 'pagar A');
  const b = await tenant.openComanda(caixa, [tenant.item('lata', 2)], { identificador: 'Mesa B' });
  await caixa.expect(tenant.pay(caixa, b.id, [{ forma: 'DINHEIRO', valor: 16, valorRecebido: 20 }]), 200, 'pagar B');
  await tenant.owner.expect(tenant.owner.post('/api/operacao/vendas', { pontoVendaId: tenant.pointId, itens: [tenant.item('agua')], pagamentos: [{ forma: 'CARTAO_DEBITO', valor: 5 }] }), 201, 'venda avulsa');
  const c = await tenant.openComanda(caixa, [tenant.item('lata', 1)], { identificador: 'Mesa C', clienteNome: 'Cliente Pendente QA', clienteTelefone: uniquePhone() });
  await caixa.expect(tenant.pay(caixa, c.id, [], true), 200, 'deixar C pendente');
  await tenant.closeCash();
  return { tenant, caixa, sessaoId: sessao.id as string };
}

const brl = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('DSH-S01 dashboard operacional mostra KPIs exatos da massa conhecida', async ({ ops, page, evidence }) => {
  const { tenant, caixa } = await massaConhecida(ops);
  const dash = await tenant.owner.expect(tenant.owner.get('/api/operacao/dashboard'), 200, 'dashboard');
  test.info().annotations.push({ type: 'observed', description: JSON.stringify(dash.resumo) });
  expect(dash.resumo).toMatchObject({
    receitaTotal: 77, totalRecebido: 69, pendentePeriodo: 8, totalPendente: 8,
    comandasAtendidas: 3, vendasAvulsas: 1, receitaAvulsa: 5, itensVendidos: 6, turnosCaixa: 1,
  });
  const porForma = Object.fromEntries(dash.porPagamento.map((p: { forma: string; valor: number }) => [p.forma, p.valor]));
  expect(porForma).toMatchObject({ PIX: 48, DINHEIRO: 16, CARTAO_DEBITO: 5 });
  const porProduto = Object.fromEntries(dash.porProduto.map((p: { nome: string; quantidade: number; receita: number }) => [p.nome, [p.quantidade, p.receita]]));
  expect(porProduto).toMatchObject({ 'Porção QA': [1, 30], 'Lata QA': [3, 24], 'Água QA': [1, 5] });
  const porFuncionario = Object.fromEntries(dash.porFuncionario.map((f: { usuarioId: string; receita: number }) => [f.usuarioId, f.receita]));
  expect(porFuncionario[caixa.userId]).toBe(24);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/dashboard', { waitUntil: 'networkidle' });
  const kpi = (label: string) => page.getByText(label, { exact: true }).first().locator('xpath=..');
  await expect(kpi('Vendas no período')).toContainText(brl(77));
  await expect(kpi('Recebido no período')).toContainText(brl(69));
  await expect(kpi('Pendente do período')).toContainText(brl(8));
  await expect(kpi('Comandas atendidas')).toContainText('3');
  await expect(kpi('Itens vendidos')).toContainText('6');
  await evidence.screenshot('dashboard');
});

test('DSH-S02 filtros de mês e de ponto de venda', async ({ ops, page, evidence }) => {
  const { tenant } = await massaConhecida(ops);
  const agora = new Date();
  const anterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const mesAnterior = await tenant.owner.expect(tenant.owner.get(`/api/operacao/dashboard?ano=${anterior.getFullYear()}&mes=${anterior.getMonth() + 1}`), 200, 'mês anterior');
  expect(mesAnterior.resumo).toMatchObject({ receitaTotal: 0, comandasAtendidas: 0 });
  const doPonto = await tenant.owner.expect(tenant.owner.get(`/api/operacao/dashboard?pontoVendaId=${tenant.pointId}`), 200, 'filtro por ponto');
  expect(doPonto.resumo.receitaTotal).toBe(77);
  expect(doPonto.comparativoPontos).toEqual([]);
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/dashboard', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(page).toHaveURL(new RegExp(`ano=${anterior.getFullYear()}&mes=${anterior.getMonth() + 1}`));
  await expect(page.getByText(/Nenhuma venda fechada em/)).toBeVisible();
  await page.getByRole('button', { name: 'Mês atual' }).click();
  await expect(page.getByText('Vendas no período', { exact: true }).first().locator('xpath=..')).toContainText(brl(77));
  test.info().annotations.push({ type: 'observed', description: 'Com um único ponto de venda o filtro "Ponto" não é exibido; a API aceita pontoVendaId e devolve os mesmos números.' });
  await evidence.screenshot('filtros');
});

test('DSH-S03 dashboard leva ao resumo do turno com os mesmos números', async ({ ops, page, evidence }) => {
  const { tenant, sessaoId } = await massaConhecida(ops);
  const resumo = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa/sessoes/${sessaoId}`), 200, 'resumo do turno');
  // O resumo do turno conta a venda avulsa como comanda; o dashboard separa em vendasAvulsas.
  expect(resumo).toMatchObject({ comandasAtendidas: 4, totalRecebido: 69, vendasAvulsas: 1 });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/operacao/dashboard', { waitUntil: 'networkidle' });
  await page.locator(`a[href^="/operacao/turnos/${sessaoId}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/operacao/turnos/${sessaoId}`));
  await expect(page.getByText(brl(69)).first()).toBeVisible();
  await evidence.screenshot('turno');
});

test('DSH-S04 dashboard legado no modelo canônico', async ({ ops, page, evidence }) => {
  const { tenant } = await massaConhecida(ops);
  const operacional = await tenant.owner.expect(tenant.owner.get('/api/operacao/dashboard'), 200, 'dashboard operacional');
  const legado = await tenant.owner.get('/api/cervejaria/dashboard');
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  const destino = new URL(page.url()).pathname;
  await evidence.screenshot('dashboard-legado');
  test.info().annotations.push({ type: 'product-decision', description: `/dashboard abriu ${destino}; GET /api/cervejaria/dashboard respondeu ${legado.status} (receitaTotal ${legado.body?.resumo?.receitaTotal}). Recomendação: redirecionar /dashboard para /operacao/dashboard.` });
  if (destino === '/dashboard' && legado.status === 200) expect(legado.body.resumo.receitaTotal).toBe(operacional.resumo.receitaTotal);
});

test('DSH-S05 ranking e TV de ranking no modelo canônico', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto('/ranking', { waitUntil: 'networkidle' });
  const destino = new URL(page.url()).pathname;
  await evidence.screenshot('ranking');
  const api = await tenant.owner.get('/api/ranking/evento/inexistente');
  expect(api.status).toBe(404);
  test.info().annotations.push({ type: 'product-gap', description: `Ranking depende de evento ou série: /ranking redirecionou para ${destino} e a API exige eventoId (404 sem evento). Não há ranking alcançável no PDV canônico.` });
  expect(destino).not.toBe('/ranking');
});

test('DSH-X01 sem dashboard.read a API recusa e a tela redireciona', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  await evidence.checkpoint();
  const negado = await caixa.expect(caixa.get('/api/operacao/dashboard'), 403, 'sem dashboard.read');
  expect(negado.error).toBe('Você não tem permissão para esta ação');
  await loginPage(page, caixa.email, caixa.senha);
  await page.goto('/operacao/dashboard', { waitUntil: 'networkidle' });
  await expect(page).not.toHaveURL(/\/operacao\/dashboard/);
  await evidence.screenshot('redirecionado');
  await evidence.assertNoDbChange();
  const gerente = await tenant.staff('Gerente', [...PERSONA_PERMISSIONS.caixa, 'dashboard.read']);
  await gerente.expect(gerente.get('/api/operacao/dashboard'), 200, 'controle positivo');
});

test('DSH-X02 mês futuro é recusado pela API @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const futuro = new Date();
  futuro.setMonth(futuro.getMonth() + 1, 1);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.get(`/api/operacao/dashboard?ano=${futuro.getFullYear()}&mes=${futuro.getMonth() + 1}`), 400, 'mês futuro');
  expect(body.error).toBe('Período futuro indisponível');
  const invalido = await tenant.owner.expect(tenant.owner.get('/api/operacao/dashboard?ano=2026&mes=13'), 400, 'mês inválido');
  expect(invalido.error).toBe('Período inválido');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.get('/api/operacao/dashboard'), 200, 'controle positivo');
});

test('DSH-X03 resumo executivo e CSV dependem de evento no modelo canônico @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await evidence.checkpoint();
  const resumo = await tenant.owner.expect(tenant.owner.get('/api/eventos/inexistente/resumo-executivo'), 404, 'resumo executivo');
  expect(resumo.error).toBe('Evento não encontrado');
  const csv = await tenant.owner.expect(tenant.owner.get('/api/relatorios/evento/inexistente/csv'), 404, 'CSV');
  expect(csv.error).toBe('Evento não encontrado');
  await evidence.assertNoDbChange();
  test.info().annotations.push({ type: 'product-gap', description: 'Resumo executivo e exportação CSV só existem por evento; o PDV canônico não tem eventos, então não há exportação de relatório alcançável.' });
});
