import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOperationalProfile,
  getOperationalProfile,
  type OperationalProfileFacts,
} from './operational-profile.js';

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

test('legacy CERVEJARIA derives planned operations and taps without a mode', () => {
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
    directSales: false,
    plannedOperations: true,
  });
  assert.equal('mode' in profile, false);
  assert.equal(profile.legacy.quiosqueEnabled, false);
  assert.equal(profile.legacy.exclusivo, null);
});

test('legacy QUIOSQUE derives direct sales, cash, inventory and kitchen from actual POS configuration', () => {
  const profile = deriveOperationalProfile(facts({
    legacyQuiosque: { enabled: true, exclusivo: true, controlaEstoque: true, temCozinha: true },
    activePointsOfSale: 1,
  }));

  assert.deepEqual(profile.capabilities, {
    cashRegister: true,
    inventory: true,
    kitchen: true,
    taps: false,
    directSales: true,
    plannedOperations: false,
  });
  assert.equal(profile.legacy.exclusivo, true);
});

test('legacy HIBRIDA is represented only by a composition of capabilities', () => {
  const profile = deriveOperationalProfile(facts({
    legacyQuiosque: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: true },
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
    directSales: true,
    plannedOperations: true,
  });
  assert.equal('HIBRIDA' in profile, false);
  assert.equal(profile.legacy.exclusivo, false);
});

test('each capability has an independent derivation rule', () => {
  const scenarios: Array<[string, Partial<OperationalProfileFacts>, keyof ReturnType<typeof deriveOperationalProfile>['capabilities']]> = [
    ['cash register', { legacyQuiosque: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: false }, activePointsOfSale: 1 }, 'cashRegister'],
    ['inventory', { legacyQuiosque: { enabled: true, exclusivo: true, controlaEstoque: true, temCozinha: false } }, 'inventory'],
    ['kitchen', { legacyQuiosque: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: true } }, 'kitchen'],
    ['taps', { activeTaps: 1 }, 'taps'],
    ['direct sales', { legacyQuiosque: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: false }, activePointsOfSale: 1 }, 'directSales'],
    ['planned operations', { activeTrailers: 1 }, 'plannedOperations'],
  ];

  for (const [name, overrides, capability] of scenarios) {
    const profile = deriveOperationalProfile(facts(overrides));
    assert.equal(profile.capabilities[capability], true, name);
  }
});

test('inactive quiosque configuration does not advertise POS capabilities', () => {
  const profile = deriveOperationalProfile(facts({
    legacyQuiosque: { enabled: false, exclusivo: false, controlaEstoque: true, temCozinha: true },
    activePointsOfSale: 1,
  }));

  assert.equal(profile.capabilities.cashRegister, false);
  assert.equal(profile.capabilities.directSales, false);
  assert.equal(profile.capabilities.inventory, false);
  assert.equal(profile.capabilities.kitchen, false);
});

test('explicit cash-register settings override legacy fallback per active unit', () => {
  const legacy = { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false };
  assert.equal(deriveOperationalProfile(facts({ legacyQuiosque: legacy, activePointsOfSale: 1, activePointOfSaleCashRegisterSettings: [false] })).capabilities.cashRegister, false);
  assert.equal(deriveOperationalProfile(facts({ legacyQuiosque: legacy, activePointsOfSale: 1, activePointOfSaleCashRegisterSettings: [null] })).capabilities.cashRegister, true);
});

test('cash-register aggregates explicit mixed unit settings without changing direct sales', () => {
  const profile = deriveOperationalProfile(facts({
    legacyQuiosque: { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false },
    activePointsOfSale: 2,
    activePointOfSaleCashRegisterSettings: [true, false],
  }));
  assert.equal(profile.capabilities.cashRegister, true);
  assert.equal(profile.capabilities.directSales, true);
});

test('all explicit false units and no active unit keep cash-register disabled', () => {
  const legacy = { enabled: true, exclusivo: false, controlaEstoque: false, temCozinha: false };
  assert.equal(deriveOperationalProfile(facts({ legacyQuiosque: legacy, activePointsOfSale: 2, activePointOfSaleCashRegisterSettings: [false, false] })).capabilities.cashRegister, false);
  assert.equal(deriveOperationalProfile(facts({ legacyQuiosque: legacy, activePointsOfSale: 0, activePointOfSaleCashRegisterSettings: [] })).capabilities.cashRegister, false);
});

test('reader is tenant-scoped and read-only', async () => {
  const records = new Map<string, OperationalProfileFacts>([
    ['tenant-a', facts({ tenantId: 'tenant-a', activeTrailers: 1 })],
    ['tenant-b', facts({ tenantId: 'tenant-b', activePointsOfSale: 1, legacyQuiosque: { enabled: true, exclusivo: true, controlaEstoque: false, temCozinha: false } })],
  ]);
  const reads: string[] = [];
  const profile = await getOperationalProfile('tenant-a', async (tenantId) => {
    reads.push(tenantId);
    return records.get(tenantId) ?? null;
  });

  assert.deepEqual(reads, ['tenant-a']);
  assert.equal(profile?.operationalUnits.trailers, 1);
  assert.equal(profile?.operationalUnits.pointsOfSale, 0);
  assert.equal(profile?.capabilities.directSales, false);
});

test('missing tenant returns null without a fallback profile', async () => {
  const profile = await getOperationalProfile('missing', async () => null);
  assert.equal(profile, null);
});
