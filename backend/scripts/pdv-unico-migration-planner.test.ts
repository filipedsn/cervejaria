import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSourceGraphValid, decimalToScaledInteger, planPdvMigration, sumScaledDecimals, type PdvPlanningCompany, type PlanningRecord } from './pdv-unico-migration-planner.js';
import { buildPdvPlanningGraph, type PdvPlanningGraphInput } from './pdv-unico-source-graph.js';

const rec = (type: PlanningRecord['type'], id: string, options: Partial<PlanningRecord> = {}): PlanningRecord => ({ type, id, tenantId: 'co-a', ...options });
const fixture = (records: PlanningRecord[] = []): PdvPlanningCompany => ({
  companyId: 'co-a', pdvIds: ['pdv-a'], trailerIds: ['trailer-a'],
  records: [
    rec('PDV', 'pdv-a'), rec('TRAILER', 'trailer-a'),
    rec('EVENTO', 'event-a', { eventRole: 'OCORRENCIA', parents: [{ type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' }], sourceLinks: { trailerId: 'trailer-a' }, pdvFrom: { type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' } }),
    rec('CLIENTE', 'client-a'), rec('PRODUTO', 'product-a'),
    ...records,
  ],
});
const row = (records: PlanningRecord[], type: PlanningRecord['type'], id: string, setup: Partial<PdvPlanningCompany> = {}) => planPdvMigration({ ...fixture(records), ...setup }).find((item) => item.sourceType === type && item.sourceId === id)!;
const emptyGraph = (input: Partial<PdvPlanningGraphInput> = {}): PdvPlanningGraphInput => ({
  companyId: 'co-a', pdvs: [], trailers: [], clients: [], customerStatistics: [], products: [], menus: [], optionals: [], events: [],
  portalOrders: [], transactionLogs: [], eventExclusions: [], eventProducts: [], taps: [], eventSessions: [], operationalSessions: [],
  commands: [], orders: [], payments: [], receivables: [], tapSetups: [], balances: [], stockMovements: [], operationalConfig: null, moduleConfig: null,
  ...input,
});

test('separa validacao da origem, transformacao alvo e elegibilidade para escrever', () => {
  const command = rec('COMANDA', 'cmd-a', { historicalOrigin: 'EVENTO', parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, { type: 'PDV', id: 'pdv-a', relation: 'pontoVendaId' }, { type: 'CLIENTE', id: 'client-a', relation: 'clienteId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, pdvConstraints: [{ type: 'PDV', id: 'pdv-a', relation: 'pontoVendaId' }], sourceLinks: { eventoId: 'event-a', pontoVendaId: 'pdv-a', clienteId: 'client-a' } });
  const plan = planPdvMigration(fixture([command]));
  const event = plan.find((x) => x.sourceType === 'EVENTO')!;
  const planned = plan.find((x) => x.sourceType === 'COMANDA' && x.sourceId === 'cmd-a')!;
  assert.equal(planned.sourceValidation.status, 'VALID');
  assert.equal(planned.sourceValidation.canonicalPdvId, 'pdv-a');
  assert.equal(planned.targetMapping.status, 'COMPLETE');
  assert.deepEqual(planned.targetMapping.destinationEntity, { type: 'COMANDA', id: 'cmd-a' });
  assert.equal(planned.targetMapping.destinationLinks.origemHistorica, 'EVENTO');
  assert.equal(planned.targetMapping.destinationLinks.ocorrenciaId, event.targetMapping.destinationEntity?.id);
  assert.equal(planned.idPreservation, 'PRESERVE_SOURCE_ID');
  assert.equal(planned.executionEligibility, 'NOT_AUTHORIZED');
  assert.doesNotThrow(() => assertSourceGraphValid(plan));
  assert.ok(plan.every((item) => item.executionEligibility === 'NOT_AUTHORIZED'));
});

test('dívida de origem EVENTO valida a relacao sem fingir que sua transformacao financeira esta implementada', () => {
  const debt = rec('CONTA_RECEBER', 'ar-event', { parents: [{ type: 'COMANDA', id: 'cmd-event', relation: 'comandaId' }, { type: 'CLIENTE', id: 'client-a', relation: 'clienteId' }], pdvFrom: { type: 'COMANDA', id: 'cmd-event', relation: 'comandaId' }, sourceLinks: { comandaId: 'cmd-event', clienteId: 'client-a' } });
  const command = rec('COMANDA', 'cmd-event', { historicalOrigin: 'EVENTO', parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, sourceLinks: { eventoId: 'event-a' } });
  const planned = row([command, debt], 'CONTA_RECEBER', 'ar-event');
  assert.equal(planned.sourceValidation.status, 'VALID');
  assert.equal(planned.sourceValidation.blocker, null);
  assert.equal(planned.targetMapping.status, 'INCOMPLETE');
  assert.equal(planned.targetMapping.blockerCode, 'TARGET_TRANSFORMATION_NOT_DEFINED');
  const orphan = row([rec('CONTA_RECEBER', 'ar-orphan', { parents: [{ type: 'COMANDA', id: 'absent', relation: 'comandaId' }], sourceLinks: { comandaId: 'absent' } })], 'CONTA_RECEBER', 'ar-orphan');
  assert.equal(orphan.sourceValidation.blocker?.code, 'MISSING_PARENT');
});

test('agenda recorrente, ocorrencia e caixa Evento transformam para entidades alvo distintas', () => {
  const records = [
    rec('EVENTO', 'agenda-a', { eventRole: 'AGENDA', parents: [{ type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' }], pdvFrom: { type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' } }),
    rec('EVENTO', 'occurrence-a', { eventRole: 'OCORRENCIA', parents: [{ type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' }, { type: 'EVENTO', id: 'agenda-a', relation: 'serieId' }], pdvFrom: { type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' } }),
    rec('SESSAO_EVENTO', 'cash-a', { historicalOrigin: 'EVENTO', parents: [{ type: 'EVENTO', id: 'occurrence-a', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'occurrence-a', relation: 'eventoId' } }),
  ];
  const plan = planPdvMigration(fixture(records));
  assert.deepEqual(plan.find((x) => x.sourceId === 'agenda-a')?.targetMapping.destinationEntity, { type: 'AGENDA_OPERACIONAL', id: 'agenda-a' });
  assert.deepEqual(plan.find((x) => x.sourceId === 'occurrence-a')?.targetMapping.destinationEntity, { type: 'OCORRENCIA_OPERACIONAL', id: 'occurrence-a' });
  const cash = plan.find((x) => x.sourceId === 'cash-a')!;
  assert.deepEqual(cash.targetMapping.destinationEntity, { type: 'SESSAO_CAIXA', id: 'cash-a' });
  assert.equal(cash.targetMapping.destinationLinks.contextoOperacional, 'CAIXA');
  assert.equal(cash.targetMapping.destinationLinks.origemHistorica, 'EVENTO');
});

test('grafo compartilhado detecta pagamento com duas sessoes sem blocker fornecido pelo chamador', () => {
  const payment = { id: 'payment-db-row', comandaId: 'command-db-row', sessaoCaixaId: 'operational-session-row', sessaoCaixaEventoId: 'event-session-row' };
  const graph = buildPdvPlanningGraph(emptyGraph({
    pdvs: [{ id: 'pdv-a' }], trailers: [{ id: 'trailer-a' }],
    events: [{ id: 'event-db-row', trailerId: 'trailer-a', recorrencia: 'NENHUMA', serieId: null, cardapioId: null, trailer: { cervejariaId: 'co-a' }, serie: null }],
    commands: [{ id: payment.comandaId, origem: 'EVENTO', eventoId: 'event-db-row', pontoVendaId: 'pdv-a', clienteId: null, evento: { cervejariaId: 'co-a' }, pontoVenda: { cervejariaId: 'co-a' }, cliente: null, itens: [] }],
    eventSessions: [{ id: payment.sessaoCaixaEventoId, eventoId: 'event-db-row', evento: { cervejariaId: 'co-a' }, movimentos: [] }],
    operationalSessions: [{ id: payment.sessaoCaixaId, pontoVendaId: 'pdv-a', pontoVenda: { cervejariaId: 'co-a' }, trailerId: null, trailer: null, cardapioId: null, cardapio: null, produtos: [], movimentos: [] }],
    payments: [payment],
  }));
  const plan = planPdvMigration({ companyId: 'co-a', pdvIds: ['pdv-a'], trailerIds: ['trailer-a'], records: graph.records });
  const planned = plan.find((x) => x.sourceId === payment.id)!;
  assert.equal(graph.paymentLinkConflicts[0]?.id, payment.id);
  assert.equal(planned.sourceValidation.blocker?.code, 'PAYMENT_SESSION_LINK_CONFLICT');
  assert.equal(planned.sourceValidation.blocker?.category, 'CONFLITO_DADOS');
});

test('precedencia da capacidade direta resolve divergencia de configuracao sem sincronizar fontes', () => {
  const graph = buildPdvPlanningGraph(emptyGraph({ operationalConfig: { plannedOperationsEnabled: false, inventoryEnabled: true, kitchenEnabled: true }, moduleConfig: { ativo: true, controlaEstoque: false, temCozinha: false } }));
  assert.deepEqual(graph.effectiveConfiguration, {
    operationMode: 'CAIXA', operationModeSource: 'CONFIGURACAO_OPERACIONAL.plannedOperationsEnabled',
    inventoryEnabled: true, inventorySource: 'CONFIGURACAO_OPERACIONAL.inventoryEnabled',
    kitchenEnabled: true, kitchenSource: 'CONFIGURACAO_OPERACIONAL.kitchenEnabled',
  });
  assert.equal(graph.records.some((x) => x.blocker?.code === 'CONFIGURATION_SOURCE_CONFLICT'), false);
});

test('IDs, destinos e resultado ficam estaveis quando as colecoes sao reordenadas', () => {
  const company = fixture([rec('COMANDA', 'cmd-a', { historicalOrigin: 'EVENTO', parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' } })]);
  const shuffled = { ...company, pdvIds: [...company.pdvIds].reverse(), trailerIds: [...company.trailerIds].reverse(), records: [...company.records].reverse() };
  assert.deepEqual(planPdvMigration(company), planPdvMigration(shuffled));
});

test('centavos e quantidades decimais mantêm escala exata', () => {
  assert.equal(sumScaledDecimals(['0.10', '0.20', '-0.03'], 2), 27n);
  assert.equal(decimalToScaledInteger('-12.340', 3), -12340n);
  assert.equal(sumScaledDecimals(['0.125', '1.005', '-0.010'], 3), 1120n);
  assert.throws(() => decimalToScaledInteger('0.001', 2));
});
