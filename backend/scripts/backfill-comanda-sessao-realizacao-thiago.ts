#!/usr/bin/env npx tsx
/**
 * Backfill sessaoCaixaRealizacaoId for orphan CAIXA comandas (Churrasquinho do Thiago).
 * Rule: session containing createdAt; if multiple, shortest duration.
 *
 *   npx tsx scripts/backfill-comanda-sessao-realizacao-thiago.ts
 *   npx tsx scripts/backfill-comanda-sessao-realizacao-thiago.ts --apply
 *
 * DEV only (cervejaria_dev on :5434).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoBackend = path.resolve(here, '..');
for (const line of readFileSync(path.join(repoBackend, '.env.development'), 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const split = trimmed.indexOf('=');
  if (split < 0) continue;
  process.env[trimmed.slice(0, split).trim()] ??= trimmed.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
}

if (!/:5434\/cervejaria_dev(?:\?|$)/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run outside isolated DEV DB (localhost:5434/cervejaria_dev).');
}

const apply = process.argv.includes('--apply');
const TENANT_NAME = 'Churrasquinho do Thiago';
const PERIODS = [
  { label: '2026-09', from: new Date('2026-09-01T03:00:00.000Z'), to: new Date('2026-10-01T03:00:00.000Z') },
  { label: '2026-10', from: new Date('2026-10-01T03:00:00.000Z'), to: new Date('2026-11-01T03:00:00.000Z') },
] as const;

const prisma = new PrismaClient();

function inWindow(abertoEm: Date, fechadoEm: Date | null, at: Date): boolean {
  const open = abertoEm.getTime();
  const close = fechadoEm ? fechadoEm.getTime() : Number.POSITIVE_INFINITY;
  const t = at.getTime();
  return t >= open && t <= close;
}

function durationMs(abertoEm: Date, fechadoEm: Date | null): number {
  return (fechadoEm ?? new Date('9999-01-01')).getTime() - abertoEm.getTime();
}

async function main() {
  const tenant = await prisma.cervejaria.findFirstOrThrow({
    where: { nome: { equals: TENANT_NAME, mode: 'insensitive' } },
    select: { id: true, nome: true },
  });
  const points = await prisma.pontoVenda.findMany({
    where: { cervejariaId: tenant.id },
    select: { id: true },
  });
  const pointIds = points.map((p) => p.id);
  const sessions = await prisma.sessaoCaixaOperacao.findMany({
    where: { cervejariaId: tenant.id, pontoVendaId: { in: pointIds } },
    select: { id: true, pontoVendaId: true, abertoEm: true, fechadoEm: true },
  });

  const summary: Array<{
    period: string;
    orphanCount: number;
    assignable: number;
    unassignable: number;
    updated: number;
    bySession: Record<string, number>;
  }> = [];

  for (const period of PERIODS) {
    const comandas = await prisma.comanda.findMany({
      where: {
        origem: 'CAIXA',
        status: 'FECHADA',
        pontoVendaId: { in: pointIds },
        sessaoCaixaRealizacaoId: null,
        fechadaEm: { gte: period.from, lt: period.to },
      },
      select: {
        id: true,
        createdAt: true,
        pontoVendaId: true,
        pagamentos: { select: { sessaoCaixaId: true, contaReceberId: true } },
      },
    });

    // Dashboard orphans: no sale-payment session either
    const orphans = comandas.filter(
      (c) => !c.pagamentos.some((p) => p.contaReceberId === null && p.sessaoCaixaId !== null),
    );

    const assignments: Array<{ id: string; sessionId: string }> = [];
    let unassignable = 0;
    const bySession: Record<string, number> = {};

    for (const c of orphans) {
      if (!c.pontoVendaId) {
        unassignable += 1;
        continue;
      }
      const covering = sessions
        .filter((s) => s.pontoVendaId === c.pontoVendaId && inWindow(s.abertoEm, s.fechadoEm, c.createdAt))
        .sort((a, b) => durationMs(a.abertoEm, a.fechadoEm) - durationMs(b.abertoEm, b.fechadoEm));
      const chosen = covering[0];
      if (!chosen) {
        unassignable += 1;
        continue;
      }
      assignments.push({ id: c.id, sessionId: chosen.id });
      bySession[chosen.id] = (bySession[chosen.id] ?? 0) + 1;
    }

    let updated = 0;
    if (apply && assignments.length > 0) {
      for (const row of assignments) {
        const result = await prisma.comanda.updateMany({
          where: { id: row.id, sessaoCaixaRealizacaoId: null },
          data: { sessaoCaixaRealizacaoId: row.sessionId },
        });
        updated += result.count;
      }
    }

    summary.push({
      period: period.label,
      orphanCount: orphans.length,
      assignable: assignments.length,
      unassignable,
      updated: apply ? updated : 0,
      bySession,
    });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    tenant: tenant.nome,
    tenantId: tenant.id,
    summary,
  }, null, 2));

  if (!apply) {
    console.error('\nDry-run only. Re-run with --apply to write.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
