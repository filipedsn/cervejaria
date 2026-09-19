import path from 'node:path';
import { api, chopeItemBody } from './lib/http.js';
import { CONTEXT_PATH, WORKERS_DIR, readJson, writeJson } from './lib/store.js';
import type { QaContext, WorkerResult } from './lib/types.js';

// Each worker is a SEPARATE OS process (launched as a subagent) that hammers the
// shared arena comanda concurrently — producing true cross-process contention
// that a single Node event loop cannot reproduce.
const WORKER_ID = process.env.QA_WORKER_ID ?? String(process.pid);
const OPS = Number(process.env.QA_WORKER_OPS ?? 30);

async function main() {
  const ctx = readJson<QaContext>(CONTEXT_PATH);
  const arena = ctx.arena;
  const token = arena.atendenteTokens[Number(WORKER_ID) % arena.atendenteTokens.length] ?? arena.atendenteTokens[0];

  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  // Burst: fire all item additions in parallel against the same comanda.
  const latencies: number[] = [];
  let success = 0;
  let failed = 0;

  const bursts = await Promise.all(
    Array.from({ length: OPS }, () =>
      api('POST', `/api/comandas/${arena.comandaId}/itens`, {
        token,
        body: chopeItemBody(arena.produtoId, arena.tapId, arena.volumeMl),
      }),
    ),
  );
  for (const r of bursts) {
    latencies.push(r.durationMs);
    if (r.status === 201) success++;
    else failed++;
  }

  // Concurrency on invariant "only one open event": try to open a second event now.
  const today = new Date().toISOString().slice(0, 10);
  const dup = await api<{ id?: string }>('POST', '/api/eventos', {
    token: arena.donoToken,
    body: {
      nome: `Dup ${WORKER_ID}`,
      local: 'race',
      horaInicio: '18:00',
      data: today,
      abrirAgora: true,
      trailerId: arena.trailerId,
    },
  });

  const result: WorkerResult = {
    workerId: WORKER_ID,
    pid: process.pid,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: performance.now() - t0,
    itemOps: { attempted: OPS, success, failed, latencies },
    duplicateEvent: { status: dup.status, eventoId: dup.data?.id ?? null },
  };

  writeJson(path.join(WORKERS_DIR, `worker-${WORKER_ID}.json`), result);
  if (success === 0 && failed === OPS) {
    throw new Error(`All ${OPS} concurrency operations failed.`);
  }
  console.log(
    `[worker ${WORKER_ID}] pid=${process.pid} itens ${success}/${OPS} OK · dupEvento HTTP ${dup.status} · ${result.durationMs.toFixed(0)}ms`,
  );
}

main().catch((err) => {
  console.error(`[worker ${WORKER_ID}] FALHOU:`, err);
  process.exit(1);
});
