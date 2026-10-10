import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { buildApp } from '../src/app.ts';
import { signUserToken } from '../src/lib/session.ts';

validateIsolatedQaEnvironment(process.env);
assert.equal(process.env.NODE_ENV, 'test');

const prisma = new PrismaClient();
const app = await buildApp();
await app.ready();
const fixedCanonicalTenant = 'cmr9yis3c0000hvu00q9fe7y1';
const fixedCanonicalTenantB = 'cmsry9xrn0000hvlgopjxy0oo';

async function fixture(suffix, canonical = false) {
  const id = canonical ? (suffix === 'rbac' ? fixedCanonicalTenantB : fixedCanonicalTenant) : `qa_cash_${randomUUID().replaceAll('-', '')}`;
  const tenant = await prisma.cervejaria.create({ data: { id, nome: `QA ${suffix}`, slug: `${id}-slug` } });
  const point = await prisma.pontoVenda.create({ data: { id: `${id}_point`, cervejariaId: id, nome: 'QA POS', ativo: true, usaCaixa: true } });
  await prisma.configuracaoOperacao.create({ data: { cervejariaId: id, ativo: true, exclusivo: true, controlaEstoque: false, temCozinha: false, quantidadeMesas: 1 } });
  await prisma.configuracaoOperacional.create({ data: { cervejariaId: id, directSalesEnabled: true, plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false } });
  if (canonical) await prisma.configuracaoPontoVenda.create({ data: {
    cervejariaId: id, pontoVendaId: point.id, tapsEnabled: false, inventoryEnabled: false,
    kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false,
    whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, quantidadeMesas: 1,
  } });
  const owner = await prisma.usuario.create({ data: { id: `${id}_owner`, nome: 'QA owner', email: `${id}@owner.test`, senhaHash: 'qa-only', cervejariaId: id, papel: 'DONO' } });
  const restricted = await prisma.usuario.create({ data: { id: `${id}_restricted`, nome: 'QA restricted', email: `${id}@restricted.test`, senhaHash: 'qa-only', cervejariaId: id, papel: 'ATENDENTE', permissoesOperacao: [] } });
  const product = await prisma.produto.create({ data: { id: `${id}_product`, nome: 'QA item', tipo: 'COMIDA', cervejariaId: id, pontoVendaId: point.id, ativo: true } });
  await prisma.preco.create({ data: { produtoId: product.id, volumeMl: 0, preco: 15 } });
  return { tenant, point, owner, restricted, product, canonical };
}

function headers(fixtureValue, user = fixtureValue.owner) {
  return { authorization: `Bearer ${signUserToken(app, user)}` };
}
function request(f, method, url, payload, user = f.owner) {
  return app.inject({ method, url: `/api${url}`, headers: headers(f, user), ...(payload === undefined ? {} : { payload }) });
}
const openBody = (f, point = f.point) => ({ pontoVendaId: point.id, trocoInicial: 40, produtoIds: [f.product.id] });

