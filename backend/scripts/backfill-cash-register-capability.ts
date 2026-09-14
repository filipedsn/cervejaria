#!/usr/bin/env npx tsx
import { prisma } from '../src/lib/prisma.js';
import { planCashRegisterBackfill } from '../src/lib/cash-register-backfill.js';

async function main() {
  const units = await prisma.pontoVenda.findMany({ select: { id: true, usaCaixa: true, cervejaria: { select: { configuracaoQuiosque: { select: { ativo: true } } } } } });
  const plan = planCashRegisterBackfill(units.map((unit) => ({ id: unit.id, usaCaixa: unit.usaCaixa, legacyQuiosqueActive: unit.cervejaria.configuracaoQuiosque?.ativo === true })));
  let updated = 0;
  let errors = 0;
  for (const id of plan.updateIds) {
    try {
      const result = await prisma.pontoVenda.updateMany({ where: { id, usaCaixa: null }, data: { usaCaixa: true } });
      updated += result.count;
    } catch { errors += 1; }
  }
  console.log(JSON.stringify({ processed: plan.processed, updated, alreadyExplicitTrue: plan.alreadyExplicitTrue, alreadyExplicitFalse: plan.alreadyExplicitFalse, skipped: plan.skipped, errors }));
  if (errors > 0) process.exitCode = 1;
}

main().catch(() => { process.exitCode = 1; }).finally(() => prisma.$disconnect());
