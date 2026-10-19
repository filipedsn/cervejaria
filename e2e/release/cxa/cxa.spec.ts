import { prismaClient } from '../support/fixtures';
import { expect, loginPage, PERSONA_PERMISSIONS, randomUUID, test, todayIso } from '../support/ops';

const fechar = (pontoVendaId: string, values: Partial<Record<string, number>> = {}) => ({
  pontoVendaId, contadoDinheiro: 0, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0, ...values,
});

test('CXA-S01 abre o caixa com troco e cardápio salvo @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  const aberto = await tenant.openCash(caixa, 150);
  expect(aberto).toMatchObject({ status: 'ABERTO', trocoInicial: 150, pontoVendaId: tenant.pointId });
  const estado = await tenant.cashState(caixa);
  expect(estado.sessao).toMatchObject({ id: aberto.id, status: 'ABERTO', gaveta: { trocoInicial: 150, esperadoDinheiro: 150 } });
  const cardapio = await caixa.expect(caixa.get(`/api/operacao/caixa/cardapio?pontoVendaId=${tenant.pointId}`), 200, 'cardápio do turno');
  const ids = JSON.stringify(cardapio);
  for (const produtoId of [tenant.catalog!.chope.id, tenant.catalog!.porcao.id, tenant.catalog!.lata.id, tenant.catalog!.agua.id]) expect(ids).toContain(produtoId);
  expect(ids).not.toContain(tenant.catalog!.inativo.id);
});

test('CXA-S02 registra sangria e suprimento na gaveta @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner, 100);
  await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/movimentos', { pontoVendaId: tenant.pointId, tipo: 'SUPRIMENTO', valor: 50, observacao: 'Reforço QA' }), 201, 'suprimento');
  const resumo = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/movimentos', { pontoVendaId: tenant.pointId, tipo: 'SANGRIA', valor: 30, observacao: 'Retirada QA' }), 201, 'sangria');
  expect(resumo.gaveta).toMatchObject({ trocoInicial: 100, suprimentos: 50, sangrias: 30, esperadoDinheiro: 120 });
  expect(resumo.movimentos.map((m: { tipo: string; valor: number }) => `${m.tipo}:${m.valor}`).sort()).toEqual(['SANGRIA:30', 'SUPRIMENTO:50']);
});

test('CXA-S03 corrige movimento com credencial do dono (estorno + substituição) @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const caixa = await tenant.staff('Caixa', PERSONA_PERMISSIONS.caixa);
  await tenant.openCash(caixa, 100);
  const comSangria = await caixa.expect(caixa.post('/api/operacao/caixa/movimentos', { pontoVendaId: tenant.pointId, tipo: 'SANGRIA', valor: 30 }), 201, 'sangria');
  const original = comSangria.movimentos[0];
  const corrigido = await caixa.expect(caixa.post(`/api/operacao/caixa/movimentos/${original.id}/corrigir`, {
    pontoVendaId: tenant.pointId, valorCorrigido: 20, motivo: 'Valor digitado errado', autorizadorEmail: tenant.ownerEmail, autorizadorSenha: tenant.ownerPassword,
  }), 201, 'corrigir');
  const naturezas = corrigido.movimentos.filter((m: { correcaoDeId: string | null }) => m.correcaoDeId === original.id).map((m: { naturezaCorrecao: string }) => m.naturezaCorrecao).sort();
  expect(naturezas).toEqual(['ESTORNO', 'SUBSTITUICAO']);
  expect(corrigido.gaveta.esperadoDinheiro).toBe(80);
});

test('CXA-S04 fecha o caixa com contagem que confere @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner, 100);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('lata', 2)]);
  await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'DINHEIRO', valor: 16 }]), 200, 'pagar');
  const fechado = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/fechar', fechar(tenant.pointId, { contadoDinheiro: 116 })), 200, 'fechar');
  expect(fechado.status).toBe('FECHADO');
  expect(fechado.diferencas).toEqual({ dinheiro: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0 });
  expect((await tenant.cashState()).sessao).toBeNull();
});

