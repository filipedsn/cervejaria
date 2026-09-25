import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyFallbackRecorder } from './legacy-fallback.js';
import { deriveOperationalProfile } from './operational-profile.js';

const facts = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'tenant', legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
  activeTrailers: 0, activePointsOfSale: 1, activePointOfSaleCashRegisterSettings: [true],
  operationalEnablement: { directSalesEnabled: true, plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false },
  activeTaps: 0, plannedOperationCount: 0, openPlannedOperationCount: 0, openCashRegisterCount: 0, ...overrides,
});

test('current materialized path does not increment legacy fallback counter', () => {
  const hits: string[] = [];
  deriveOperationalProfile(facts(), createLegacyFallbackRecorder((_value, attrs) => hits.push(attrs.kind)));
  assert.deepEqual(hits, []);
});

test('legacy operational and cash fallbacks increment exactly once per decision', () => {
  const hits: string[] = [];
  deriveOperationalProfile(facts({ operationalEnablement: { directSalesEnabled: null, plannedOperationsEnabled: null, tapsEnabled: null, inventoryEnabled: null, kitchenEnabled: null }, activePointOfSaleCashRegisterSettings: [null] }), createLegacyFallbackRecorder((_value, attrs) => hits.push(attrs.kind)));
  assert.deepEqual(hits, ['operational_config']);
});
