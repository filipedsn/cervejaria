import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp, setupSocketIO } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const app = await buildApp();
setupSocketIO(app, app.server);
await app.ready();
const checks = [];
function auth(user) { return { authorization: `Bearer ${signUserToken(app, user)}` }; }
async function check(name, fn) { process.stdout.write(`RUN ${name}\n`); await fn(); checks.push(name); process.stdout.write(`PASS ${name}\n`); }

try {
  const company = await prisma.cervejaria.create({ data: { nome: `TAP-121 QA ${suffix}`, slug: `tap121-${suffix}` } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'PDV TAP-121 QA', ativo: true, usaCaixa: true } });
  await prisma.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, exclusivo: true } });
  await prisma.configuracaoOperacional.create({ data: { cervejariaId: company.id, setupCompletedAt: new Date('2026-10-01T00:00:00.000Z'), directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false } });
  await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
  const owner = await prisma.usuario.create({ data: { nome: 'Owner TAP-121 QA', email: `owner-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'DONO' } });
  const day = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00.000Z');
  const session = await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, trailerId: null, diaOperacional: day, trocoInicial: 0, abertoPorId: owner.id } });
  const products = [];
  const taps = [];
  for (let index = 1; index <= 5; index += 1) {
    const product = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Chope Tap ${index} QA`, categoria: 'Chope', tipo: 'BEBIDA', formato: 'CHOPE', ativo: true } });
    await prisma.preco.createMany({ data: [{ produtoId: product.id, volumeMl: 300, preco: 15 + index }, { produtoId: product.id, volumeMl: 473, preco: 22 + index }] });
    await prisma.sessaoCaixaProdutoOperacao.createMany({ data: [{ sessaoCaixaId: session.id, produtoId: product.id, volumeMl: 300 }, { sessaoCaixaId: session.id, produtoId: product.id, volumeMl: 473 }] });
    const tap = await prisma.tap.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, numero: index, nome: `Tap ${index} QA`, ativo: true } });
    await prisma.tapMontagem.create({ data: { tapId: tap.id, produtoId: product.id, sessaoCaixaId: session.id } });
    products.push(product);
    taps.push(tap);
  }

  await check('canonical taps without trailer are returned in the open PDV shift and stale shift is rejected', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/operacao/caixa/taps?pontoVendaId=${point.id}&sessaoCaixaId=${session.id}`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.pontoVendaId, point.id);
    assert.equal(body.sessaoCaixaId, session.id);
    assert.equal(body.trailerId, undefined);
    assert.deepEqual(body.taps.map((tap) => [tap.id, tap.numero, tap.chopeAtual.id]), taps.map((tap, index) => [tap.id, index + 1, products[index].id]));
    const stale = await app.inject({ method: 'GET', url: `/api/operacao/caixa/taps?pontoVendaId=${point.id}&sessaoCaixaId=stale-${suffix}`, headers: auth(owner) });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, 'CASH_SESSION_CHANGED');
  });

  await check('sale API revalidates selected Tap and persists product, Tap, volume, server price, and paid snapshot', async () => {
    for (let index = 0; index < taps.length; index += 1) {
      const price = 22 + index + 1;
      const response = await app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: auth(owner), payload: {
        pontoVendaId: point.id,
        itens: [{ produtoId: products[index].id, quantidade: 2, tapId: taps[index].id, volumeMl: 473 }],
        pagamentos: [{ forma: 'PIX', valor: price * 2 }],
      } });
      assert.equal(response.statusCode, 201, response.body);
      const comandaId = response.json().id;
      const item = await prisma.itemComanda.findFirst({ where: { comandaId }, select: { produtoId: true, tapId: true, volumeMl: true, quantidade: true, precoUnit: true, nome: true } });
      assert.deepEqual({ ...item, precoUnit: Number(item.precoUnit) }, { produtoId: products[index].id, tapId: taps[index].id, volumeMl: 473, quantidade: 2, precoUnit: price, nome: products[index].nome });
      const command = await prisma.comanda.findUniqueOrThrow({ where: { id: comandaId }, select: { origem: true, pontoVendaId: true, sessaoCaixaRealizacaoId: true, status: true, total: true } });
      assert.deepEqual({ ...command, total: Number(command.total) }, { origem: 'CAIXA', pontoVendaId: point.id, sessaoCaixaRealizacaoId: session.id, status: 'FECHADA', total: price * 2 });
      assert.equal(await prisma.pagamento.count({ where: { comandaId } }), 1);
    }
    const before = await prisma.comanda.count({ where: { pontoVendaId: point.id } });
    const invalid = await app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: auth(owner), payload: {
      pontoVendaId: point.id, itens: [{ produtoId: products[0].id, quantidade: 1, tapId: taps[1].id, volumeMl: 473 }], pagamentos: [{ forma: 'PIX', valor: 23 }],
    } });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(await prisma.comanda.count({ where: { pontoVendaId: point.id } }), before);
  });

  process.stdout.write(`PASS TAP121_CHECKS=${checks.length}\n`);
} finally {
  await app.close();
  await prisma.$disconnect();
}
