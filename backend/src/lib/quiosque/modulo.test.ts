import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOperationalProfile, type OperationalProfileFacts } from '../operational-profile.js';
import { hasDirectSalesAccess } from './modulo.js';

function facts(overrides: Partial<OperationalProfileFacts> = {}): OperationalProfileFacts {
  return {
    tenantId: 'tenant-a',
    legacyQuiosque: null,
    activeTrailers: 0,
    activePointsOfSale: 0,
    activePointOfSaleCashRegisterSettings: [],
    activeTaps: 0,
    plannedOperationCount: 0,
    openPlannedOperationCount: 0,
    openCashRegisterCount: 0,
    ...overrides,
  };
}

test('direct-sales guard preserves legacy active-quiosque access when an active POS exists', () => {
  const profile = deriveOperationalProfile(facts({
    legacyQuiosque: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
  }));

  assert.equal(hasDirectSalesAccess(profile), true);
});

test('direct-sales guard hides the module when the capability is absent', () => {
  assert.equal(hasDirectSalesAccess(deriveOperationalProfile(facts())), false);
  assert.equal(hasDirectSalesAccess(null), false);
});

test('direct-sales guard does not infer access from cash-register capability', () => {
  const profile = deriveOperationalProfile(facts({
    legacyQuiosque: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
    activePointOfSaleCashRegisterSettings: [false],
  }));

  assert.equal(profile.capabilities.cashRegister, false);
  assert.equal(hasDirectSalesAccess(profile), true);
});
