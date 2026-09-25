import assert from 'node:assert/strict';
import test from 'node:test';
import { planCashRegisterBackfill } from './cash-register-backfill.js';
import { planOperationalEnablementBackfill } from './operational-enablement-backfill.js';

test('backfill selects only null legacy units and preserves explicit decisions', () => {
  const plan = planCashRegisterBackfill([
    { id: 'null-legacy', usaCaixa: null, legacyOperacaoActive: true },
    { id: 'true', usaCaixa: true, legacyOperacaoActive: true },
    { id: 'false', usaCaixa: false, legacyOperacaoActive: true },
    { id: 'cia', usaCaixa: null, legacyOperacaoActive: false },
  ]);
  assert.deepEqual(plan, { updateIds: ['null-legacy'], processed: 4, alreadyExplicitTrue: 1, alreadyExplicitFalse: 1, skipped: 1, fallbackRequired: 1 });
});

test('a repeated backfill plan has no update once values are explicit', () => {
  const plan = planCashRegisterBackfill([{ id: 'legacy', usaCaixa: true, legacyOperacaoActive: true }]);
  assert.deepEqual(plan.updateIds, []);
  assert.equal(plan.alreadyExplicitTrue, 1);
});

test('operational enablement backfill materializes only missing legacy values', () => {
  const plan = planOperationalEnablementBackfill([
    { id: 'legacy-events', directSalesEnabled: null, plannedOperationsEnabled: null, tapsEnabled: null, inventoryEnabled: null, kitchenEnabled: null, legacyDirectSales: false, legacyPlannedOperations: true, legacyTaps: true, legacyInventory: false, legacyKitchen: false },
    { id: 'explicit', directSalesEnabled: false, plannedOperationsEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: true, legacyDirectSales: true, legacyPlannedOperations: false, legacyTaps: true, legacyInventory: true, legacyKitchen: false },
  ]);
  assert.deepEqual(plan.updates, [{ id: 'legacy-events', directSalesEnabled: false, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false }]);
});

test('operational enablement backfill is idempotent after materialization', () => {
  const plan = planOperationalEnablementBackfill([{
    id: 'materialized', directSalesEnabled: false, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: true,
    legacyDirectSales: true, legacyPlannedOperations: false, legacyTaps: false, legacyInventory: true, legacyKitchen: false,
  }]);
  assert.deepEqual(plan.updates, []);
});
