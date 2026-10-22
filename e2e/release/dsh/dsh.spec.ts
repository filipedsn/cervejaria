import { expect, loginPage, PERSONA_PERMISSIONS, test, todayIso, uniquePhone, type Ops } from '../support/ops';
import { prismaClient } from '../support/fixtures';

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

test('DSH-S05 ranking acessível por PDV e ocorrência, com regras e isolamento empresarial', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const other = await ops.tenant();
  const catalog = await tenant.seedCatalog();
  const occurrence = await tenant.owner.expect(tenant.owner.post('/api/operacao/agenda/ocorrencias', {
    nome: 'Ocorrência Ranking QA', data: todayIso(), horaInicio: '18:00', horaFim: '23:00',
  }), 201, 'criar ocorrência sintética');
  const secondShift = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', {
    pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: catalog.cardapioId, ocorrenciaId: occurrence.id,
  }), 201, 'abrir caixa vinculado à ocorrência');
  const comanda = await tenant.openComanda(tenant.owner, [tenant.chopeItem(500, 2)], {
    clienteNome: 'Cliente Ranking QA', clienteTelefone: uniquePhone(),
  });
  const prisma = prismaClient();
  const commandDb = await prisma.comanda.findFirst({ where: { id: comanda.id, pontoVendaId: tenant.pointId }, select: { origem: true, tipo: true, status: true, ocorrenciaId: true, clienteId: true, cliente: { select: { nome: true } }, itens: { select: { volumeMl: true, quantidade: true, precoUnit: true, canceladoEm: true, cancelamentoPendenteEm: true, produto: { select: { tipo: true, formato: true } } } } } });
  expect(commandDb?.ocorrenciaId).toBe(occurrence.id);
  expect(commandDb?.clienteId).toBeTruthy();
  expect(commandDb).toMatchObject({ origem: 'CAIXA', tipo: 'APELIDO', cliente: { nome: 'Cliente Ranking QA' }, itens: [expect.objectContaining({ volumeMl: 500, quantidade: 2, produto: { tipo: 'BEBIDA', formato: 'CHOPE' } })] });
  const linked = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa?pontoVendaId=${tenant.pointId}`), 200, 'caixa com ocorrência');
  expect(linked.sessao.ocorrenciaId).toBe(occurrence.id);
  const byDay = await tenant.owner.expect(tenant.owner.get(`/api/ranking/pdv/${tenant.pointId}?dia=${todayIso()}&ocorrenciaId=${occurrence.id}`), 200, 'ranking por ocorrência');
  test.info().annotations.push({ type: 'observed', description: `comanda=${JSON.stringify(commandDb)}; ranking=${JSON.stringify(byDay.ranking)}` });
  expect(byDay.ranking).toEqual(expect.arrayContaining([expect.objectContaining({ nome: 'Cliente Ranking QA', totalMl: 1000, pedidos: 2 })]));
  const monthly = await tenant.owner.expect(tenant.owner.get(`/api/ranking/pdv/${tenant.pointId}/periodo?mes=${todayIso().slice(0, 7)}`), 200, 'ranking mensal do PDV');
  expect(monthly.entries).toEqual(expect.arrayContaining([expect.objectContaining({ nome: 'Cliente Ranking QA', totalMl: 1000 })]));
  const general = await tenant.owner.expect(tenant.owner.get(`/api/ranking/pdv/${tenant.pointId}/periodo`), 200, 'ranking geral do PDV');
  expect(general.entries).toEqual(expect.arrayContaining([expect.objectContaining({ nome: 'Cliente Ranking QA', totalMl: 1000 })]));
  await other.seedCatalog();
  await other.openCash();
  const otherComanda = await other.openComanda(other.owner, [other.chopeItem(300)], { clienteNome: 'Cliente Outro Tenant QA', clienteTelefone: uniquePhone() });
  const isolated = await tenant.owner.expect(tenant.owner.get(`/api/ranking/pdv/${tenant.pointId}?dia=${todayIso()}`), 200, 'ranking isolado');
  expect(isolated.ranking.map((entry: { nome: string }) => entry.nome)).not.toContain('Cliente Outro Tenant QA');
  const crossTenant = await tenant.owner.get(`/api/ranking/pdv/${other.pointId}?dia=${todayIso()}`);
  expect(crossTenant.status).toBe(404);
  const unauthorized = await tenant.staff('Ranking', []).then((user) => user.get(`/api/ranking/pdv/${tenant.pointId}?dia=${todayIso()}`));
  expect(unauthorized.status).toBe(403);

  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/comandas?pontoVendaId=${tenant.pointId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: /Ranking de chope/ })).toBeVisible();
  await page.getByRole('link', { name: /Ranking de chope/ }).click();
  await expect(page).toHaveURL(new RegExp(`/operacao/ranking\\?pontoVendaId=${tenant.pointId}.*ocorrenciaId=${occurrence.id}`));
  await expect(page.getByRole('heading', { name: 'Ranking de chope' })).toBeVisible();
  await expect(page.getByText('Cliente Ranking QA')).toBeVisible();
  await page.getByRole('button', { name: 'Mensal' }).click();
  await expect(page.getByText('Cliente Ranking QA')).toBeVisible();
  await page.getByRole('button', { name: 'Geral' }).click();
  await expect(page.getByText('Cliente Ranking QA')).toBeVisible();
  await evidence.screenshot('ranking');
  const db = await prisma.comanda.findFirst({ where: { id: comanda.id, pontoVendaId: tenant.pointId }, select: { ocorrenciaId: true, sessaoCaixaRealizacaoId: true, origem: true } });
  expect(db).toMatchObject({ ocorrenciaId: occurrence.id, origem: 'CAIXA' });
  expect(db?.sessaoCaixaRealizacaoId).toBeTruthy();
  test.info().annotations.push({ type: 'observed', description: `Ranking sintético do PDV ${tenant.pointId}; sessão vinculada ${secondShift.id}; produto chope ${catalog.chope.id}; comanda isolada ${comanda.id}; controle de outro tenant ${otherComanda.id}.` });
});

test('DSH-S06 ocorrência ao abrir caixa e montagem de chope compacta com permissões', async ({ ops, page, evidence }) => {
  const tenant = await ops.tenant();
  const catalog = await tenant.seedCatalog();
  const occurrence = await tenant.owner.expect(tenant.owner.post('/api/operacao/agenda/ocorrencias', {
    nome: 'Ocorrência Agenda QA', data: todayIso(), horaInicio: '18:00', horaFim: '23:00',
  }), 201, 'criar ocorrência sintética');
  await evidence.checkpoint();
  let agendaAttempts = 0;
  await page.route('**/api/operacao/agenda/ocorrencias?*', async (route) => {
    agendaAttempts += 1;
    if (agendaAttempts <= 4) return route.abort();
    await route.continue();
  });
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/comandas?pontoVendaId=${tenant.pointId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os agendamentos');
  await page.getByRole('button', { name: 'Tentar novamente' }).last().click();
  const selector = page.getByLabel('Ocorrência do caixa (opcional)');
  await expect(selector).toBeVisible();
  await expect(selector.locator('option', { hasText: 'Ocorrência Agenda QA' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cardápio salvo' }).click();
  await page.getByRole('radio').first().click();
  await selector.selectOption(occurrence.id);
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('Ocorrência Agenda QA');
  const session = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa?pontoVendaId=${tenant.pointId}`), 200, 'sessão vinculada');
  expect(session.sessao.ocorrenciaId).toBe(occurrence.id);

  const authorized = await tenant.staff('Montador', ['command.read', 'taps.operate']);
  const denied = await tenant.staff('Leitor', ['command.read']);
  const taps = await authorized.expect(authorized.get(`/api/operacao/caixa/taps?pontoVendaId=${tenant.pointId}`), 200, 'taps efetivos do turno');
  expect(taps.taps).toHaveLength(1);
  expect(taps.taps[0].chopeAtual).toBeTruthy();
  const deniedMount = await denied.put(`/api/operacao/caixa/taps/${catalog.tapId}/chope`, { pontoVendaId: tenant.pointId, produtoId: catalog.chope.id });
  expect(deniedMount.status).toBe(403);
  const mount = await authorized.expect(authorized.put(`/api/operacao/caixa/taps/${catalog.tapId}/chope`, { pontoVendaId: tenant.pointId, produtoId: catalog.chope.id }), 200, 'montar chope');
  expect(mount.taps[0].chopeAtual.id).toBe(catalog.chope.id);
  await evidence.checkpoint();

  await loginPage(page, authorized.email, authorized.senha);
  await page.goto(`/operacao/comandas?pontoVendaId=${tenant.pointId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Montar chope nas Taps' })).toBeVisible();
  await page.getByRole('button', { name: 'Montar chope nas Taps' }).click();
  await expect(page.getByRole('heading', { name: 'Taps do turno' })).toBeVisible();
  await expect(page.getByText('Tap 1')).toBeVisible();
  await evidence.screenshot('montagem-compacta');

  await tenant.owner.expect(tenant.owner.put(`/api/operacao/produtos/${catalog.chope.id}`, { ativo: false }), 200, 'desativar chope sintético');
  await loginPage(page, tenant.ownerEmail, tenant.ownerPassword);
  await page.goto(`/operacao/comandas?pontoVendaId=${tenant.pointId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Montar chope nas Taps' }).click();
  await expect(page.getByText('Nenhum chope está disponível para montar neste PDV.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir Catálogo' })).toHaveAttribute('href', '/operacao/catalogo');

  const prisma = prismaClient();
  const stored = await prisma.sessaoCaixaOperacao.findFirst({ where: { cervejariaId: tenant.id, pontoVendaId: tenant.pointId, id: session.sessao.id }, select: { ocorrenciaId: true } });
  expect(stored?.ocorrenciaId).toBe(occurrence.id);
  test.info().annotations.push({ type: 'observed', description: `Caixa QA ${session.sessao.id} vinculou ocorrência ${occurrence.id}; montagem foi autorizada por taps.operate e negada sem a permissão.` });
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