test('CXA-S05 fecha o caixa registrando divergência @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner, 100);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('agua', 2)]);
  await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 10 }]), 200, 'pagar');
  const fechado = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/fechar', fechar(tenant.pointId, { contadoDinheiro: 95, contadoPix: 10 })), 200, 'fechar com falta');
  expect(fechado.diferencas).toEqual({ dinheiro: -5, pix: 0, cartaoDebito: 0, cartaoCredito: 0 });
  expect(fechado.contado).toMatchObject({ dinheiro: 95, pix: 10 });
});

test('CXA-S06 vendas do turno ficam no dia operacional da abertura @api', async ({ ops }, testInfo) => {
  const tenant = await ops.tenant();
  const aberto = await tenant.openCash(tenant.owner, 0);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('agua')]);
  const row = await prismaClient().comanda.findUniqueOrThrow({ where: { id: comanda.id }, select: { diaOperacional: true, sessaoCaixaRealizacaoId: true } });
  expect(row.sessaoCaixaRealizacaoId).toBe(aberto.id);
  expect(new Date(row.diaOperacional).toISOString().slice(0, 10)).toBe(new Date(aberto.diaOperacional).toISOString().slice(0, 10));
  testInfo.annotations.push({ type: 'limitation', description: 'O relógio do servidor não é controlável no E2E; a virada de meia-noite é provada pela vinculação da comanda à sessão e ao dia operacional da abertura.' });
});

test('CXA-S07 encerramento administrativo é idempotente @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const aberto = await tenant.openCash(tenant.owner, 50);
  const url = `/api/operacao/caixa/sessoes/${aberto.id}/encerramento-administrativo`;
  const primeiro = await tenant.owner.expect(tenant.owner.post(url, { motivo: 'Encerramento administrativo QA' }), 200, 'encerrar');
  expect(primeiro.idempotente).toBe(false);
  const segundo = await tenant.owner.expect(tenant.owner.post(url, { motivo: 'Encerramento administrativo QA' }), 200, 'repetir');
  expect(segundo.idempotente).toBe(true);
  expect((await tenant.cashState()).sessao).toBeNull();
});

test('CXA-S08 resumo do turno fechado confere item a item @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  const aberto = await tenant.openCash(tenant.owner, 100);
  const a = await tenant.openComanda(tenant.owner, [tenant.chopeItem(500), tenant.item('lata')]);
  await tenant.owner.expect(tenant.pay(tenant.owner, a.id, [{ forma: 'PIX', valor: 26 }]), 200, 'pagar A');
  const b = await tenant.openComanda(tenant.owner, [tenant.item('agua', 2)]);
  await tenant.owner.expect(tenant.pay(tenant.owner, b.id, [{ forma: 'DINHEIRO', valor: 10, valorRecebido: 20 }]), 200, 'pagar B');
  await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/movimentos', { pontoVendaId: tenant.pointId, tipo: 'SANGRIA', valor: 5 }), 201, 'sangria');
  await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/fechar', fechar(tenant.pointId, { contadoDinheiro: 105, contadoPix: 26 })), 200, 'fechar');
  const relatorio = await tenant.owner.expect(tenant.owner.get(`/api/operacao/caixa/sessoes/${aberto.id}`), 200, 'resumo');
  expect(relatorio).toMatchObject({ comandasAtendidas: 2, vendasTotal: 36, totalRecebido: 36, itensVendidos: 4, ticketMedio: 18, totalPendente: 0 });
  expect(relatorio.caixa.esperado).toMatchObject({ dinheiro: 10, pix: 26, cartaoDebito: 0, cartaoCredito: 0, totalVendas: 36 });
  expect(relatorio.caixa.gaveta).toMatchObject({ trocoInicial: 100, entradasDinheiro: 10, sangrias: 5, esperadoDinheiro: 105 });
  const produtos = Object.fromEntries(relatorio.porProduto.map((p: { produtoId: string; volumeMl: number; quantidade: number; receita: number }) => [`${p.produtoId}:${p.volumeMl}`, [p.quantidade, p.receita]]));
  expect(produtos).toEqual({
    [`${tenant.catalog!.chope.id}:500`]: [1, 18],
    [`${tenant.catalog!.lata.id}:0`]: [1, 8],
    [`${tenant.catalog!.agua.id}:0`]: [2, 10],
  });
});

