import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

validateIsolatedQaEnvironment(process.env);
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PDV_INDIVIDUAL_PERMISSIONS_ENABLED, '1');

const { PrismaClient } = await import('@prisma/client');
const { buildApp } = await import('../src/app.ts');
const { buildOperacaoDashboard } = await import('../src/lib/operacao/dashboard.ts');
const { buscarRelatorioTurnoFechado } = await import('../src/lib/operacao/caixa.ts');
const { aggregateChopeRanking } = await import('../src/lib/chope-ranking.ts');
const { buildRelatorioEventoCsv } = await import('../src/lib/relatorio-evento-csv.ts');

const prisma = new PrismaClient();
const app = await buildApp();
const runId = process.env.PDV_QA_RUN_ID;
const day = new Date('2026-10-21T00:00:00.000Z');
const closedAt = new Date('2026-10-21T18:30:00.000Z');

function auth(ownerId, tenantId, passwordChangedAt) {
  const token = app.jwt.sign({
    sub: ownerId,
    email: `${ownerId}@example.test`,
    nome: 'QA',
    papel: 'DONO',
    cervejariaId: tenantId,
    pwdAt: passwordChangedAt.getTime(),
  });
  return { authorization: `Bearer ${token}` };
}

async function seedTenant(suffix) {
  const tenantId = `qa_${runId}_${suffix}`;
  const ownerId = `${tenantId}_owner`;
  const pointId = `${tenantId}_point`;
  const sessionId = `${tenantId}_session`;
  const frangoId = `${tenantId}_frango`;
  const medalhaoId = `${tenantId}_medalhao`;
  const chopeId = `${tenantId}_chope`;

  await prisma.cervejaria.create({ data: { id: tenantId, nome: `QA ${suffix}`, slug: `${tenantId}-slug` } });
  const owner = await prisma.usuario.create({
    data: {
      id: ownerId,
      nome: 'QA owner',
      email: `${tenantId}-owner@example.test`,
      senhaHash: 'qa-not-used',
      papel: 'DONO',
      cervejariaId: tenantId,
    },
  });
  await prisma.configuracaoOperacional.create({
    data: { cervejariaId: tenantId, inventoryEnabled: true, kitchenEnabled: true, plannedOperationsEnabled: false },
  });
  await prisma.configuracaoOperacao.create({
    data: { cervejariaId: tenantId, ativo: true, controlaEstoque: true, temCozinha: true },
  });
  await prisma.pontoVenda.create({ data: { id: pointId, cervejariaId: tenantId, nome: 'QA POS' } });
  await prisma.produto.createMany({
    data: [
      { id: frangoId, nome: 'Frango', tipo: 'COMIDA', exigePreparo: true, controlaEstoque: true, cervejariaId: tenantId, pontoVendaId: pointId, categoria: 'Pratos' },
      { id: medalhaoId, nome: 'Medalhão de frango', tipo: 'COMIDA', exigePreparo: true, controlaEstoque: true, cervejariaId: tenantId, pontoVendaId: pointId, categoria: 'Pratos' },
      { id: chopeId, nome: 'Chope QA', tipo: 'BEBIDA', formato: 'CHOPE', exigePreparo: false, controlaEstoque: true, cervejariaId: tenantId, pontoVendaId: pointId, categoria: 'Chope' },
    ],
  });
  await prisma.inventoryBalance.createMany({
    data: [
      { cervejariaId: tenantId, pontoVendaId: pointId, produtoId: frangoId, quantidade: 20 },
      { cervejariaId: tenantId, pontoVendaId: pointId, produtoId: medalhaoId, quantidade: 20 },
      { cervejariaId: tenantId, pontoVendaId: pointId, produtoId: chopeId, quantidade: 100 },
    ],
  });
  await prisma.sessaoCaixaOperacao.create({
    data: {
      id: sessionId,
      cervejariaId: tenantId,
      pontoVendaId: pointId,
      diaOperacional: day,
      status: 'ABERTO',
      abertoEm: new Date('2026-10-21T12:00:00.000Z'),
      abertoPorId: ownerId,
      trocoInicial: 0,
    },
  });

  return {
    tenantId,
    ownerId,
    pointId,
    sessionId,
    frangoId,
    medalhaoId,
    chopeId,
    ownerPasswordChangedAt: owner.passwordChangedAt,
    headers: auth(ownerId, tenantId, owner.passwordChangedAt),
  };
}

