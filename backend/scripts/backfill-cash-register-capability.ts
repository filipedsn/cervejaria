#!/usr/bin/env npx tsx
import { prisma } from '../src/lib/prisma.js';
import { planCashRegisterBackfill } from '../src/lib/cash-register-backfill.js';
const dryRun = process.argv.includes('--dry-run');
async function main() {
  const units = await prisma.pontoVenda.findMany({ select: { id: true, usaCaixa: true, cervejaria: { select: { configuracaoQuiosque: { select: { ativo: true } } } } } });
  const plan = planCashRegisterBackfill(units.map((unit) => ({ id: unit.id, usaCaixa: unit.usaCaixa, legacyQuiosqueActive: unit.cervejaria.configuracaoQuiosque?.ativo === true })));
  let updated = 0; let errors = 0;
  if (!dryRun) for (const id of plan.updateIds) try { updated += (await prisma.pontoVenda.updateMany({ where: { id, usaCaixa: null }, data: { usaCaixa: true } })).count; } catch { errors += 1; }
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'execute', scanned: plan.processed, eligible: plan.updateIds.length, ...(dryRun ? { wouldUpdate: plan.updateIds.length } : { updated }), alreadyMaterialized: plan.alreadyExplicitTrue + plan.alreadyExplicitFalse, fallbackRequired: plan.fallbackRequired, skipped: plan.skipped, errors }));
  if (errors > 0) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
