import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOperationalProfile,
  getOperationalProfile,
  shouldExposeEstablishmentSurface,
  type OperationalProfileFacts,
} from './operational-profile.js';

test('explicit cash mode exposes setup without a POS; legacy data alone does not', () => {
  assert.equal(shouldExposeEstablishmentSurface({ cashMode: false, cashRegister: false, inventory: false, kitchen: false }), false);
  assert.equal(shouldExposeEstablishmentSurface({ cashMode: true, cashRegister: false, inventory: false, kitchen: false }), true);
  assert.equal(shouldExposeEstablishmentSurface({ cashMode: false, cashRegister: true, inventory: false, kitchen: false }), true);
  assert.equal(shouldExposeEstablishmentSurface({ cashMode: false, cashRegister: false, inventory: true, kitchen: false }), true);
  assert.equal(shouldExposeEstablishmentSurface({ cashMode: false, cashRegister: false, inventory: false, kitchen: true }), true);
});

function facts(overrides: Partial<OperationalProfileFacts> = {}): OperationalProfileFacts {
  return {
    tenantId: 'tenant-a',
    legacyOperacao: null,
    activeTrailers: 0,
    activePointsOfSale: 0,
    activePointOfSaleCashRegisterSettings: [],
    operationalEnablement: null,
    activeTaps: 0,
    plannedOperationCount: 0,
    openPlannedOperationCount: 0,
    openCashRegisterCount: 0,
    ...overrides,
  };
}

test('mode derives only from plannedOperationsEnabled and taps remain independent', () => {
  const profile = deriveOperationalProfile(facts({
    activeTrailers: 1,
    activeTaps: 3,
    plannedOperationCount: 5,
    openPlannedOperationCount: 1,
  }));

  assert.deepEqual(profile.capabilities, {
    cashRegister: false,
    inventory: false,
    kitchen: false,
    taps: true,
    cashMode: true,
    plannedOperations: false,
  });
  assert.equal('mode' in profile, false);
  assert.equal(profile.legacy.operacaoEnabled, false);
  assert.equal(profile.legacy.exclusivo, null);
});

test('legacy QUIOSQUE derives direct sales, cash, inventory and kitchen from actual POS configuration', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: true, controlaEstoque: true, temCozinha: true },
    activePointsOfSale: 1,
  }));

  assert.deepEqual(profile.capabilities, {
    cashRegister: true,
    inventory: true,
    kitchen: true,
    taps: false,
    cashMode: true,
    plannedOperations: false,
  });
  assert.equal(profile.legacy.exclusivo, true);
});

test('mixed physical resources do not override the persisted operational mode', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: true },
    activeTrailers: 1,
    activePointsOfSale: 1,
    activeTaps: 1,
    plannedOperationCount: 2,
  }));

  assert.deepEqual(profile.capabilities, {
    cashRegister: true,
    inventory: false,
    kitchen: true,
    taps: true,
    cashMode: true,
    plannedOperations: false,
  });
  assert.equal(profile.operationMode, 'CAIXA');
  assert.equal(profile.legacy.exclusivo, false);
});

test('each capability has an independent derivation rule', () => {
  const scenarios: Array<[string, Partial<OperationalProfileFacts>, keyof ReturnType<typeof deriveOperationalProfile>['capabilities']]> = [
    ['cash register', { legacyOperacao: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: false }, activePointsOfSale: 1 }, 'cashRegister'],
    ['inventory', { legacyOperacao: { enabled: true, exclusivo: true, controlaEstoque: true, temCozinha: false } }, 'inventory'],
    ['kitchen', { legacyOperacao: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: true } }, 'kitchen'],
    ['taps', { activeTaps: 1 }, 'taps'],
    ['cash mode', { activePointsOfSale: 1, operationalEnablement: { plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false } }, 'cashMode'],
    ['planned operations', { operationalEnablement: { plannedOperationsEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false } }, 'plannedOperations'],
  ];

  for (const [name, overrides, capability] of scenarios) {
    const profile = deriveOperationalProfile(facts(overrides));
    assert.equal(profile.capabilities[capability], true, name);
  }
});

test('explicit operational enablement wins over legacy resource fallback', () => {
  const legacy = facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
    activeTrailers: 1,
    activeTaps: 1,
    operationalEnablement: {
      plannedOperationsEnabled: false,
      tapsEnabled: false,
      inventoryEnabled: false,
      kitchenEnabled: false,
    },
  });
  const profile = deriveOperationalProfile(legacy);
  assert.equal(profile.capabilities.cashMode, true);
  assert.equal(profile.capabilities.plannedOperations, false);
  assert.equal(profile.capabilities.taps, false);
});

test('NULL operational enablement preserves legacy fallback independently', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 1,
    activeTrailers: 1,
    activeTaps: 1,
    operationalEnablement: {
      plannedOperationsEnabled: null,
      tapsEnabled: null,
      inventoryEnabled: null,
      kitchenEnabled: null,
    },
  }));
  assert.equal(profile.capabilities.cashMode, true);
  assert.equal(profile.capabilities.plannedOperations, false);
  assert.equal(profile.capabilities.taps, true);
});