async function createDeliveredOpenCommand(f, { productId, nome, quantity, unitPrice, stockDebit = true }) {
  const command = await prisma.comanda.create({
    data: {
      origem: 'CAIXA',
      pontoVendaId: f.pointId,
      sessaoCaixaRealizacaoId: f.sessionId,
      diaOperacional: day,
      tipo: 'MESA',
      identificador: `M-${randomBytes(3).toString('hex')}`,
      status: 'ABERTA',
      abertaPorId: f.ownerId,
      total: (quantity * unitPrice).toFixed(2),
    },
  });
  const order = await prisma.pedidoOperacao.create({
    data: {
      cervejariaId: f.tenantId,
      comandaId: command.id,
      pontoVendaId: f.pointId,
      numero: 900000 + Math.floor(Math.random() * 10000),
      diaOperacional: day,
      criadoPorId: f.ownerId,
      status: 'ENTREGUE',
      entregueEm: new Date('2026-10-21T15:00:00.000Z'),
    },
  });
  const item = await prisma.itemComanda.create({
    data: {
      comandaId: command.id,
      produtoId: productId,
      pedidoCozinhaId: order.id,
      nome,
      quantidade: quantity,
      precoUnit: unitPrice.toFixed(2),
      exigePreparo: true,
    },
  });
  if (stockDebit) {
    await prisma.inventoryBalance.update({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: productId } },
      data: { quantidade: { decrement: quantity } },
    });
    await prisma.inventoryMovement.create({
      data: {
        cervejariaId: f.tenantId,
        pontoVendaId: f.pointId,
        produtoId: productId,
        tipo: 'SAIDA_VENDA',
        quantidade: quantity,
        registradoPorId: f.ownerId,
        pedidoId: order.id,
      },
    });
  }
  return { command, order, item };
}

async function cancelDelivered(f, fixture, body) {
  return app.inject({
    method: 'DELETE',
    url: `/api/operacao/comandas/${fixture.command.id}/itens/${fixture.item.id}`,
    headers: f.headers,
    payload: body,
  });
}

async function closeCommandAndSession(f, commandIds, totalRecebido) {
  for (const commandId of commandIds) {
    const command = await prisma.comanda.findUniqueOrThrow({ where: { id: commandId } });
    const total = Number(command.total);
    if (total > 0) {
      const pay = await app.inject({
        method: 'POST',
        url: `/api/operacao/comandas/${commandId}/pagamentos`,
        headers: f.headers,
        payload: { pagamentos: [{ forma: 'DINHEIRO', valor: total }], deixarPendente: false },
      });
      assert.equal(pay.statusCode, 200, pay.body);
      assert.equal(pay.json().status, 'FECHADA');
    } else {
      await prisma.comanda.update({
        where: { id: commandId },
        data: { status: 'FECHADA' },
      });
    }
    await prisma.comanda.update({
      where: { id: commandId },
      data: { fechadaEm: closedAt, fechadoPorId: f.ownerId, sessaoCaixaRealizacaoId: f.sessionId },
    });
  }

  const close = await app.inject({
    method: 'POST',
    url: '/api/operacao/caixa/fechar',
    headers: f.headers,
    payload: {
      pontoVendaId: f.pointId,
      contadoDinheiro: totalRecebido,
      contadoPix: 0,
      contadoCartaoDebito: 0,
      contadoCartaoCredito: 0,
    },
  });
  assert.equal(close.statusCode, 200, close.body);
  return close.json();
}

