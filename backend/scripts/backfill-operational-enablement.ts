#!/usr/bin/env npx tsx
import { prisma } from '../src/lib/prisma.js';
import { planOperationalEnablementBackfill } from '../src/lib/operational-enablement-backfill.js';

async function main() {
  const tenants = await prisma.cervejaria.findMany({
    select: {
      id: true,
      configuracaoOperacional: { select: { directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true } },
      configuracaoQuiosque: { select: { ativo: true } },
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
    legacyDirectSales: tenant.configuracaoQuiosque?.ativo === true && tenant.pontosVenda.length > 0,
    legacyPlannedOperations: tenant.trailers.length > 0,
    legacyTaps: tenant.taps.length > 0,
  })));
  const existingConfigurationIds = new Set(
    tenants.filter((tenant) => tenant.configuracaoOperacional).map((tenant) => tenant.id),
  );
  let updated = 0;
  let errors = 0;
  for (const change of plan.updates) {
    try {
      if (!existingConfigurationIds.has(change.id)) {
        await prisma.configuracaoOperacional.create({
          data: { cervejariaId: change.id, directSalesEnabled: change.directSalesEnabled ?? null, plannedOperationsEnabled: change.plannedOperationsEnabled ?? null, tapsEnabled: change.tapsEnabled ?? null },
        });
        updated += ['directSalesEnabled', 'plannedOperationsEnabled', 'tapsEnabled']
          .filter((field) => change[field as keyof typeof change] !== undefined).length;
        continue;
      }
      for (const field of ['directSalesEnabled', 'plannedOperationsEnabled', 'tapsEnabled'] as const) {
        if (change[field] === undefined) continue;
        const result = await prisma.configuracaoOperacional.updateMany({
          where: { cervejariaId: change.id, [field]: null },
          data: { [field]: change[field] },
        });
        updated += result.count;
      }
    } catch { errors += 1; }
  }
  console.log(JSON.stringify({ processed: plan.processed, updated, errors }));
  if (errors > 0) process.exitCode = 1;
}

main().catch(() => { process.exitCode = 1; }).finally(() => prisma.$disconnect());