test('CXA-S09 abre o caixa associado a uma ocorrência da agenda @api', async ({ ops }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const agendado = await tenant.owner.expect(tenant.owner.post('/api/operacao/agenda/agendamentos', {
    requestId: randomUUID(), nome: 'Feira QA', data: todayIso(), horaInicio: '08:00', horaFim: '23:00', repetirSemanalmente: false,
  }), 200, 'agendar');
  expect(agendado.ocorrenciaId).toBeTruthy();
  const aberto = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', { pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: tenant.catalog!.cardapioId, ocorrenciaId: agendado.ocorrenciaId }), 201, 'abrir com ocorrência');
  expect(aberto.ocorrenciaId).toBe(agendado.ocorrenciaId);
  const estado = await tenant.cashState();
  expect(estado.sessao.ocorrencia).toMatchObject({ id: agendado.ocorrenciaId, nome: 'Feira QA' });
});

test('CXA-X01 abrir sem cardápio é recusado @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', { pontoVendaId: tenant.pointId, trocoInicial: 0 }), 400, 'abrir sem cardápio');
  expect(body.error).toBe('Escolha um cardápio salvo ou monte o cardápio antes de abrir o caixa');
  await evidence.assertNoDbChange();
  await tenant.openCash();
});

test('CXA-X02 troco inicial negativo é recusado em português @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', { pontoVendaId: tenant.pointId, trocoInicial: -1, cardapioId: tenant.catalog!.cardapioId }), 400, 'troco negativo');
  expect(body.error).toBe('O troco inicial não pode ser negativo');
  await evidence.assertNoDbChange();
  await tenant.openCash(tenant.owner, 0);
});

test('CXA-X03 segundo caixa aberto no mesmo ponto é recusado @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', { pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: tenant.catalog!.cardapioId }), 400, 'segundo caixa');
  expect(body.error).toBe('O caixa deste ponto já está aberto');
  await evidence.assertNoDbChange();
});

test('CXA-X04 tap sem mapeamento de PDV bloqueia a abertura @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const legacyTap = await prismaClient().tap.create({ data: { cervejariaId: tenant.id, numero: 99, produtoId: tenant.catalog!.chope.id, pontoVendaId: null } });
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/abrir', { pontoVendaId: tenant.pointId, trocoInicial: 0, cardapioId: tenant.catalog!.cardapioId }), 400, 'tap sem PDV');
  expect(body.error).toBe('Existem Taps sem mapeamento confirmado para um PDV');
  await evidence.assertNoDbChange();
  await prismaClient().tap.update({ where: { id: legacyTap.id }, data: { pontoVendaId: tenant.pointId } });
  await tenant.openCash();
});

test('CXA-X05 fechar com comanda aberta informa a quantidade @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner, 0);
  const comanda = await tenant.openComanda(tenant.owner, [tenant.item('agua')]);
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/fechar', fechar(tenant.pointId)), 400, 'fechar com comanda');
  expect(body.error).toBe('Não é possível fechar o caixa: há 1 comanda aberta. Feche ou cancele todas antes de encerrar o turno.');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.pay(tenant.owner, comanda.id, [{ forma: 'PIX', valor: 5 }]), 200, 'pagar');
  await tenant.closeCash();
});

test('CXA-X06 venda sem caixa aberto é recusada @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post('/api/operacao/comandas', { pontoVendaId: tenant.pointId, tipo: 'APELIDO', identificador: 'Sem caixa', itens: [tenant.item('agua')] }), 400, 'venda sem caixa');
  expect(body.error).toBe('Abra o caixa antes de registrar vendas');
  await evidence.assertNoDbChange();
  await tenant.openCash();
  await tenant.openComanda(tenant.owner, [tenant.item('agua')]);
});

