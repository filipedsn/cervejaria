import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregateChopeRanking, withRankingPosicao } from '../src/lib/chope-ranking.ts';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl || !process.env.PDV_QA_PRISMA_CLIENT) throw new Error('Ranking snapshot requires an isolated QA database and pinned client.');
const { PrismaClient } = await import(pathToFileURL(path.join(path.resolve(process.env.PDV_QA_PRISMA_CLIENT), 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
const targets = [
  { label: 'CIA Marítima', id: 'cmr9yis3c0000hvu00q9fe7y1' },
  { label: 'Churrasquinho do Thiago', id: 'cmsry9xrn0000hvlgopjxy0oo' },
];
try {
  const snapshots = [];
  for (const target of targets) {
    const events = await db.evento.findMany({ where: { cervejariaId: target.id, data: { not: null } }, select: { id: true, trailerId: true } });
    const eventIds = events.map((row) => row.id);
    const commands = eventIds.length ? await db.comanda.findMany({ where: { eventoId: { in: eventIds }, tipo: 'COMANDA' }, include: { cliente: { select: { id: true, nome: true, telefone: true } }, itens: { include: { produto: { select: { tipo: true, formato: true } } } } }, orderBy: { id: 'asc' } }) : [];
    const byEvent = events.map((event) => ({ eventId: event.id, ranking: withRankingPosicao(aggregateChopeRanking(commands.filter((command) => command.eventoId === event.id))) }));
    const byTrailer = new Map();
    for (const event of events) {
      const group = byTrailer.get(event.trailerId ?? '') ?? [];
      group.push(...commands.filter((command) => command.eventoId === event.id));
      byTrailer.set(event.trailerId ?? '', group);
    }
    const periods = [...byTrailer].map(([trailerId, rows]) => ({ trailerId, ranking: withRankingPosicao(aggregateChopeRanking(rows)) }));
    snapshots.push({ tenant: target.label, eventCount: events.length, eventRankings: byEvent, trailerPeriodRankings: periods });
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', rankingRule: 'existing aggregateChopeRanking', snapshots })}\n`);
} finally { await db.$disconnect(); }
