import assert from 'node:assert/strict';
import test from 'node:test';
import { getOperationalProfile } from './operational-profile.js';

// Golden assertions rely on the refreshed DEV dump and its named tenants. CI
// supplies a separate ephemeral database, so it must opt in explicitly.
const hasDevDatabase = process.env.RUN_DEV_GOLDEN_PROFILE_TESTS === '1';

test('CIA Maritima DEV compatibility smoke keeps persisted configuration consistent', { skip: !hasDevDatabase }, async () => {
  const { prisma } = await import('./prisma.js');
  const tenant = await prisma.cervejaria.findUnique({
    where: { slug: 'cia-maritima' },
    select: {
      id: true,
      configuracaoOperacional: {
        select: {
          directSalesEnabled: true,
          plannedOperationsEnabled: true,
          tapsEnabled: true,
          inventoryEnabled: true,
          kitchenEnabled: true,
        },
      },
    },
  });
  assert.ok(tenant, 'CIA Maritima tenant must exist in the refreshed DEV dump');

  const profile = await getOperationalProfile(tenant.id);
  assert.ok(profile);
  const persisted = tenant.configuracaoOperacional;
  assert.ok(persisted, 'CIA Maritima must have explicit operational configuration');
  assert.equal(profile.capabilities.plannedOperations, persisted.plannedOperationsEnabled === true);
  assert.equal(profile.capabilities.cashMode, persisted.directSalesEnabled === true);
  assert.equal(profile.capabilities.taps, persisted.tapsEnabled === true);
  assert.equal(profile.capabilities.inventory, persisted.inventoryEnabled === true);
  assert.equal(profile.capabilities.kitchen, persisted.kitchenEnabled === true);
  assert.equal(profile.operationMode, persisted.plannedOperationsEnabled === true ? 'EVENTO' : 'CAIXA');
  assert.equal(profile.legacy.operacaoEnabled, false);
  assert.equal(profile.capabilities.cashRegister, false);

  // DEV contains active POS units for dedicated QA tenants. CIA Maritima's
  // profile must not inherit them through an unscoped aggregate query.
  const activePointsInOtherTenantContexts = await prisma.pontoVenda.count({
    where: { ativo: true },
  });
  assert.ok(activePointsInOtherTenantContexts > 0);
  assert.equal(profile.operationalUnits.pointsOfSale, 0);
  assert.equal(profile.operationalUnits.trailers, await prisma.trailer.count({ where: { cervejariaId: tenant.id, ativo: true } }));
});

test('DEV QA capability matrix derives legacy combinations without modes', { skip: !hasDevDatabase }, async () => {
  const cases = [
    ['qa-cfg-operacao-00', { cashMode: true, cashRegister: true, inventory: false, kitchen: false, plannedOperations: false, taps: false }],
    ['qa-cfg-operacao-10', { cashMode: true, cashRegister: true, inventory: true, kitchen: false, plannedOperations: false, taps: false }],
    ['qa-cfg-operacao-01', { cashMode: true, cashRegister: true, inventory: false, kitchen: true, plannedOperations: false, taps: false }],
    ['qa-cfg-operacao-11', { cashMode: true, cashRegister: true, inventory: true, kitchen: true, plannedOperations: false, taps: false }],
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
