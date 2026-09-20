#!/usr/bin/env npx tsx
import { prisma } from '../src/lib/prisma.js';
import { reconcileMaterialization } from '../src/lib/materialization-reconciliation.js';
async function main() {
  const [establishmentsTotal, operationalConfigTotal, operationalModeMaterialized, operationalModeUnmaterialized, activePdvTotal, pdvCashCapabilityExplicit, pdvCashFallbackRequired] = await Promise.all([
    prisma.cervejaria.count(), prisma.configuracaoOperacional.count(), prisma.configuracaoOperacional.count({ where: { plannedOperationsEnabled: { not: null } } }), prisma.cervejaria.count({ where: { OR: [{ configuracaoOperacional: null }, { configuracaoOperacional: { plannedOperationsEnabled: null } }] } }), prisma.pontoVenda.count({ where: { ativo: true } }), prisma.pontoVenda.count({ where: { ativo: true, usaCaixa: { not: null } } }), prisma.pontoVenda.count({ where: { ativo: true, usaCaixa: null, cervejaria: { configuracaoQuiosque: { ativo: true } } } }),
  ]);
  const result = reconcileMaterialization({ establishmentsTotal, operationalConfigTotal, operationalModeMaterialized, operationalModeUnmaterialized, activePdvTotal, pdvCashCapabilityExplicit, pdvCashFallbackRequired });
  console.log(JSON.stringify(result)); if (!result.pass) process.exitCode = 2;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
