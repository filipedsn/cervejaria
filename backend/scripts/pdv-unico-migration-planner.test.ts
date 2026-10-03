import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExecutablePlan, decimalToScaledInteger, planPdvMigration, sumScaledDecimals, type PdvPlanningCompany, type PlanningRecord } from './pdv-unico-migration-planner.js';

const rec = (type: PlanningRecord['type'], id: string, options: Partial<PlanningRecord> = {}): PlanningRecord => ({ type, id, tenantId: 'co-a', ...options });
const fixture = (records: PlanningRecord[] = []): PdvPlanningCompany => ({
  companyId: 'co-a', pdvIds: ['pdv-a'], trailerIds: ['trailer-a'],
  records: [
    rec('PDV', 'pdv-a'), rec('TRAILER', 'trailer-a'),
    rec('EVENTO', 'event-a', { parents: [{ type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' }], sourceLinks: { trailerId: 'trailer-a' } }),
    rec('CLIENTE', 'client-a'), rec('PRODUTO', 'product-a'), rec('TAP', 'tap-a', { parents: [{ type: 'TRAILER', id: 'trailer-a', relation: 'trailerId' }, { type: 'PRODUTO', id: 'product-a', relation: 'produtoId' }] }),
    ...records,
  ],
});
const row = (records: PlanningRecord[], type: PlanningRecord['type'], id: string, setup: Partial<PdvPlanningCompany> = {}) => planPdvMigration({ ...fixture(records), ...setup }).find((item) => item.sourceType === type && item.sourceId === id)!;

test('mantém identidade e informa separadamente PDV canônico, vínculos e dependências', () => {
  const command = rec('COMANDA', 'cmd-a', { parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, { type: 'CLIENTE', id: 'client-a', relation: 'clienteId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, sourceLinks: { eventoId: 'event-a', clienteId: 'client-a' } });
  const planned = row([command], 'COMANDA', 'cmd-a');
  assert.equal(planned.action, 'REASSOCIAR');
  assert.deepEqual(planned.destinationEntity, { type: 'COMANDA', id: 'cmd-a' });
  assert.equal(planned.idPreserved, true);
  assert.equal(planned.canonicalPdvId, 'pdv-a');
  assert.deepEqual(planned.destinationLinks, { clienteId: 'client-a', eventoId: 'event-a' });
  assert.equal(planned.dependencies.every((dependency) => dependency.resolved), true);
  assert.equal(planned.mappingComplete, true);
  assertExecutablePlan(planPdvMigration(fixture([command])));
});

test('dívida EVENTO válida mapeia via comanda; dívida órfã bloqueia com código e evidência', () => {
  const command = rec('COMANDA', 'cmd-event', { parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, sourceLinks: { eventoId: 'event-a' } });
  const validDebt = rec('CONTA_RECEBER', 'ar-event', { parents: [{ type: 'COMANDA', id: 'cmd-event', relation: 'comandaId' }, { type: 'CLIENTE', id: 'client-a', relation: 'clienteId' }], pdvFrom: { type: 'COMANDA', id: 'cmd-event', relation: 'comandaId' }, sourceLinks: { comandaId: 'cmd-event', clienteId: 'client-a' } });
  const valid = planPdvMigration(fixture([command, validDebt]));
  assert.equal(valid.find((x) => x.sourceId === 'ar-event')?.action, 'REASSOCIAR');
  assert.equal(valid.find((x) => x.sourceId === 'ar-event')?.destinationLinks.comandaId, 'cmd-event');
  const orphan = row([rec('CONTA_RECEBER', 'ar-orphan', { parents: [{ type: 'COMANDA', id: 'absent', relation: 'comandaId' }], sourceLinks: { comandaId: 'absent' } })], 'CONTA_RECEBER', 'ar-orphan');
  assert.equal(orphan.action, 'BLOQUEADO');
  assert.equal(orphan.blocker?.code, 'MISSING_PARENT');
  assert.throws(() => assertExecutablePlan([orphan]), /blocked or incomplete/);
});

test('evento ausente ou bloqueado, PDV ausente e comanda bloqueada propagam bloqueio aos filhos', () => {
  const missingEventCommand = rec('COMANDA', 'cmd-missing-event', { parents: [{ type: 'EVENTO', id: 'absent-event', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'absent-event', relation: 'eventoId' } });
  const noPdvCommand = rec('COMANDA', 'cmd-no-pdv', { parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }], pdvFrom: { type: 'PDV', id: 'absent-pdv', relation: 'pontoVendaId' } });
  const blockedEvent = rec('EVENTO', 'event-blocked', { blocker: { code: 'EVENT_TENANT', category: 'CONFLITO_DADOS', evidence: 'Tenant do evento não confere.' } });
  const dependent = rec('COMANDA', 'cmd-blocked', { parents: [{ type: 'EVENTO', id: 'event-blocked', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'event-blocked', relation: 'eventoId' } });
  const rows = planPdvMigration({ ...fixture([missingEventCommand, noPdvCommand, blockedEvent, dependent]), pdvIds: [], trailerIds: ['trailer-a'] });
  for (const id of ['cmd-missing-event', 'cmd-no-pdv', 'event-blocked', 'cmd-blocked']) assert.equal(rows.find((x) => x.sourceId === id)?.action, 'BLOQUEADO');
  assert.equal(rows.find((x) => x.sourceId === 'cmd-blocked')?.blocker?.code, 'BLOCKED_PARENT');
});

test('pagamentos exigem comanda e sessão e herdam sessão ausente, dupla ou de outro tenant', () => {
  const base = [rec('SESSAO_CAIXA', 'session-a', { parents: [{ type: 'PDV', id: 'pdv-a', relation: 'pontoVendaId' }], pdvFrom: { type: 'PDV', id: 'pdv-a', relation: 'pontoVendaId' } }), rec('COMANDA', 'cmd-a', { parents: [{ type: 'PDV', id: 'pdv-a', relation: 'pontoVendaId' }], pdvFrom: { type: 'PDV', id: 'pdv-a', relation: 'pontoVendaId' } })];
  const payment = (id: string, parents: PlanningRecord['parents'], blocker?: PlanningRecord['blocker']) => rec('PAGAMENTO', id, { parents, blocker, pdvFrom: { type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' } });
  const rows = planPdvMigration(fixture([...base,
    payment('pay-good', [{ type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' }, { type: 'SESSAO_CAIXA', id: 'session-a', relation: 'sessaoCaixaId' }]),
    payment('pay-missing', [{ type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' }, { type: 'SESSAO_CAIXA', id: 'absent', relation: 'sessaoCaixaId' }]),
    payment('pay-double', [{ type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' }, { type: 'SESSAO_CAIXA', id: 'session-a', relation: 'sessaoCaixaId' }, { type: 'SESSAO_EVENTO', id: 'event-session-a', relation: 'sessaoCaixaEventoId' }], { code: 'PAYMENT_SESSION_LINK_CONFLICT', category: 'CONFLITO_DADOS', evidence: 'Pagamento contém duas sessões.' }),
    payment('pay-cross', [{ type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' }, { type: 'SESSAO_CAIXA', id: 'session-a', relation: 'sessaoCaixaId', tenantId: 'co-b' }]),
  ]));
  assert.equal(rows.find((x) => x.sourceId === 'pay-good')?.mappingComplete, true);
  for (const [id, code] of [['pay-missing', 'MISSING_PARENT'], ['pay-double', 'PAYMENT_SESSION_LINK_CONFLICT'], ['pay-cross', 'CROSS_TENANT_PARENT']]) {
    const result = rows.find((x) => x.sourceId === id)!;
    assert.equal(result.action, 'BLOQUEADO'); assert.equal(result.blocker?.code, code);
  }
});

test('vínculo Evento+PDV válido coalesce por destino comprovado; vínculo divergente é conflito', () => {
  const command = (id: string, pdvId: string) => rec('COMANDA', id, { parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, { type: 'PDV', id: pdvId, relation: 'pontoVendaId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' }, sourceLinks: { eventoId: 'event-a', pontoVendaId: pdvId } });
  const good = row([command('cmd-double-good', 'pdv-a')], 'COMANDA', 'cmd-double-good');
  assert.equal(good.action, 'REASSOCIAR');
  assert.equal(good.canonicalPdvId, 'pdv-a');
  assert.equal(good.destinationLinks.pontoVendaId, 'pdv-a');
  const bad = row([command('cmd-double-bad', 'foreign-pdv')], 'COMANDA', 'cmd-double-bad');
  assert.equal(bad.action, 'BLOQUEADO');
  assert.equal(bad.blocker?.code, 'MISSING_PARENT');
});

test('tenant cruzado em pedido, produto ou cliente bloqueia pedido e todos os dependentes', () => {
  const badProduct = rec('PRODUTO', 'foreign-product', { tenantId: 'co-b' });
  const badClient = rec('CLIENTE', 'foreign-client', { tenantId: 'co-b' });
  const order = rec('PEDIDO', 'order-a', { parents: [{ type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' }, { type: 'CLIENTE', id: 'foreign-client', relation: 'clienteId', tenantId: 'co-b' }], pdvFrom: { type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' } });
  const orderItem = rec('PEDIDO_CLIENTE_ITEM', 'order-item-a', { parents: [{ type: 'PEDIDO', id: 'order-a', relation: 'pedidoId' }, { type: 'PRODUTO', id: 'foreign-product', relation: 'produtoId', tenantId: 'co-b' }] });
  const rows = planPdvMigration(fixture([rec('COMANDA', 'cmd-a'), badProduct, badClient, order, orderItem]));
  assert.equal(rows.find((x) => x.sourceId === 'order-a')?.blocker?.code, 'CROSS_TENANT_PARENT');
  assert.equal(rows.find((x) => x.sourceId === 'order-item-a')?.blocker?.code, 'BLOCKED_PARENT');
});

test('IDs preservados não ocultam links pendentes; nenhum plano bloqueado pode ser executável', () => {
  const command = rec('COMANDA', 'cmd-pending', { sourceLinks: { eventoId: null, pontoVendaId: null } });
  const planned = row([command], 'COMANDA', 'cmd-pending');
  assert.equal(planned.idPreserved, true);
  assert.equal(planned.mappingComplete, true); // entity has no non-null source relation to remap
  const blocked = row([rec('COMANDA', 'cmd-bad', { blocker: { code: 'MANUAL', category: 'DECISAO_MANUAL', evidence: 'Requer revisão.' } })], 'COMANDA', 'cmd-bad');
  assert.equal(blocked.destinationEntity, null);
  assert.equal(blocked.canonicalPdvId, null);
  assert.equal(blocked.idPreserved, true);
  assert.throws(() => assertExecutablePlan([blocked]), /blocked or incomplete/);
  const missingRequired = row([rec('COMANDA', 'cmd-required-null', { sourceLinks: { eventoId: null }, requiredLinks: ['eventoId'] })], 'COMANDA', 'cmd-required-null');
  assert.equal(missingRequired.idPreserved, true);
  assert.equal(missingRequired.mappingComplete, false);
  assert.equal(missingRequired.blocker?.code, 'REQUIRED_SOURCE_LINK_MISSING');
  assert.throws(() => assertExecutablePlan([missingRequired]), /blocked or incomplete/);
  const proposed = planPdvMigration({ ...fixture(), pdvIds: [], records: fixture().records });
  assert.equal(proposed.find((x) => x.sourceType === 'PDV' && x.sourceId.startsWith('proposed-pdv:'))?.action, 'CRIAR_DESTINO');
});

test('destino e resultado são estáveis com coleções reordenadas', () => {
  const records = [rec('COMANDA', 'cmd-a', { parents: [{ type: 'EVENTO', id: 'event-a', relation: 'eventoId' }], pdvFrom: { type: 'EVENTO', id: 'event-a', relation: 'eventoId' } }), rec('ITEM_COMANDA', 'item-a', { parents: [{ type: 'COMANDA', id: 'cmd-a', relation: 'comandaId' }, { type: 'PRODUTO', id: 'product-a', relation: 'produtoId' }] })];
  const source = fixture(records);
  const shuffled = { ...source, pdvIds: [...source.pdvIds].reverse(), trailerIds: [...source.trailerIds].reverse(), records: [...source.records].reverse() };
  assert.deepEqual(planPdvMigration(source), planPdvMigration(shuffled));
});

test('centavos e quantidades decimais mantêm escala exata', () => {
  assert.equal(sumScaledDecimals(['0.10', '0.20', '-0.03'], 2), 27n);
  assert.equal(decimalToScaledInteger('-12.340', 3), -12340n);
  assert.equal(sumScaledDecimals(['0.125', '1.005', '-0.010'], 3), 1120n);
  assert.throws(() => decimalToScaledInteger('0.001', 2));
});