test('a new tenant can enable operations before physical resources exist', () => {
  const profile = deriveOperationalProfile(facts({
    operationalEnablement: {
      plannedOperationsEnabled: true,
      tapsEnabled: true,
      inventoryEnabled: null,
      kitchenEnabled: null,
    },
  }));
  assert.equal(profile.capabilities.cashMode, false);
  assert.equal(profile.capabilities.plannedOperations, true);
  assert.equal(profile.capabilities.taps, true);
  assert.equal(profile.operationalUnits.pointsOfSale, 0);
  assert.equal(profile.operationalUnits.trailers, 0);
});

test('inventory and kitchen explicit enablement works without ConfiguracaoOperacao', () => {
  const profile = deriveOperationalProfile(facts({
    operationalEnablement: {
      plannedOperationsEnabled: true,
      tapsEnabled: false,
      inventoryEnabled: true,
      kitchenEnabled: true,
    },
  }));

  assert.equal(profile.capabilities.cashMode, false);
  assert.equal(profile.capabilities.plannedOperations, true);
  assert.equal(profile.capabilities.inventory, true);
  assert.equal(profile.capabilities.kitchen, true);
  assert.equal(profile.legacy.operacaoEnabled, false);
});

test('explicit inventory and kitchen false win over enabled legacy configuration', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: true, temCozinha: true },
    operationalEnablement: {
      plannedOperationsEnabled: null,
      tapsEnabled: null,
      inventoryEnabled: false,
      kitchenEnabled: false,
    },
  }));

  assert.equal(profile.capabilities.inventory, false);
  assert.equal(profile.capabilities.kitchen, false);
});

test('NULL inventory and kitchen preserve each legacy fallback independently', () => {
  const inventoryProfile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: true, temCozinha: false },
    operationalEnablement: {
      plannedOperationsEnabled: null,
      tapsEnabled: null,
      inventoryEnabled: null,
      kitchenEnabled: null,
    },
  }));
  const kitchenProfile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: true },
    operationalEnablement: {
      plannedOperationsEnabled: null,
      tapsEnabled: null,
      inventoryEnabled: null,
      kitchenEnabled: null,
    },
  }));

  assert.equal(inventoryProfile.capabilities.inventory, true);
  assert.equal(inventoryProfile.capabilities.kitchen, false);
  assert.equal(kitchenProfile.capabilities.inventory, false);
  assert.equal(kitchenProfile.capabilities.kitchen, true);
});

test('cash mode does not imply a usable POS without a cash-register unit', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: false, exclusivo: false, controlaEstoque: true, temCozinha: true },
    activePointsOfSale: 1,
  }));

  assert.equal(profile.capabilities.cashRegister, true);
  assert.equal(profile.capabilities.cashMode, true);
  assert.equal(profile.capabilities.inventory, false);
  assert.equal(profile.capabilities.kitchen, false);
});

test('explicit cash-register settings override legacy fallback per active unit', () => {
  const legacy = { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false };
  assert.equal(deriveOperationalProfile(facts({ legacyOperacao: legacy, activePointsOfSale: 1, activePointOfSaleCashRegisterSettings: [false] })).capabilities.cashRegister, true);
  assert.equal(deriveOperationalProfile(facts({ legacyOperacao: legacy, activePointsOfSale: 1, activePointOfSaleCashRegisterSettings: [null] })).capabilities.cashRegister, true);
});

test('cash-register aggregates explicit mixed unit settings without changing direct sales', () => {
  const profile = deriveOperationalProfile(facts({
    legacyOperacao: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 2,
    activePointOfSaleCashRegisterSettings: [true, false],
  }));
  assert.equal(profile.capabilities.cashRegister, true);
  assert.equal(profile.capabilities.cashMode, true);
});

test('all explicit false units and no active unit keep cash-register disabled', () => {
  const legacy = { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false };
  assert.equal(deriveOperationalProfile(facts({ legacyOperacao: legacy, activePointsOfSale: 2, activePointOfSaleCashRegisterSettings: [false, false] })).capabilities.cashRegister, true);
  assert.equal(deriveOperationalProfile(facts({ legacyOperacao: legacy, activePointsOfSale: 0, activePointOfSaleCashRegisterSettings: [] })).capabilities.cashRegister, false);
});

test('reader is tenant-scoped and read-only', async () => {
  const records = new Map<string, OperationalProfileFacts>([
    ['tenant-a', facts({ tenantId: 'tenant-a', activeTrailers: 1, operationalEnablement: { plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false } })],
    ['tenant-b', facts({ tenantId: 'tenant-b', activePointsOfSale: 1, legacyOperacao: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: false }, operationalEnablement: { plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true } })],
  ]);
  const reads: string[] = [];
  const profile = await getOperationalProfile('tenant-a', async (tenantId) => {
    reads.push(tenantId);
    return records.get(tenantId) ?? null;
  });

  assert.deepEqual(reads, ['tenant-a']);
  assert.equal(profile?.operationalUnits.trailers, 1);
  assert.equal(profile?.operationalUnits.pointsOfSale, 0);
  assert.equal(profile?.capabilities.cashMode, true);
  assert.equal(profile?.capabilities.plannedOperations, false);
  assert.equal(profile?.capabilities.taps, false);
});

test('missing tenant returns null without a fallback profile', async () => {
  const profile = await getOperationalProfile('missing', async () => null);
  assert.equal(profile, null);
});
