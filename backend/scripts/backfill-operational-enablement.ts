#!/usr/bin/env npx tsx
import { prisma } from '../src/lib/prisma.js';
import { planOperationalEnablementBackfill } from '../src/lib/operational-enablement-backfill.js';

async function main() {
  const tenants = await prisma.cervejaria.findMany({
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
      configuracaoQuiosque: { select: { ativo: true, controlaEstoque: true, temCozinha: true } },
      pontosVenda: { where: { ativo: true }, select: { id: true } },
      trailers: { where: { ativo: true }, select: { id: true } },
      taps: { where: { ativo: true }, select: { id: true } },
    },
  });
  const plan = planOperationalEnablementBackfill(tenants.map((tenant) => ({
    id: tenant.id,
    directSalesEnabled: tenant.configuracaoOperacional?.directSalesEnabled ?? null,
    plannedOperationsEnabled: tenant.configuracaoOperacional?.plannedOperationsEnabled ?? null,
    tapsEnabled: tenant.configuracaoOperacional?.tapsEnabled ?? null,
    inventoryEnabled: tenant.configuracaoOperacional?.inventoryEnabled ?? null,
    kitchenEnabled: tenant.configuracaoOperacional?.kitchenEnabled ?? null,
    legacyDirectSales: tenant.configuracaoQuiosque?.ativo === true && tenant.pontosVenda.length > 0,
    legacyPlannedOperations: tenant.trailers.length > 0,
    legacyTaps: tenant.taps.length > 0,
    legacyInventory: tenant.configuracaoQuiosque?.ativo === true && tenant.configuracaoQuiosque.controlaEstoque,
    legacyKitchen: tenant.configuracaoQuiosque?.ativo === true && tenant.configuracaoQuiosque.temCozinha,
  })));
  const existingConfigurationIds = new Set(
    tenants.filter((tenant) => tenant.configuracaoOperacional).map((tenant) => tenant.id),
  );
  let updatedInventory = 0;
  let updatedKitchen = 0;
  let skipped = 0;
  let errors = 0;
  for (const change of plan.updates) {
    try {
      if (!existingConfigurationIds.has(change.id)) {
        await prisma.configuracaoOperacional.create({
          data: {
            cervejariaId: change.id,
            directSalesEnabled: change.directSalesEnabled ?? null,
            plannedOperationsEnabled: change.plannedOperationsEnabled ?? null,
            tapsEnabled: change.tapsEnabled ?? null,
            inventoryEnabled: change.inventoryEnabled ?? null,
            kitchenEnabled: change.kitchenEnabled ?? null,
          },
        });
        if (change.inventoryEnabled !== undefined) updatedInventory += 1;
        if (change.kitchenEnabled !== undefined) updatedKitchen += 1;
        continue;
      }
      for (const field of ['directSalesEnabled', 'plannedOperationsEnabled', 'tapsEnabled', 'inventoryEnabled', 'kitchenEnabled'] as const) {
        if (change[field] === undefined) continue;
        const result = await prisma.configuracaoOperacional.updateMany({
          where: { cervejariaId: change.id, [field]: null },
          data: { [field]: change[field] },
        });
        if (field === 'inventoryEnabled') updatedInventory += result.count;
        if (field === 'kitchenEnabled') updatedKitchen += result.count;
      }
    } catch { errors += 1; }
  }
  skipped = plan.processed - plan.updates.filter(
    (change) => change.inventoryEnabled !== undefined || change.kitchenEnabled !== undefined,
  ).length;
  console.log(JSON.stringify({ processed: plan.processed, updatedInventory, updatedKitchen, skipped, errors }));
  if (errors > 0) process.exitCode = 1;
}

main().catch(() => { process.exitCode = 1; }).finally(() => prisma.$disconnect());
