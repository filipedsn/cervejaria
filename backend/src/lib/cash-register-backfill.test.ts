import assert from 'node:assert/strict';
import test from 'node:test';
import { planCashRegisterBackfill } from './cash-register-backfill.js';

test('backfill selects only null legacy units and preserves explicit decisions', () => {
  const plan = planCashRegisterBackfill([
    { id: 'null-legacy', usaCaixa: null, legacyQuiosqueActive: true },
    { id: 'true', usaCaixa: true, legacyQuiosqueActive: true },
    { id: 'false', usaCaixa: false, legacyQuiosqueActive: true },
    { id: 'cia', usaCaixa: null, legacyQuiosqueActive: false },
  ]);
  assert.deepEqual(plan, { updateIds: ['null-legacy'], processed: 4, alreadyExplicitTrue: 1, alreadyExplicitFalse: 1, skipped: 1 });
});

test('a repeated backfill plan has no update once values are explicit', () => {
  const plan = planCashRegisterBackfill([{ id: 'legacy', usaCaixa: true, legacyQuiosqueActive: true }]);
  assert.deepEqual(plan.updateIds, []);
  assert.equal(plan.alreadyExplicitTrue, 1);
});
