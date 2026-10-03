import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { buildPdvPlanningGraph, readPdvPlanningSourceSnapshot } from './pdv-unico-source-graph.js';
import { planPdvMigration } from './pdv-unico-migration-planner.js';
import { serializeCommandSnapshot } from './pdv-unico-snapshot.js';

const qaDatabaseUrl = validateIsolatedQaEnvironment(process.env).toString();
process.env.DATABASE_URL = qaDatabaseUrl;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: qaDatabaseUrl } } });

async function createTenant(suffix: string, prefix: string) {
  const company = await prisma.cervejaria.create({ data: { nome: `Synthetic ${prefix} ${suffix}`, slug: `pdvqa-${prefix}-${suffix}` } });
  const user = await prisma.usuario.create({ data: { nome: `Synthetic ${prefix} operator`, email: `pdvqa-${prefix}-${suffix}@example.invalid`, senhaHash: 'test-only', papel: 'DONO', cervejariaId: company.id } });
  const trailer = await prisma.trailer.create({ data: { nome: `Synthetic ${prefix} trailer`, cervejariaId: company.id } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: `Synthetic ${prefix} point` } });
  return { companyId: company.id, userId: user.id, trailerId: trailer.id, pointId: point.id };
}

test('PDV-GRAPH-QA-01: leitura e construção compartilhadas detectam conflitos reais e conservam destino/snapshot exato', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let tenantA: Awaited<ReturnType<typeof createTenant>> | undefined;
  let tenantB: Awaited<ReturnType<typeof createTenant>> | undefined;
  const commandIds: string[] = [];
  const eventIds: string[] = [];
  const eventSessionIds: string[] = [];
  let operationSessionId: string | undefined;
  let itemId: string | undefined;
  let optionalId: string | undefined;
  let receivableId: string | undefined;
  let paymentIds: string[] = [];
  try {
    tenantA = await createTenant(suffix, 'a');
    tenantB = await createTenant(suffix, 'b');
    const client = await prisma.cliente.create({ data: { cervejariaId: tenantA.companyId, nome: `Synthetic client ${suffix}` } });
    const foreignClient = await prisma.cliente.create({ data: { cervejariaId: tenantB.companyId, nome: `Synthetic foreign client ${suffix}` } });
    const product = await prisma.produto.create({ data: { cervejariaId: tenantA.companyId, nome: `Synthetic product ${suffix}`, controlaEstoque: true } });

    const agenda = await prisma.evento.create({ data: {
      cervejariaId: tenantA.companyId, trailerId: tenantA.trailerId, nome: 'Synthetic weekly definition', local: 'QA',
      recorrencia: 'SEMANAL', diaSemana: 6, status: 'FECHADO',
    } });
    const occurrence = await prisma.evento.create({ data: {
      cervejariaId: tenantA.companyId, trailerId: tenantA.trailerId, nome: 'Synthetic dated occurrence', local: 'QA',
      recorrencia: 'NENHUMA', serieId: agenda.id, data: new Date('2026-10-03T00:00:00.000Z'), status: 'ABERTO',
    } });
    eventIds.push(agenda.id, occurrence.id);
    const eventCash = await prisma.sessaoCaixaEvento.create({ data: { eventoId: occurrence.id, abertoPorId: tenantA.userId, trocoInicial: '7.13' } });
    eventSessionIds.push(eventCash.id);
    const operationCash = await prisma.sessaoCaixaOperacao.create({ data: {
      cervejariaId: tenantA.companyId, pontoVendaId: tenantA.pointId, diaOperacional: new Date('2026-10-03T00:00:00.000Z'),
      trocoInicial: '3.21', abertoPorId: tenantA.userId,
    } });
    operationSessionId = operationCash.id;

    const command = await prisma.comanda.create({ data: {
      origem: 'EVENTO', eventoId: occurrence.id, pontoVendaId: tenantA.pointId, clienteId: client.id,
      status: 'FECHADA', total: '12.59', desconto: '0.00', diaOperacional: new Date('2026-10-03T00:00:00.000Z'),
    } });
    commandIds.push(command.id);
    const item = await prisma.itemComanda.create({ data: {
      comandaId: command.id, produtoId: product.id, volumeMl: 500, quantidade: 2, precoUnit: '6.17',
      nome: 'Synthetic sold snapshot', exigePreparo: true, paraViagem: false, createdAt: new Date('2026-10-03T13:14:15.000Z'),
      opcionais: { create: [{ nome: 'Synthetic topping snapshot', precoAdicional: '0.25', quantidade: 1 }] },
    }, include: { opcionais: true } });
    itemId = item.id;
    optionalId = item.opcionais[0]!.id;
    const account = await prisma.contaReceber.create({ data: { comandaId: command.id, clienteId: client.id, valorOriginal: '12.59', criadoPorId: tenantA.userId } });
    receivableId = account.id;
    const dualSessionPayment = await prisma.pagamento.create({ data: {
      comandaId: command.id, contaReceberId: account.id, sessaoCaixaId: operationCash.id, sessaoCaixaEventoId: eventCash.id,
      forma: 'DINHEIRO', valor: '0.34', valorRecebido: '0.50', troco: '0.16', pagoEm: new Date('2026-10-03T14:15:16.000Z'),
    } });
    const missingSessionPayment = await prisma.pagamento.create({ data: {
      comandaId: command.id, sessaoCaixaId: `missing-session-${suffix}`, forma: 'PIX', valor: '1.01', pagoEm: new Date('2026-10-03T15:16:17.000Z'),
    } });
    paymentIds = [dualSessionPayment.id, missingSessionPayment.id];

    const mismatched = await prisma.comanda.create({ data: {
      origem: 'EVENTO', eventoId: occurrence.id, pontoVendaId: tenantB.pointId, clienteId: foreignClient.id,
      status: 'FECHADA', total: '4.56', desconto: '0.00',
    } });
    commandIds.push(mismatched.id);
    const child = await prisma.itemComanda.create({ data: { comandaId: mismatched.id, produtoId: product.id, quantidade: 1, precoUnit: '4.56', nome: 'Synthetic blocked child' } });
    itemId = item.id;
    const otherItemId = child.id;

    const source = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return readPdvPlanningSourceSnapshot(tx, tenantA!.companyId);
    }, { isolationLevel: 'RepeatableRead' });
    const graph = buildPdvPlanningGraph(source);
    const plan = planPdvMigration({ companyId: tenantA.companyId, pdvIds: source.pdvs.map((row) => row.id), trailerIds: source.trailers.map((row) => row.id), records: graph.records });
    const find = (type: string, id: string) => plan.find((row) => row.sourceType === type && row.sourceId === id)!;

    const acceptedCommand = find('COMANDA', command.id);
    assert.equal(acceptedCommand.sourceValidation.status, 'VALID');
    assert.deepEqual(acceptedCommand.targetMapping.destinationEntity, { type: 'COMANDA', id: command.id });
    assert.equal(acceptedCommand.targetMapping.destinationLinks.origemHistorica, 'EVENTO');
    assert.equal(acceptedCommand.targetMapping.destinationLinks.ocorrenciaId, occurrence.id);
    assert.equal(acceptedCommand.executionEligibility, 'NOT_AUTHORIZED');

    assert.deepEqual(find('EVENTO', agenda.id).targetMapping.destinationEntity, { type: 'AGENDA_OPERACIONAL', id: agenda.id });
    assert.deepEqual(find('EVENTO', occurrence.id).targetMapping.destinationEntity, { type: 'OCORRENCIA_OPERACIONAL', id: occurrence.id });
    assert.deepEqual(find('SESSAO_EVENTO', eventCash.id).targetMapping.destinationEntity, { type: 'SESSAO_CAIXA', id: eventCash.id });
    assert.equal(find('SESSAO_EVENTO', eventCash.id).targetMapping.destinationLinks.origemHistorica, 'EVENTO');
    assert.equal(find('SESSAO_EVENTO', eventCash.id).targetMapping.destinationLinks.contextoOperacional, 'CAIXA');

    const validDebt = find('CONTA_RECEBER', account.id);
    assert.equal(validDebt.sourceValidation.status, 'VALID', 'dívida EVENTO válida não deve ser bloqueada pela origem');
    assert.equal(validDebt.sourceValidation.blocker, null);
    assert.equal(validDebt.targetMapping.status, 'INCOMPLETE', 'o transformador financeiro ainda não está definido');

    const incompatible = find('COMANDA', mismatched.id);
    assert.equal(incompatible.sourceValidation.blocker?.code, 'CROSS_TENANT_PARENT');
    assert.equal(find('ITEM_COMANDA', otherItemId).sourceValidation.blocker?.code, 'BLOCKED_PARENT');

    const dualGraphConflict = graph.paymentLinkConflicts.find((row) => row.id === dualSessionPayment.id);
    assert.equal(dualGraphConflict?.issue, 'both-session-links');
    assert.equal(find('PAGAMENTO', dualSessionPayment.id).sourceValidation.blocker?.code, 'PAYMENT_SESSION_LINK_CONFLICT');
    assert.equal(find('PAGAMENTO', missingSessionPayment.id).sourceValidation.blocker?.code, 'MISSING_PARENT');
    assert.ok(graph.paymentLinkConflicts.some((row) => row.id === missingSessionPayment.id && row.issue === 'missing-or-cross-tenant-operational-session'));

    const sourceCommand = source.commands.find((row) => row.id === command.id)!;
    const snapshot = serializeCommandSnapshot({
      id: sourceCommand.id, origem: sourceCommand.origem, status: sourceCommand.status, tipo: sourceCommand.tipo,
      numero: sourceCommand.numero, eventoId: sourceCommand.eventoId, clienteId: sourceCommand.clienteId,
      pontoVendaId: sourceCommand.pontoVendaId, abertaPorId: sourceCommand.abertaPorId, fechadoPorId: sourceCommand.fechadoPorId,
      fechadaEm: sourceCommand.fechadaEm, diaOperacional: sourceCommand.diaOperacional, eventoData: sourceCommand.evento?.data ?? null,
      createdAt: sourceCommand.createdAt, updatedAt: sourceCommand.updatedAt, total: sourceCommand.total, desconto: sourceCommand.desconto,
      itens: sourceCommand.itens.map((row) => ({
        id: row.id, produtoId: row.produtoId, tapId: row.tapId, volumeMl: row.volumeMl, quantidade: row.quantidade,
        precoUnit: row.precoUnit, exigePreparo: row.exigePreparo, paraViagem: row.paraViagem, cancelamentoPendenteEm: row.cancelamentoPendenteEm,
        canceladoEm: row.canceladoEm, pedidoCozinhaId: row.pedidoCozinhaId, createdAt: row.createdAt,
        opcionais: row.opcionais.map((opt) => ({ id: opt.id, opcionalId: opt.opcionalId, opcionalCatalogoId: opt.opcionalCatalogoId, precoAdicional: opt.precoAdicional, quantidade: opt.quantidade })),
      })),
    });
    assert.equal(snapshot.id, command.id);
    assert.equal(snapshot.totalCents, '1259');
    assert.equal(snapshot.items[0]?.id, itemId);
    assert.equal(snapshot.items[0]?.quantity, 2);
    assert.equal(snapshot.items[0]?.unitPriceCents, '617');
    assert.equal(snapshot.items[0]?.optionals[0]?.id, optionalId);
    assert.equal(snapshot.items[0]?.optionals[0]?.centsEach, '25');
    assert.equal(snapshot.items[0]?.optionals[0]?.quantity, 1);
    assert.equal(source.receivables.find((row) => row.id === receivableId)?.valorOriginal.toFixed(2), '12.59');
    assert.deepEqual(source.payments.filter((row) => paymentIds.includes(row.id)).map((row) => ({ id: row.id, cents: row.valor.toFixed(2), received: row.valorRecebido?.toFixed(2) ?? null, change: row.troco?.toFixed(2) ?? null })).sort((a,b)=>a.id.localeCompare(b.id)), [
      { id: dualSessionPayment.id, cents: '0.34', received: '0.50', change: '0.16' },
      { id: missingSessionPayment.id, cents: '1.01', received: null, change: null },
    ].sort((a,b)=>a.id.localeCompare(b.id)));
    console.log(`PASS PDV-GRAPH-QA-01: shared read/build; source rows=${source.commands.length} commands/${source.payments.length} payments; agenda/occurrence/shared cash targets; dual/missing session and tenant blockers; exact snapshot IDs/cents. Fixture children=${itemId},${optionalId},${otherItemId}; no business writes outside disposable QA.`);
  } finally {
    if (tenantA) {
      await prisma.pagamento.deleteMany({ where: { comandaId: { in: commandIds } } });
      await prisma.contaReceber.deleteMany({ where: { comandaId: { in: commandIds } } });
      await prisma.comanda.deleteMany({ where: { id: { in: commandIds } } });
      await prisma.movimentoCaixaEvento.deleteMany({ where: { sessao: { eventoId: { in: eventIds } } } });
      await prisma.sessaoCaixaEvento.deleteMany({ where: { id: { in: eventSessionIds } } });
      if (operationSessionId) await prisma.sessaoCaixaOperacao.deleteMany({ where: { id: operationSessionId } });
      await prisma.evento.deleteMany({ where: { id: { in: eventIds } } });
      if (tenantB) await prisma.cervejaria.delete({ where: { id: tenantB.companyId } });
      await prisma.cervejaria.delete({ where: { id: tenantA.companyId } });
    }
  }
});

test.after(async () => { await prisma.$disconnect(); });
