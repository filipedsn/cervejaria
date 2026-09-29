import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOperationalProfile, type OperationalProfileFacts } from '../operational-profile.js';
import { hasCatalogAccess, hasComplementaryAccess, hasDirectSalesAccess, hasInventoryAccess, hasKitchenAccess } from './modulo.js';

function facts(overrides: Partial<OperationalProfileFacts> = {}): OperationalProfileFacts {
  return {
    tenantId: 'tenant-a',
    legacyOperacao: null,
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

test('direct-sales guard preserves legacy active-operacao access when an active POS exists', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
  }));

  assert.equal(hasDirectSalesAccess(profile), true);
});

test('direct-sales guard allows the default CAIXA mode', () => {
  assert.equal(hasDirectSalesAccess(deriveOperationalProfile(facts())), true);
  assert.equal(hasDirectSalesAccess(null), false);
});

test('direct-sales guard does not infer access from cash-register capability', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
    activePointOfSaleCashRegisterSettings: [false],
  }));

  assert.equal(profile.capabilities.cashRegister, true);
  assert.equal(hasDirectSalesAccess(profile), true);
});

test('kitchen context derives its global decision from the operational profile', () => {
  const withKitchen = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: true },
    activePointsOfSale: 1,
  }));
  const withoutKitchen = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
  }));

  assert.equal(hasKitchenAccess(withKitchen), true);
  assert.equal(hasKitchenAccess(withoutKitchen), false);
});

test('inventory context derives its global decision from the operational profile', () => {
  const withInventory = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: true, temCozinha: false },
    activePointsOfSale: 1,
  }));
  const withoutInventory = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
  }));

  assert.equal(hasInventoryAccess(withInventory), true);
  assert.equal(hasInventoryAccess(withoutInventory), false);
});

test('catalog access is independent of CAIXA/EVENTO mode but requires a tenant profile', () => {
  const caixa = deriveOperationalProfile(facts({
    operationalEnablement: { plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false },
  }));
  const evento = deriveOperationalProfile(facts({
    operationalEnablement: { plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false },
  }));

  assert.equal(caixa.operationMode, 'CAIXA');
  assert.equal(evento.operationMode, 'EVENTO');
  assert.equal(hasCatalogAccess(caixa), true);
  assert.equal(hasCatalogAccess(evento), true);
  assert.equal(hasComplementaryAccess(evento), false);
  assert.equal(hasCatalogAccess(null), false);
});