test('API preserves an overnight open session, turn date, command and payment links in LEGACY and CANONICAL_PDV', async (t) => {
  const legacy = await fixture('legacy');
  const canonical = await fixture('canonical', true);
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T23:55:00-03:00') });
  t.after(() => mock.timers.reset());

  for (const f of [legacy, canonical]) {
    mock.timers.setTime(Date.parse('2026-10-09T23:55:00-03:00'));
    const opened = await request(f, 'POST', '/operacao/caixa/abrir', openBody(f));
    assert.equal(opened.statusCode, 201, opened.body);
    const openedData = opened.json();
    assert.equal(openedData.diaOperacional.slice(0, 10), '2026-10-09');

    const before = await request(f, 'POST', '/operacao/comandas', {
      pontoVendaId: f.point.id, tipo: 'APELIDO', identificador: 'overnight-before', itens: [],
    });
    assert.equal(before.statusCode, 201, before.body);
    const beforeCommandId = before.json().id;
    const addBeforeItems = await request(f, 'POST', `/operacao/comandas/${beforeCommandId}/pedidos`, {
      itens: [{ produtoId: f.product.id, quantidade: 1 }],
    });
    assert.equal(addBeforeItems.statusCode, 201, addBeforeItems.body);
    const payBefore = await request(f, 'POST', `/operacao/comandas/${beforeCommandId}/pagamentos`, {
      pagamentos: [{ forma: 'DINHEIRO', valor: 15 }],
    });
    assert.equal(payBefore.statusCode, 200, payBefore.body);
    const beforeStored = await prisma.comanda.findUniqueOrThrow({ where: { id: beforeCommandId } });
    assert.equal(beforeStored.status, 'FECHADA');
    assert.equal(beforeStored.sessaoCaixaRealizacaoId, openedData.id);
    assert.equal(new Date(beforeStored.fechadaEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), '2026-10-09');
    mock.timers.tick(10 * 60 * 1000);

    const current = await request(f, 'GET', `/operacao/caixa?pontoVendaId=${f.point.id}`);
    assert.equal(current.statusCode, 200, current.body);
    assert.equal(current.json().sessao.id, openedData.id);
    assert.equal(current.json().sessao.diaOperacional.slice(0, 10), '2026-10-09');

    const after = await request(f, 'POST', '/operacao/comandas', {
      pontoVendaId: f.point.id, tipo: 'APELIDO', identificador: 'overnight-after', itens: [],
    });
    assert.equal(after.statusCode, 201, after.body);
    const afterCommandId = after.json().id;
    const afterCommand = await prisma.comanda.findUniqueOrThrow({ where: { id: afterCommandId } });
    assert.equal(afterCommand.diaOperacional.toISOString().slice(0, 10), '2026-10-09');
    assert.equal(afterCommand.sessaoCaixaRealizacaoId, openedData.id);
    const addAfterItems = await request(f, 'POST', `/operacao/comandas/${afterCommandId}/pedidos`, {
      itens: [{ produtoId: f.product.id, quantidade: 1 }],
    });
    assert.equal(addAfterItems.statusCode, 201, addAfterItems.body);
    const payAfter = await request(f, 'POST', `/operacao/comandas/${afterCommandId}/pagamentos`, {
      pagamentos: [{ forma: 'PIX', valor: 15 }],
    });
    assert.equal(payAfter.statusCode, 200, payAfter.body);
    const linkedPayments = await prisma.pagamento.findMany({ where: { comandaId: { in: [beforeCommandId, afterCommandId] } } });
    assert.equal(linkedPayments.length, 2);
    assert.ok(linkedPayments.every((payment) => payment.sessaoCaixaId === openedData.id));
    const afterStored = await prisma.comanda.findUniqueOrThrow({ where: { id: afterCommandId } });
    assert.equal(afterStored.status, 'FECHADA');
    assert.equal(new Date(afterStored.fechadaEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), '2026-10-10');

    const closedBySession = await request(f, 'GET', `/operacao/comandas?status=FECHADA&pontoVendaId=${f.point.id}&sessaoCaixaId=${openedData.id}`);
    assert.equal(closedBySession.statusCode, 200, closedBySession.body);
    assert.ok(closedBySession.json().some((command) => command.id === beforeCommandId));
    assert.ok(closedBySession.json().some((command) => command.id === afterCommandId));
    assert.equal(beforeStored.diaOperacional.toISOString().slice(0, 10), '2026-10-09');
    assert.equal(afterStored.diaOperacional.toISOString().slice(0, 10), '2026-10-09');
    const historicalDay = await request(f, 'GET', `/operacao/comandas?status=FECHADA&dia=2026-10-09&pontoVendaId=${f.point.id}`);
    assert.equal(historicalDay.statusCode, 200, historicalDay.body);
    assert.ok(historicalDay.json().some((command) => command.id === beforeCommandId));
    assert.ok(historicalDay.json().some((command) => command.id === afterCommandId));

    const noPoint = await request(f, 'GET', `/operacao/comandas?status=FECHADA&sessaoCaixaId=${openedData.id}`);
    assert.equal(noPoint.statusCode, 400, noPoint.body);
    const wrongPoint = await request(f, 'GET', `/operacao/comandas?status=FECHADA&pontoVendaId=${f.point.id}_other&sessaoCaixaId=${openedData.id}`);
    assert.equal(wrongPoint.statusCode, 404, wrongPoint.body);
    const sale = await request(f, 'POST', '/operacao/vendas', {
      pontoVendaId: f.point.id, itens: [{ produtoId: f.product.id, quantidade: 1 }],
      pagamentos: [{ forma: 'PIX', valor: 15 }],
    });
    assert.equal(sale.statusCode, 201, sale.body);
    const saleCommandId = sale.json().id;
    const saleCommand = await prisma.comanda.findUniqueOrThrow({ where: { id: saleCommandId } });
    assert.equal(saleCommand.diaOperacional.toISOString().slice(0, 10), '2026-10-09');
    assert.equal(saleCommand.sessaoCaixaRealizacaoId, openedData.id);
    const salePayment = await prisma.pagamento.findFirstOrThrow({ where: { comandaId: saleCommandId } });
    assert.equal(salePayment.sessaoCaixaId, openedData.id);

    const movement = await request(f, 'POST', '/operacao/caixa/movimentos', {
      pontoVendaId: f.point.id, tipo: 'SUPRIMENTO', valor: 5,
    });
    assert.equal(movement.statusCode, 201, movement.body);
    assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessaoId: openedData.id, tipo: 'SUPRIMENTO' } }), 1);
    const cashSummary = await request(f, 'GET', `/operacao/caixa?pontoVendaId=${f.point.id}`);
    assert.equal(cashSummary.statusCode, 200, cashSummary.body);
    assert.equal(cashSummary.json().sessao.gaveta.esperadoDinheiro, 60);
    assert.equal(cashSummary.json().sessao.esperado.pix, 30);
    assert.equal(cashSummary.json().sessao.esperado.totalVendas, 45);
    const closedAfterSale = await request(f, 'GET', `/operacao/comandas?status=FECHADA&pontoVendaId=${f.point.id}&sessaoCaixaId=${openedData.id}`);
    assert.equal(closedAfterSale.statusCode, 200, closedAfterSale.body);
    assert.equal(closedAfterSale.json().find((command) => command.id === saleCommandId)?.tipo, 'AVULSA');

    const duplicate = await request(f, 'POST', '/operacao/caixa/abrir', openBody(f));
    assert.equal(duplicate.statusCode, 400, duplicate.body);
    assert.equal(await prisma.sessaoCaixaOperacao.count({ where: { cervejariaId: f.tenant.id, pontoVendaId: f.point.id, status: 'ABERTO' } }), 1);

    const close = await request(f, 'POST', '/operacao/caixa/fechar', {
      pontoVendaId: f.point.id, contadoDinheiro: 60, contadoPix: 30, contadoCartaoDebito: 0, contadoCartaoCredito: 0,
    });
    assert.equal(close.statusCode, 200, close.body);
    const noSessionMovement = await request(f, 'POST', '/operacao/caixa/movimentos', {
      pontoVendaId: f.point.id, tipo: 'SANGRIA', valor: 1,
    });
    assert.equal(noSessionMovement.statusCode, 400, noSessionMovement.body);
    assert.equal(await prisma.movimentoCaixaOperacao.count({ where: { sessaoId: openedData.id, tipo: 'SANGRIA' } }), 0);

    const concurrent = await Promise.all([101, 102].map((trocoInicial) => request(f, 'POST', '/operacao/caixa/abrir', { ...openBody(f), trocoInicial })));
    assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [201, 400]);
    const activeAfterRace = await prisma.sessaoCaixaOperacao.findMany({ where: { cervejariaId: f.tenant.id, pontoVendaId: f.point.id, status: 'ABERTO' } });
    assert.equal(activeAfterRace.length, 1);
    assert.equal(activeAfterRace[0].diaOperacional.toISOString().slice(0, 10), '2026-10-10');
    const oldMenu = await prisma.sessaoCaixaProdutoOperacao.count({ where: { sessaoCaixaId: openedData.id } });
    assert.equal(oldMenu, 1);
    const newTurnCommand = await request(f, 'POST', '/operacao/comandas', {
      pontoVendaId: f.point.id, tipo: 'APELIDO', identificador: 'new-session', itens: [],
    });
    assert.equal(newTurnCommand.statusCode, 201, newTurnCommand.body);
    const newTurnStored = await prisma.comanda.findUniqueOrThrow({ where: { id: newTurnCommand.json().id } });
    assert.equal(newTurnStored.sessaoCaixaRealizacaoId, activeAfterRace[0].id);
    const newTurnOpenList = await request(f, 'GET', `/operacao/comandas?status=ABERTA&pontoVendaId=${f.point.id}&sessaoCaixaId=${activeAfterRace[0].id}`);
    assert.equal(newTurnOpenList.statusCode, 200, newTurnOpenList.body);
    assert.deepEqual(newTurnOpenList.json().map((command) => command.id), [newTurnCommand.json().id]);
    const newTurnClosedList = await request(f, 'GET', `/operacao/comandas?status=FECHADA&pontoVendaId=${f.point.id}&sessaoCaixaId=${activeAfterRace[0].id}`);
    assert.equal(newTurnClosedList.statusCode, 200, newTurnClosedList.body);
    assert.ok(!newTurnClosedList.json().some((command) => [beforeCommandId, afterCommandId].includes(command.id)));
  }
});

