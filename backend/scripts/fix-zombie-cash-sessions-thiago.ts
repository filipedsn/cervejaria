#!/usr/bin/env npx tsx
/**
 * Shorten fechadoEm of administratively closed cash sessions (> 24h) for
 * Churrasquinho do Thiago to the last real event of the turn.
 *
 * Last useful event = max(linked comanda fechadaEm, payment pagoEm on the session,
 * movement createdAt). Without events: 06:00 America/Sao_Paulo of the day after
 * diaOperacional. Applied only when earlier than the current fechadoEm and the
 * next session opening on the same point.
 *
 *   npx tsx scripts/fix-zombie-cash-sessions-thiago.ts
 *   npx tsx scripts/fix-zombie-cash-sessions-thiago.ts --apply
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
const MAX_HOURS = 24;
/** America/Sao_Paulo is UTC-3 (no DST); 06:00 local = 09:00Z. */
const CEILING_UTC_HOUR = 9;

const prisma = new PrismaClient();

const hours = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
const maxDate = (dates: Array<Date | null | undefined>) =>
  dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);

function ceilingFor(diaOperacional: Date): Date {
  const next = new Date(diaOperacional);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(CEILING_UTC_HOUR, 0, 0, 0);
  return next;
}

async function main() {
  const tenant = await prisma.cervejaria.findFirstOrThrow({
    where: { nome: { equals: TENANT_NAME, mode: 'insensitive' } },
    select: { id: true, nome: true },
  });
  const sessions = await prisma.sessaoCaixaOperacao.findMany({
    where: { cervejariaId: tenant.id },
    select: {
      id: true, pontoVendaId: true, diaOperacional: true, status: true, abertoEm: true,
      fechadoEm: true, tipoEncerramento: true, observacaoFechamento: true,
    },
    orderBy: { abertoEm: 'asc' },
  });

  const zombies = sessions.filter((s) =>
    s.status === 'FECHADO'
    && s.tipoEncerramento === 'ADMINISTRATIVO'
    && s.fechadoEm
    && hours(s.abertoEm, s.fechadoEm) > MAX_HOURS);

  const results = [];
  for (const z of zombies) {
    const oldClose = z.fechadoEm!;
    const [linked, payments, movements] = await Promise.all([
      prisma.comanda.findMany({
        where: { sessaoCaixaRealizacaoId: z.id },
        select: { id: true, createdAt: true, fechadaEm: true },
      }),
      prisma.pagamento.findMany({ where: { sessaoCaixaId: z.id }, select: { pagoEm: true } }),
      prisma.movimentoCaixaOperacao.findMany({ where: { sessaoId: z.id }, select: { createdAt: true } }),
    ]);

    const lastEvent = maxDate([
      ...linked.map((c) => c.fechadaEm ?? c.createdAt),
      ...payments.map((p) => p.pagoEm),
      ...movements.map((m) => m.createdAt),
    ]);
    const newClose = lastEvent ?? ceilingFor(z.diaOperacional);
    const nextSession = sessions.find((s) => s.pontoVendaId === z.pontoVendaId && s.abertoEm > z.abertoEm && s.id !== z.id) ?? null;

    const skipReasons: string[] = [];
    if (newClose >= oldClose) skipReasons.push('novo fechadoEm não é anterior ao atual');
    if (nextSession && newClose >= nextSession.abertoEm) skipReasons.push('novo fechadoEm não é anterior à próxima abertura');
    if (newClose < z.abertoEm) skipReasons.push('novo fechadoEm é anterior à abertura');

    const outsideByTime = await prisma.comanda.findMany({
      where: {
        pontoVendaId: z.pontoVendaId,
        status: 'FECHADA',
        fechadaEm: { gt: newClose, lte: oldClose },
      },
      select: { sessaoCaixaRealizacaoId: true },
    });
    const outsideBySession: Record<string, number> = {};
    for (const c of outsideByTime) {
      const key = c.sessaoCaixaRealizacaoId ?? 'SEM_VINCULO';
      outsideBySession[key] = (outsideBySession[key] ?? 0) + 1;
    }

    const nota = `fechadoEm ajustado de ${oldClose.toISOString()} para ${newClose.toISOString()} (higiene histórica)`;
    let updated = 0;
    if (apply && skipReasons.length === 0) {
      const observacaoFechamento = z.observacaoFechamento ? `${z.observacaoFechamento} | ${nota}` : nota;
      const result = await prisma.sessaoCaixaOperacao.updateMany({
        where: { id: z.id, fechadoEm: oldClose },
        data: { fechadoEm: newClose, observacaoFechamento },
      });
      updated = result.count;
    }

    results.push({
      id: z.id,
      diaOperacional: z.diaOperacional.toISOString().slice(0, 10),
      abertoEm: z.abertoEm.toISOString(),
      fechadoEmAtual: oldClose.toISOString(),
      fechadoEmNovo: newClose.toISOString(),
      origemNovo: lastEvent ? 'ULTIMO_EVENTO' : 'TETO_06H',
      horasAntes: hours(z.abertoEm, oldClose),
      horasDepois: hours(z.abertoEm, newClose),
      eventosNaNovaJanela: { comandas: linked.length, pagamentos: payments.length, movimentos: movements.length },
      proximaAbertura: nextSession ? { id: nextSession.id, abertoEm: nextSession.abertoEm.toISOString() } : null,
      comandasForaDaNovaJanelaPorHorario: { total: outsideByTime.length, porSessaoVinculada: outsideBySession },
      skipReasons,
      updated,
    });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    tenant: tenant.nome,
    zombieIds: zombies.map((z) => z.id),
    results,
  }, null, 2));

  if (!apply) console.error('\nDry-run only. Re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
