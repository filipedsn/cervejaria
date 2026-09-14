import assert from 'node:assert/strict';
import test from 'node:test';
import { getOperationalProfile } from './operational-profile.js';

// Golden assertions rely on the refreshed DEV dump and its named tenants. CI
// supplies a separate ephemeral database, so it must opt in explicitly.
const hasDevDatabase = process.env.RUN_DEV_GOLDEN_PROFILE_TESTS === '1';

test('CIA Maritima DEV golden profile reflects its actual event/tap-only operation', { skip: !hasDevDatabase }, async () => {
  const { prisma } = await import('./prisma.js');
  const tenant = await prisma.cervejaria.findUnique({
    where: { slug: 'cia-maritima' },
    select: { id: true },
  });
  assert.ok(tenant, 'CIA Maritima tenant must exist in the refreshed DEV dump');

  const profile = await getOperationalProfile(tenant.id);
  assert.ok(profile);
  assert.deepEqual(profile.capabilities, {
    plannedOperations: true,
    taps: true,
    directSales: false,
    cashRegister: false,
    inventory: false,
    kitchen: false,
  });
  assert.equal(profile.operationalUnits.trailers, 1);
  assert.equal(profile.operationalUnits.pointsOfSale, 0);
  assert.equal(profile.legacy.quiosqueEnabled, false);

  // DEV contains active POS units for dedicated QA tenants. CIA Maritima's
  // profile must not inherit them through an unscoped aggregate query.
  const activePointsInOtherTenantContexts = await prisma.pontoVenda.count({
    where: { ativo: true },
  });
  assert.ok(activePointsInOtherTenantContexts > 0);
  assert.equal(profile.operationalUnits.pointsOfSale, 0);
});

test('DEV QA capability matrix derives legacy combinations without modes', { skip: !hasDevDatabase }, async () => {
  const cases = [
    ['qa-cfg-quiosque-00', { directSales: true, cashRegister: true, inventory: false, kitchen: false, plannedOperations: false, taps: false }],
    ['qa-cfg-quiosque-10', { directSales: true, cashRegister: true, inventory: true, kitchen: false, plannedOperations: false, taps: false }],
    ['qa-cfg-quiosque-01', { directSales: true, cashRegister: true, inventory: false, kitchen: true, plannedOperations: false, taps: false }],
    ['qa-cfg-quiosque-11', { directSales: true, cashRegister: true, inventory: true, kitchen: true, plannedOperations: false, taps: false }],
    ['qa-cfg-hibrida-00', { directSales: true, cashRegister: true, inventory: false, kitchen: false, plannedOperations: true, taps: true }],
  ] as const;
  const { prisma } = await import('./prisma.js');

  for (const [slug, capabilities] of cases) {
    const tenant = await prisma.cervejaria.findUnique({ where: { slug }, select: { id: true } });
    assert.ok(tenant, `${slug} fixture must exist in DEV`);
    const profile = await getOperationalProfile(tenant.id);
    assert.ok(profile);
    assert.deepEqual(profile.capabilities, capabilities, slug);
  }
});