test('active-session ambiguity returns an actionable conflict without choosing or changing rows', async () => {
  const f = await fixture('duplicate');
  const day = new Date('2026-10-09T00:00:00.000Z');
  const sessions = await Promise.all(['a', 'b'].map((suffix) => prisma.sessaoCaixaOperacao.create({ data: {
    id: `${f.tenant.id}_session_${suffix}`, cervejariaId: f.tenant.id, pontoVendaId: f.point.id,
    diaOperacional: day, status: 'ABERTO', trocoInicial: 0, abertoPorId: f.owner.id,
  } })));
  const before = await prisma.sessaoCaixaOperacao.findMany({ where: { id: { in: sessions.map((s) => s.id) } }, orderBy: { id: 'asc' } });
  const response = await request(f, 'GET', `/operacao/caixa?pontoVendaId=${f.point.id}`);
  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.json().error, /mais de uma sessao de caixa aberta/i);
  const after = await prisma.sessaoCaixaOperacao.findMany({ where: { id: { in: sessions.map((s) => s.id) } }, orderBy: { id: 'asc' } });
  assert.deepEqual(after.map((s) => [s.id, s.status, s.diaOperacional]), before.map((s) => [s.id, s.status, s.diaOperacional]));
});

test('opening and cash operations retain tenant, point and permission boundaries', async () => {
  const f = await fixture('rbac', true);
  const deniedOpen = await request(f, 'POST', '/operacao/caixa/abrir', openBody(f), f.restricted);
  assert.equal(deniedOpen.statusCode, 403);
  await request(f, 'POST', '/operacao/caixa/abrir', openBody(f));
  const deniedClose = await request(f, 'POST', '/operacao/caixa/fechar', {
    pontoVendaId: f.point.id, contadoDinheiro: 40, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0,
  }, f.restricted);
  assert.equal(deniedClose.statusCode, 403);
  const deniedMovement = await request(f, 'POST', '/operacao/caixa/movimentos', { pontoVendaId: f.point.id, tipo: 'SANGRIA', valor: 1 }, f.restricted);
  assert.equal(deniedMovement.statusCode, 403);
  const activeSession = await prisma.sessaoCaixaOperacao.findFirstOrThrow({ where: { cervejariaId: f.tenant.id, pontoVendaId: f.point.id, status: 'ABERTO' } });
  const deniedCommandRead = await request(f, 'GET', `/operacao/comandas?status=ABERTA&pontoVendaId=${f.point.id}&sessaoCaixaId=${activeSession.id}`, undefined, f.restricted);
  assert.equal(deniedCommandRead.statusCode, 403, deniedCommandRead.body);
  const crossPdv = await fixture('cross-pdv');
  await request(crossPdv, 'POST', '/operacao/caixa/abrir', openBody(crossPdv));
  const crossPdvSession = await prisma.sessaoCaixaOperacao.findFirstOrThrow({ where: { cervejariaId: crossPdv.tenant.id, pontoVendaId: crossPdv.point.id, status: 'ABERTO' } });
  const otherPointSameTenant = await prisma.pontoVenda.create({ data: { cervejariaId: crossPdv.tenant.id, nome: 'Second QA point', ativo: true, usaCaixa: true } });
  const crossPdvSessionList = await request(crossPdv, 'GET', `/operacao/comandas?status=FECHADA&pontoVendaId=${otherPointSameTenant.id}&sessaoCaixaId=${crossPdvSession.id}`);
  assert.equal(crossPdvSessionList.statusCode, 404, crossPdvSessionList.body);
  const separateLegacy = await fixture('separate-point');
  const otherPoint = await prisma.pontoVenda.create({ data: { cervejariaId: separateLegacy.tenant.id, nome: 'Other point', ativo: true, usaCaixa: true } });
  const otherPointRead = await request(separateLegacy, 'GET', `/operacao/caixa?pontoVendaId=${otherPoint.id}`);
  assert.equal(otherPointRead.statusCode, 200);
  assert.equal(otherPointRead.json().sessao, null);
  const otherTenant = await fixture('other-tenant');
  const crossTenant = await request(otherTenant, 'GET', `/operacao/caixa?pontoVendaId=${f.point.id}`);
  assert.equal(crossTenant.statusCode, 404);
  const crossTenantSessionList = await request(otherTenant, 'GET', `/operacao/comandas?status=FECHADA&pontoVendaId=${otherTenant.point.id}&sessaoCaixaId=${crossPdvSession.id}`);
  assert.equal(crossTenantSessionList.statusCode, 404, crossTenantSessionList.body);
});

test.after(async () => {
  await app.close();
  await prisma.$disconnect();
});
