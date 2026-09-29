#!/usr/bin/env npx tsx
import { prisma } from '../src/lib/prisma.js';
import { planOperationalEnablementBackfill } from '../src/lib/operational-enablement-backfill.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const tenants = await prisma.cervejaria.findMany({ select: { id: true, configuracaoOperacional: { select: { directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true } }, configuracaoOperacao: { select: { ativo: true, controlaEstoque: true, temCozinha: true } }, pontosVenda: { where: { ativo: true }, select: { id: true } }, trailers: { where: { ativo: true }, select: { id: true } }, taps: { where: { ativo: true }, select: { id: true } } } });
  const plan = planOperationalEnablementBackfill(tenants.map((tenant) => ({
    id: tenant.id, directSalesEnabled: tenant.configuracaoOperacional?.directSalesEnabled ?? null, plannedOperationsEnabled: tenant.configuracaoOperacional?.plannedOperationsEnabled ?? null, tapsEnabled: tenant.configuracaoOperacional?.tapsEnabled ?? null, inventoryEnabled: tenant.configuracaoOperacional?.inventoryEnabled ?? null, kitchenEnabled: tenant.configuracaoOperacional?.kitchenEnabled ?? null,
    legacyDirectSales: tenant.configuracaoOperacao?.ativo === true && tenant.pontosVenda.length > 0, legacyPlannedOperations: tenant.trailers.length > 0, legacyTaps: tenant.taps.length > 0, legacyInventory: tenant.configuracaoOperacao?.ativo === true && tenant.configuracaoOperacao.controlaEstoque, legacyKitchen: tenant.configuracaoOperacao?.ativo === true && tenant.configuracaoOperacao.temCozinha,
  })));
  const alreadyMaterialized = plan.processed - plan.updates.length;
  let updated = 0; let errors = 0;
  if (!dryRun) for (const change of plan.updates) {
    try { await prisma.$transaction(async (tx) => {
      const existing = await tx.configuracaoOperacional.findUnique({ where: { cervejariaId: change.id } });
      if (!existing) { await tx.configuracaoOperacional.create({ data: { cervejariaId: change.id, directSalesEnabled: change.directSalesEnabled ?? null, plannedOperationsEnabled: change.plannedOperationsEnabled ?? null, tapsEnabled: change.tapsEnabled ?? null, inventoryEnabled: change.inventoryEnabled ?? null, kitchenEnabled: change.kitchenEnabled ?? null } }); updated += 1; return; }
      const entries = Object.entries(change).filter(([key]) => key !== 'id');
      const result = await tx.configuracaoOperacional.updateMany({ where: { cervejariaId: change.id, OR: entries.map(([field]) => ({ [field]: null })) }, data: Object.fromEntries(entries) });
      if (result.count > 0) updated += 1;
    }); } catch { errors += 1; }
  }
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'execute', scanned: plan.processed, eligible: plan.updates.length, ...(dryRun ? { wouldUpdate: plan.updates.length } : { updated }), alreadyMaterialized, skipped: alreadyMaterialized, errors }));
  if (errors > 0) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