test('indicadores de vendidos usam venda líquida após cancelamento total, parcial, estorno e perda', async () => {
  const f = await seedTenant('net-sold');

  const frango = await createDeliveredOpenCommand(f, {
    productId: f.frangoId,
    nome: 'Frango',
    quantity: 3,
    unitPrice: 20,
  });
  const medalhao = await createDeliveredOpenCommand(f, {
    productId: f.medalhaoId,
    nome: 'Medalhão de frango',
    quantity: 2,
    unitPrice: 25,
  });
  const ativo = await createDeliveredOpenCommand(f, {
    productId: f.frangoId,
    nome: 'Frango',
    quantity: 1,
    unitPrice: 20,
  });

  const balanceBeforeErro = Number(
    (await prisma.inventoryBalance.findUniqueOrThrow({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
    })).quantidade,
  );
  const erroKey = randomUUID();
  const cancelErro = await cancelDelivered(f, frango, {
    quantidade: 3,
    quantidadeEsperada: 3,
    motivo: 'Erro de lançamento no PDV',
    tratamentoEstoque: 'ERRO_LANCAMENTO',
    idempotencyKey: erroKey,
  });
  assert.equal(cancelErro.statusCode, 200, cancelErro.body);
  assert.equal(Number(cancelErro.json().total), 0);
  const balanceAfterErro = Number(
    (await prisma.inventoryBalance.findUniqueOrThrow({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
    })).quantidade,
  );
  assert.equal(balanceAfterErro, balanceBeforeErro + 3, 'ERRO_LANCAMENTO devolve ao estoque a baixa correspondente');

  const retryErro = await cancelDelivered(f, frango, {
    quantidade: 3,
    quantidadeEsperada: 3,
    motivo: 'Erro de lançamento no PDV',
    tratamentoEstoque: 'ERRO_LANCAMENTO',
    idempotencyKey: erroKey,
  });
  // Pedido integralmente cancelado pode responder 200 (idempotente) ou 409; estoque não muda.
  assert.ok([200, 409].includes(retryErro.statusCode), retryErro.body);
  assert.equal(
    Number(
      (await prisma.inventoryBalance.findUniqueOrThrow({
        where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
      })).quantidade,
    ),
    balanceAfterErro,
    'retry não estorna estoque duas vezes',
  );
  assert.equal(
    await prisma.inventoryMovement.count({ where: { pedidoId: frango.order.id, tipo: 'ESTORNO_VENDA' } }),
    1,
  );

  const balanceBeforePerda = Number(
    (await prisma.inventoryBalance.findUniqueOrThrow({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.medalhaoId } },
    })).quantidade,
  );
  const cancelParcial = await cancelDelivered(f, medalhao, {
    quantidade: 1,
    quantidadeEsperada: 2,
    motivo: 'Cliente desistiu de uma unidade',
    tratamentoEstoque: 'PREPARADO_ENTREGUE_OU_PERDIDO',
    idempotencyKey: randomUUID(),
  });
  assert.equal(cancelParcial.statusCode, 200, cancelParcial.body);
  assert.equal(Number(cancelParcial.json().total), 25);
  assert.equal(
    Number(
      (await prisma.inventoryBalance.findUniqueOrThrow({
        where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.medalhaoId } },
      })).quantidade,
    ),
    balanceBeforePerda,
    'PREPARADO_ENTREGUE_OU_PERDIDO não devolve estoque',
  );
  const medalhaoItem = await prisma.itemComanda.findUniqueOrThrow({ where: { id: medalhao.item.id } });
  assert.equal(medalhaoItem.quantidade, 1);
  assert.equal(medalhaoItem.canceladoEm, null);

  const frangoItem = await prisma.itemComanda.findUniqueOrThrow({ where: { id: frango.item.id } });
  assert.ok(frangoItem.canceladoEm, 'cancelamento total mantém linha com canceladoEm');
  assert.equal(frangoItem.quantidade, 3, 'histórico preserva quantidade cancelada integralmente');

  // Pedido integralmente cancelado + item ativo em outra comanda; pendente não deve inflar vendidos.
  const pendente = await createDeliveredOpenCommand(f, {
    productId: f.medalhaoId,
    nome: 'Medalhão de frango',
    quantity: 1,
    unitPrice: 25,
    stockDebit: false,
  });
  await prisma.itemComanda.update({
    where: { id: pendente.item.id },
    data: { cancelamentoPendenteEm: new Date(), canceladoEm: null },
  });
  // Comanda com cancelamento pendente permanece fora do fechamento do turno;
  // o item não pode inflar vendidos se a comanda for consultada/fechada depois.
  await prisma.comanda.update({
    where: { id: pendente.command.id },
    data: { total: 0, status: 'CANCELADA' },
  });

  const closeBody = await closeCommandAndSession(
    f,
    [frango.command.id, medalhao.command.id, ativo.command.id],
    45,
  );

  const dashboard = await buildOperacaoDashboard(f.tenantId, {
    tipo: 'mes',
    ano: 2026,
    mes: 10,
    inicio: new Date(2026, 9, 1, 0, 0, 0, 0),
    fim: new Date(2026, 9, 31, 23, 59, 59, 999),
    label: 'Out 2026',
  }, f.pointId);
  const porProduto = Object.fromEntries(dashboard.porProduto.map((row) => [row.nome, row]));

  assert.equal(
    dashboard.resumo.itensVendidos,
    2,
    `esperado 1 frango ativo + 1 medalhão restante; recebido ${dashboard.resumo.itensVendidos}`,
  );
  assert.equal(porProduto.Frango?.quantidade, 1);
  assert.equal(porProduto['Medalhão de frango']?.quantidade, 1);
  assert.equal(Math.round(dashboard.resumo.receitaTotal * 100) / 100, 45);

  const dashboardReload = await app.inject({
    method: 'GET',
    url: `/api/operacao/dashboard?ano=2026&mes=10&pontoVendaId=${encodeURIComponent(f.pointId)}`,
    headers: f.headers,
  });
  assert.equal(dashboardReload.statusCode, 200, dashboardReload.body);
  const reloadBody = dashboardReload.json();
  assert.equal(reloadBody.resumo.itensVendidos, 2);
  assert.deepEqual(
    Object.fromEntries(reloadBody.porProduto.map((row) => [row.nome, row.quantidade])),
    { Frango: 1, 'Medalhão de frango': 1 },
  );

  const session = await prisma.sessaoCaixaOperacao.findFirstOrThrow({
    where: { id: f.sessionId, status: 'FECHADO' },
  });
  const turno = await buscarRelatorioTurnoFechado(session.id, f.tenantId);
  assert.equal(turno.itensVendidos, 2);
  assert.deepEqual(
    Object.fromEntries(turno.porProduto.map((row) => [row.nome, row.quantidade])),
    { Frango: 1, 'Medalhão de frango': 1 },
  );
  assert.ok(closeBody, 'fechamento do turno retornou resumo');

  // Ranking/CSV: item cancelado total e pendente não entram na venda líquida.
  const ranking = aggregateChopeRanking([
    {
      clienteId: 'c1',
      cliente: { nome: 'Cliente', telefone: null },
      itens: [
        {
          volumeMl: 300,
          quantidade: 2,
          precoUnit: 12,
          canceladoEm: new Date(),
          cancelamentoPendenteEm: null,
          produto: { tipo: 'BEBIDA', formato: 'CHOPE' },
        },
        {
          volumeMl: 300,
          quantidade: 1,
          precoUnit: 12,
          canceladoEm: null,
          cancelamentoPendenteEm: null,
          produto: { tipo: 'BEBIDA', formato: 'CHOPE' },
        },
      ],
    },
  ]);
  assert.equal(ranking[0]?.totalMl, 300);
  assert.equal(ranking[0]?.pedidos, 1);

  const csv = buildRelatorioEventoCsv([
    {
      id: 'comanda-csv',
      total: 12,
      fechadaEm: closedAt,
      updatedAt: closedAt,
      cliente: { nome: 'Cliente', telefone: null },
      contaReceber: null,
      pagamentos: [{ forma: 'PIX', valor: 12, pagoEm: closedAt }],
      itens: [
        {
          nome: 'Chope cancelado',
          volumeMl: 300,
          quantidade: 2,
          precoUnit: 12,
          canceladoEm: new Date(),
          cancelamentoPendenteEm: null,
          produto: { nome: 'Chope cancelado' },
        },
        {
          nome: 'Chope ativo',
          volumeMl: 300,
          quantidade: 1,
          precoUnit: 12,
          canceladoEm: null,
          cancelamentoPendenteEm: null,
          produto: { nome: 'Chope ativo' },
        },
      ],
    },
  ]);
  assert.match(csv, /Chope ativo/);
  assert.doesNotMatch(csv, /Chope cancelado/);
});

