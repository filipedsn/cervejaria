import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const app = await buildApp();
await app.ready();
function day(value) { return new Date(`${value}T00:00:00.000Z`); }
function auth(user) { return { authorization: `Bearer ${signUserToken(app, user)}` }; }
async function check(name, fn) { process.stdout.write(`RUN ${name}\n`); await fn(); process.stdout.write(`PASS ${name}\n`); }
try {
  const company = await prisma.cervejaria.create({ data: { nome: `CIA Ranking QA ${suffix}`, slug: `cia-rank-${suffix}` } });
  const foreignCompany = await prisma.cervejaria.create({ data: { nome: `CIA Outra QA ${suffix}`, slug: `cia-other-${suffix}` } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Principal QA', ativo: true, usaCaixa: true } });
  const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'Outro PDV QA', ativo: true, usaCaixa: true } });
  for (const [tenant, pdv] of [[company, point], [foreignCompany, foreignPoint]]) {
    await prisma.configuracaoOperacao.create({ data: { cervejariaId: tenant.id, ativo: true, exclusivo: true } });
    await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: tenant.id, pontoVendaId: pdv.id, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
  }
  const owner = await prisma.usuario.create({ data: { nome: 'Owner QA', email: `owner-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'DONO' } });
  const denied = await prisma.usuario.create({ data: { nome: 'Denied QA', email: `denied-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'ATENDENTE', permissoesOperacao: [] } });
  const foreignOwner = await prisma.usuario.create({ data: { nome: 'Foreign QA', email: `foreign-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: foreignCompany.id, papel: 'DONO' } });
  const primaryClient = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Cliente Homônimo QA', telefone: null } });
  const homonym = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Cliente Homônimo QA', telefone: null } });
  const foreignClient = await prisma.cliente.create({ data: { cervejariaId: foreignCompany.id, nome: 'Cliente Homônimo QA', telefone: null } });
  await prisma.clienteEstatisticas.create({ data: { clienteId: primaryClient.id } });
  const agenda = await prisma.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Sextas QA', diaSemana: 5, primeiraData: day('2025-07-01'), ultimaData: day('2026-11-30'), horaInicio: '18:00', horaFim: '22:00', ativa: true } });
  const occurrenceRows = [];
  for (const value of ['2025-07-01', '2026-10-01', '2026-10-31', '2026-11-01']) {
    occurrenceRows.push(await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: agenda.id, nome: 'Sextas QA', data: day(value), horaInicio: '18:00', horaFim: '22:00' } }));
  }
  const product = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Chope QA', tipo: 'BEBIDA', formato: 'CHOPE' } });
  async function sale({ client = primaryClient, origin = 'EVENTO', occurrence, operationalDate, volume, status = 'FECHADA', canceled = false, paid = false, discount = 0 }) {
    const command = await prisma.comanda.create({ data: { origem: origin, clienteId: client.id, status, tipo: 'COMANDA', pontoVendaId: point.id, ocorrenciaId: occurrence?.id ?? null, diaOperacional: operationalDate ? day(operationalDate) : null, total: 10 - discount, desconto: discount, fechadaEm: day(occurrence?.data.toISOString().slice(0, 10) ?? operationalDate ?? '2026-10-01') } });
    await prisma.itemComanda.create({ data: { comandaId: command.id, produtoId: product.id, volumeMl: volume, quantidade: 1, precoUnit: 10, ...(canceled ? { canceladoEm: day('2026-10-02') } : {}) } });
    if (paid) await prisma.pagamento.create({ data: { comandaId: command.id, forma: 'PIX', valor: 10 - discount } });
    return command;
  }
  await sale({ occurrence: occurrenceRows[0], volume: 1500, paid: true, discount: 2 });
  await sale({ occurrence: occurrenceRows[1], volume: 500 });
  await sale({ origin: 'CAIXA', occurrence: occurrenceRows[1], operationalDate: '2026-10-01', volume: 300 });
  await sale({ occurrence: occurrenceRows[2], volume: 1000, client: homonym });
  await sale({ occurrence: occurrenceRows[3], volume: 700 });
  await sale({ occurrence: occurrenceRows[1], volume: 900, canceled: true, status: 'CANCELADA' });
  await sale({ client: foreignClient, occurrence: null, volume: 500, status: 'FECHADA' });

  await check('ranking is canonical by tenant and PDV and accepts migrated EVENTO and current CAIXA origins', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?ocorrenciaId=${occurrenceRows[1].id}&dia=2026-10-01`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.ocorrencia.data, '2026-10-01');
    assert.deepEqual(body.ranking.map((row) => [row.clienteId, row.totalMl]), [[primaryClient.id, 800]]);
    const deniedResponse = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}`, headers: auth(denied) });
    assert.equal(deniedResponse.statusCode, 403, deniedResponse.body);
    const foreignResponse = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}`, headers: auth(foreignOwner) });
    assert.equal(foreignResponse.statusCode, 404, foreignResponse.body);
  });

  await check('monthly DATE boundaries include October 1 and 31, exclude November 1, and list months from sales', async () => {
    const previousTz = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati';
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?mes=2026-10`, headers: auth(owner) });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.deepEqual(body.mesesDisponiveis, ['2026-11', '2026-10', '2025-07']);
      assert.equal(body.entries.reduce((sum, row) => sum + row.totalMl, 0), 1800);
      assert.equal(body.entries.length, 2, 'same-name clients remain separate identities');
      assert.deepEqual(new Set(body.entries.map((row) => row.clienteId)), new Set([primaryClient.id, homonym.id]));
    } finally { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
  });

  await check('recurrence aggregation preserves exact agenda identity and occurrence picker reaches older history', async () => {
    const ranking = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`, headers: auth(owner) });
    assert.equal(ranking.statusCode, 200, ranking.body);
    assert.equal(ranking.json().ranking.reduce((sum, row) => sum + row.totalMl, 0), 4000);
    const rankingBeforeEdit = ranking.json().ranking;
    await prisma.agendaOperacional.update({ where: { id: agenda.id }, data: { nome: 'Sextas QA editada', diaSemana: 4, horaInicio: '19:00' } });
    const afterDefinitionEdit = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`, headers: auth(owner) });
    assert.equal(afterDefinitionEdit.statusCode, 200, afterDefinitionEdit.body);
    assert.deepEqual(afterDefinitionEdit.json().ranking, rankingBeforeEdit, 'definition changes do not change agenda identity or historical ranking');
    const list = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/ocorrencias`, headers: auth(owner) });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(list.json().ocorrencias.some((row) => row.id === occurrenceRows[0].id && row.data === '2025-07-01'));
  });

  await check('customer history keeps unpaid closed sale, exposes canonical context, and never fabricates an event ID', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/clientes/${primaryClient.id}/historico`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const rows = response.json().items;
    assert.ok(rows.some((row) => row.ocorrencia?.id === occurrenceRows[1].id && row.evento === null && row.pontoVenda.id === point.id));
    assert.ok(rows.some((row) => row.status === 'CANCELADA'));
    assert.ok(rows.some((row) => row.total === 0 && row.valorPendente === 10));
    assert.ok(rows.some((row) => row.total === 8 && row.desconto === 2 && row.valorPendente === 0));
    const detail = await app.inject({ method: 'GET', url: `/api/clientes/${primaryClient.id}`, headers: auth(owner) });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().estatisticas.totalComandasFechadas, 4);
    assert.equal(detail.json().estatisticas.totalMlChope, 3000);
    assert.equal(detail.json().estatisticas.totalGasto, 8);
    const foreignHistory = await app.inject({ method: 'GET', url: `/api/clientes/${foreignClient.id}/historico`, headers: auth(owner) });
    assert.equal(foreignHistory.statusCode, 404, foreignHistory.body);
  });
} finally {
  await app.close();
  await prisma.$disconnect();
}
