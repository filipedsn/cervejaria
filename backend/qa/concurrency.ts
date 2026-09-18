import { prisma } from '../src/lib/prisma.js';
import { api, chopeItemBody, percentile } from './lib/http.js';
import { assertQaEnvironment } from './lib/guard.js';
import { cleanupConcurrencyArena, seedArena } from './lib/seed.js';
import { CONCURRENCY_PATH, writeJson } from './lib/store.js';
import type { ConcurrencyRun } from './lib/types.js';

const ramps = (process.env.QA_CONCURRENCY_RAMPS ?? '1,5,10,20,40,80,120,180').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
const requestTimeoutMs = Number(process.env.QA_CONCURRENCY_REQUEST_TIMEOUT_MS ?? 30_000);

async function execute(scenario: ConcurrencyRun['scenario'], concurrency: number): Promise<ConcurrencyRun> {
  const runId = `${scenario === 'same-comanda' ? 'same' : 'independent'}-${concurrency}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arena = await seedArena(runId, scenario === 'independent-comandas' ? concurrency : 1);
  const comandaIds = arena.comandaIds ?? [arena.comandaId];
  const startedAt = new Date().toISOString();
  const clock = performance.now();
  try {
    const replies = await Promise.all(Array.from({ length: concurrency }, (_, index) => api(
      'POST', `/api/comandas/${scenario === 'same-comanda' ? arena.comandaId : comandaIds[index]}/itens`, {
        token: arena.atendenteTokens[index % arena.atendenteTokens.length], body: chopeItemBody(arena.produtoId, arena.tapId, arena.volumeMl), timeoutMs: requestTimeoutMs,
      },
    )));
    const statuses: Record<string, number> = {};
    for (const reply of replies) statuses[String(reply.status)] = (statuses[String(reply.status)] ?? 0) + 1;
    const success = replies.filter((r) => r.status === 201).length;
    const expectedConflict = replies.filter((r) => r.status === 409).length;
    const timeout = replies.filter((r) => r.status === 0 || r.status === 408 || r.status === 504).length;
    const unexpectedError = replies.length - success - expectedConflict - timeout;
    const targets = scenario === 'same-comanda' ? [arena.comandaId] : comandaIds;
    const comandas = await prisma.comanda.findMany({ where: { id: { in: targets } }, include: { itens: true } });
    const actualItems = comandas.reduce((sum, c) => sum + c.itens.reduce((n, item) => n + item.quantidade, 0), 0);
    const actualTotal = comandas.reduce((sum, c) => sum + Number(c.total), 0);
    const elapsed = performance.now() - clock;
    return {
      runId, scenario, concurrency, startedAt, finishedAt: new Date().toISOString(),
      fixture: {
        tenant: arena.slug, comandaIds, produtoId: arena.produtoId, eventoId: arena.eventoId, initialState: 'ABERTA',
        capabilities: { directSales: true, plannedOperations: true, taps: true, inventory: false, kitchen: false }, cashRegister: false,
      },
      success, expectedConflict, unexpectedError, timeout,
      p50: percentile(replies.map((r) => r.durationMs), 50), p95: percentile(replies.map((r) => r.durationMs), 95), p99: percentile(replies.map((r) => r.durationMs), 99),
      throughput: success / (elapsed / 1000), statuses,
      integrity: { expectedItems: success, actualItems, expectedTotal: success * arena.preco, actualTotal, valid: actualItems === success && Math.abs(actualTotal - success * arena.preco) < 0.01 },
    };
  } finally { await cleanupConcurrencyArena(arena.slug); }
}

async function main() {
  assertQaEnvironment();
  const runs: ConcurrencyRun[] = [];
  for (const scenario of ['same-comanda', 'independent-comandas'] as const) for (const concurrency of ramps) {
    const result = await execute(scenario, concurrency);
    runs.push(result);
    console.log(`[concurrency] ${scenario} n=${concurrency}: ${result.success} OK, ${result.expectedConflict} conflitos esperados, ${result.unexpectedError} erros, p95 ${result.p95.toFixed(0)}ms`);
  }
  writeJson(CONCURRENCY_PATH, { generatedAt: new Date().toISOString(), ramps, runs });
  await prisma.$disconnect();
  process.exit(runs.some((r) => r.unexpectedError || r.timeout || !r.integrity.valid) ? 1 : 0);
}
main().catch(async (error) => { console.error('[concurrency] FALHOU:', error); await prisma.$disconnect(); process.exit(1); });
