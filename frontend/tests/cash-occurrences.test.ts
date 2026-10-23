import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashOccurrenceQueryUrl,
  cashOccurrenceSelectionIsEligible,
  eligibleCashOccurrences,
  type CashOccurrenceOption,
} from '../src/lib/cash-occurrences.js';

const operationalDay = '2026-10-22';
const fixtures: CashOccurrenceOption[] = [
  { id: 'yesterday', nome: 'Ontem', data: '2026-10-21', status: 'PROGRAMADA', agenda: null },
  { id: 'today-a', nome: 'Hoje A', data: operationalDay, status: 'PROGRAMADA', agenda: null },
  { id: 'today-b', nome: 'Hoje B', data: operationalDay, status: 'ABERTA', agenda: null },
  { id: 'tomorrow', nome: 'Amanhã', data: '2026-10-23', status: 'PROGRAMADA', agenda: null },
  { id: 'closed', nome: 'Fechada', data: operationalDay, status: 'FECHADA', agenda: null },
  { id: 'cancelled', nome: 'Cancelada', data: operationalDay, status: 'CANCELADA', agenda: null },
];

test('cash selector requests only the backend operational day', () => {
  assert.equal(cashOccurrenceQueryUrl(operationalDay), '/api/operacao/agenda/ocorrencias?inicio=2026-10-22&fim=2026-10-22');
});

test('cash selector exposes every eligible occurrence today and excludes other dates and statuses', () => {
  assert.deepEqual(eligibleCashOccurrences(fixtures, operationalDay).map(({ id }) => id), ['today-a', 'today-b']);
  assert.equal(cashOccurrenceSelectionIsEligible(fixtures, 'today-a', operationalDay), true);
  assert.equal(cashOccurrenceSelectionIsEligible(fixtures, 'tomorrow', operationalDay), false);
  assert.equal(cashOccurrenceSelectionIsEligible(fixtures, 'closed', operationalDay), false);
  assert.equal(cashOccurrenceSelectionIsEligible(fixtures, 'cancelled', operationalDay), false);
  assert.equal(cashOccurrenceSelectionIsEligible(fixtures, 'today-a', '2026-10-23'), false);
});

test('cash selector keeps no selection when the operational day has no eligible occurrences', () => {
  assert.deepEqual(eligibleCashOccurrences(fixtures, '2026-10-24'), []);
  assert.equal(cashOccurrenceSelectionIsEligible(fixtures, 'today-a', '2026-10-24'), false);
});