test('Thiago/churrasquinho: 3 lançados, 1 cancelado após entrega → 2 vendidos e R$ 28 no resumo', async () => {
  const f = await seedTenant('churrasquinho');
  const unitPrice = 14;
  const churras = await createDeliveredOpenCommand(f, {
    productId: f.frangoId,
    nome: 'Churrasquinho de boi',
    quantity: 3,
    unitPrice,
  });
  await prisma.produto.update({ where: { id: f.frangoId }, data: { nome: 'Churrasquinho de boi' } });
  await prisma.itemComanda.update({ where: { id: churras.item.id }, data: { nome: 'Churrasquinho de boi' } });
  await prisma.inventoryBalance.update({
    where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
    data: { quantidade: 36 },
  });

  const before = Number(
    (await prisma.inventoryBalance.findUniqueOrThrow({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
    })).quantidade,
  );
  assert.equal(before, 36, 'após baixa dos 3: estoque 39-3=36 (cenário informado)');

  const cancelOne = await cancelDelivered(f, churras, {
    quantidade: 1,
    quantidadeEsperada: 3,
    motivo: 'Cliente desistiu de um churrasquinho',
    tratamentoEstoque: 'ERRO_LANCAMENTO',
    idempotencyKey: randomUUID(),
  });
  assert.equal(cancelOne.statusCode, 200, cancelOne.body);
  assert.equal(Number(cancelOne.json().total), 28);
  assert.equal(
    Number(
      (await prisma.inventoryBalance.findUniqueOrThrow({
        where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
      })).quantidade,
    ),
    37,
  );

  const item = await prisma.itemComanda.findUniqueOrThrow({ where: { id: churras.item.id } });
  assert.equal(item.quantidade, 2);
  assert.equal(item.canceladoEm, null);

  await closeCommandAndSession(f, [churras.command.id], 28);

  const dashboard = await buildOperacaoDashboard(f.tenantId, {
    tipo: 'mes',
    ano: 2026,
    mes: 10,
    inicio: new Date(2026, 9, 1, 0, 0, 0, 0),
    fim: new Date(2026, 9, 31, 23, 59, 59, 999),
    label: 'Out 2026',
  }, f.pointId);
  const produto = dashboard.porProduto.find((row) => row.nome === 'Churrasquinho de boi');
  assert.equal(dashboard.resumo.itensVendidos, 2, `bruto antigo seria 3; líquido=${dashboard.resumo.itensVendidos}`);
  assert.equal(produto?.quantidade, 2);
  assert.equal(Math.round((produto?.receita ?? 0) * 100) / 100, 28);
  assert.notEqual(Math.round((produto?.receita ?? 0) * 100) / 100, 42, 'não manter R$ 42 brutos no ranking');

  const session = await prisma.sessaoCaixaOperacao.findFirstOrThrow({
    where: { id: f.sessionId, status: 'FECHADO' },
  });
  const turno = await buscarRelatorioTurnoFechado(session.id, f.tenantId);
  assert.equal(turno.itensVendidos, 2);
  assert.equal(turno.porProduto.find((row) => row.nome === 'Churrasquinho de boi')?.quantidade, 2);
  assert.equal(Math.round((turno.porProduto.find((row) => row.nome === 'Churrasquinho de boi')?.receita ?? 0) * 100) / 100, 28);

  // Histórico após fechamento: listagem por sessaoCaixaId sem reabrir o caixa.
  const listClosed = await app.inject({
    method: 'GET',
    url: `/api/operacao/comandas?status=FECHADA&pontoVendaId=${encodeURIComponent(f.pointId)}&sessaoCaixaId=${encodeURIComponent(session.id)}`,
    headers: f.headers,
  });
  assert.equal(listClosed.statusCode, 200, listClosed.body);
  const comandas = listClosed.json();
  assert.equal(comandas.length, 1);
  assert.equal(comandas[0].id, churras.command.id);
  assert.equal(comandas[0].total, 28);
  assert.ok(Array.isArray(comandas[0].pagamentos));
  assert.equal(comandas[0].pagamentos.length, 1);
  assert.equal(comandas[0].pagamentos[0].forma, 'DINHEIRO');

  const detail = await app.inject({
    method: 'GET',
    url: `/api/operacao/comandas/${churras.command.id}`,
    headers: f.headers,
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().status, 'FECHADA');
  const itens = detail.json().pedidos.flatMap((pedido) => pedido.itens);
  assert.equal(itens.reduce((soma, itemRow) => soma + itemRow.quantidade, 0), 2);
});

test('concorrência de cancelamento entregue com ERRO_LANCAMENTO não duplica estorno', async () => {
  const f = await seedTenant('net-sold-race');
  const fixture = await createDeliveredOpenCommand(f, {
    productId: f.frangoId,
    nome: 'Frango',
    quantity: 1,
    unitPrice: 20,
  });
  const before = Number(
    (await prisma.inventoryBalance.findUniqueOrThrow({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
    })).quantidade,
  );
  const body = {
    quantidade: 1,
    quantidadeEsperada: 1,
    motivo: 'Erro de lançamento concorrente',
    tratamentoEstoque: 'ERRO_LANCAMENTO',
    idempotencyKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    cancelDelivered(f, fixture, body),
    cancelDelivered(f, fixture, { ...body, idempotencyKey: randomUUID() }),
  ]);
  assert.ok([a.statusCode, b.statusCode].includes(200));
  assert.ok([a.statusCode, b.statusCode].some((code) => code === 200 || code === 409));
  const after = Number(
    (await prisma.inventoryBalance.findUniqueOrThrow({
      where: { pontoVendaId_produtoId: { pontoVendaId: f.pointId, produtoId: f.frangoId } },
    })).quantidade,
  );
  assert.equal(after, before + 1);
  assert.equal(
    await prisma.inventoryMovement.count({ where: { pedidoId: fixture.order.id, tipo: 'ESTORNO_VENDA' } }),
    1,
  );
});