test('CXA-X07 correção com credencial do dono inválida é recusada @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner, 100);
  const resumo = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/movimentos', { pontoVendaId: tenant.pointId, tipo: 'SANGRIA', valor: 30 }), 201, 'sangria');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post(`/api/operacao/caixa/movimentos/${resumo.movimentos[0].id}/corrigir`, {
    pontoVendaId: tenant.pointId, valorCorrigido: 20, motivo: 'Valor digitado errado', autorizadorEmail: tenant.ownerEmail, autorizadorSenha: 'senha-errada',
  }), 400, 'credencial inválida');
  expect(body.error).toBe('Credencial do proprietário inválida');
  await evidence.assertNoDbChange();
});

test('CXA-X08 o mesmo movimento não pode ser corrigido duas vezes @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  await tenant.openCash(tenant.owner, 100);
  const resumo = await tenant.owner.expect(tenant.owner.post('/api/operacao/caixa/movimentos', { pontoVendaId: tenant.pointId, tipo: 'SANGRIA', valor: 30 }), 201, 'sangria');
  const payload = { pontoVendaId: tenant.pointId, valorCorrigido: 20, motivo: 'Valor digitado errado', autorizadorEmail: tenant.ownerEmail, autorizadorSenha: tenant.ownerPassword };
  const url = `/api/operacao/caixa/movimentos/${resumo.movimentos[0].id}/corrigir`;
  await tenant.owner.expect(tenant.owner.post(url, payload), 201, 'primeira correção');
  await evidence.checkpoint();
  const body = await tenant.owner.expect(tenant.owner.post(url, payload), 400, 'segunda correção');
  expect(body.error).toBe('Movimento não elegível para correção ou já corrigido');
  await evidence.assertNoDbChange();
});

test('CXA-X09 encerramento administrativo exige motivo com 8 caracteres @api', async ({ ops, evidence }) => {
  const tenant = await ops.tenant();
  const aberto = await tenant.openCash();
  await evidence.checkpoint();
  const url = `/api/operacao/caixa/sessoes/${aberto.id}/encerramento-administrativo`;
  const body = await tenant.owner.expect(tenant.owner.post(url, { motivo: 'curto' }), 400, 'motivo curto');
  expect(body.error).toBe('Informe um motivo com pelo menos 8 caracteres');
  await evidence.assertNoDbChange();
  await tenant.owner.expect(tenant.owner.post(url, { motivo: 'Motivo suficiente QA' }), 200, 'controle positivo');
});

test('CXA-X10 sem cash.values.read os valores ficam mascarados na API e na tela', async ({ ops, evidence, page }) => {
  const tenant = await ops.tenant();
  await tenant.seedCatalog();
  const operador = await tenant.staff('Abertura', ['cash.open', 'command.read']);
  const aberto = await operador.expect(operador.post('/api/operacao/caixa/abrir', { pontoVendaId: tenant.pointId, trocoInicial: 137, cardapioId: tenant.catalog!.cardapioId }), 201, 'abrir sem ver valores');
  expect(aberto).toMatchObject({ valoresRestritos: true });
  expect(aberto).not.toHaveProperty('trocoInicial');
  await evidence.checkpoint();
  const mascarado = await operador.expect(operador.get(`/api/operacao/caixa?pontoVendaId=${tenant.pointId}`), 200, 'estado mascarado');
  expect(mascarado.valoresRestritos).toBe(true);
  expect(JSON.stringify(mascarado)).not.toContain('137');
  await loginPage(page, operador.email, operador.senha);
  await page.goto('/operacao/caixa', { waitUntil: 'networkidle' });
  await expect(page.getByText(/137,00/)).toHaveCount(0);
  await evidence.screenshot('caixa-mascarado');
  await evidence.assertNoDbChange();
  const completo = await tenant.cashState(tenant.owner);
  expect(completo.sessao.gaveta.trocoInicial).toBe(137);
});
