import path from 'node:path';
import { api, portalPedidoBody, portalSessao, portalTestPhone } from './lib/http.js';
import { CONTEXT_PATH, WORKERS_DIR, readJson, writeJson } from './lib/store.js';
import type { PortalWorkerResult, QaContext } from './lib/types.js';

const WORKER_ID = process.env.QA_PORTAL_WORKER_ID ?? String(process.pid);
const OPS = Number(process.env.QA_PORTAL_OPS ?? 5);
const PHONE_PREFIX = Number(process.env.QA_PORTAL_PHONE_PREFIX ?? 80);

async function main() {
  const ctx = readJson<QaContext>(CONTEXT_PATH);
  const arena = ctx.arena;
  const slug = arena.slug ?? 'qa-arena';
  const telefone = portalTestPhone(PHONE_PREFIX, Number(WORKER_ID));

  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  const sessao = await portalSessao(slug, arena.trailerId, {
    nome: `Portal Worker ${WORKER_ID}`,
    telefone,
  });

  const pedidoLatencies: number[] = [];
  const pedidoIds: string[] = [];
  let pedidoSuccess = 0;
  let pedidoFailed = 0;

  if (sessao.cookie && sessao.status === 201) {
    const bursts = await Promise.all(
      Array.from({ length: OPS }, (_, i) =>
        api<{ id: string }>('POST', '/api/public/cliente/pedidos', {
          cookie: sessao.cookie!,
          body: portalPedidoBody(
            arena.produtoId,
            arena.tapId,
            arena.volumeMl,
            `QA-PORTAL-W${WORKER_ID}-${i + 1}`,
          ),
        }),
      ),
    );

    for (const r of bursts) {
      pedidoLatencies.push(r.durationMs);
      if (r.status === 201 && r.data?.id) {
        pedidoSuccess++;
        pedidoIds.push(r.data.id);
      } else {
        pedidoFailed++;
      }
    }
  }

  let cancelStatus: number | null = null;
  let cancelPedidoId: string | null = null;
  if (sessao.cookie && pedidoIds.length > 0) {
    cancelPedidoId = pedidoIds[pedidoIds.length - 1]!;
    const cancel = await api('POST', `/api/public/cliente/pedidos/${cancelPedidoId}/cancelar`, {
      cookie: sessao.cookie,
      body: {},
    });
    cancelStatus = cancel.status;
  }

  const result: PortalWorkerResult = {
    workerId: WORKER_ID,
    pid: process.pid,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: performance.now() - t0,
    sessao: {
      status: sessao.status,
      latencyMs: sessao.durationMs,
      comandaId: sessao.comandaId,
      clienteId: sessao.clienteId,
      telefone,
    },
    pedidoOps: {
      attempted: OPS,
      success: pedidoSuccess,
      failed: pedidoFailed,
      latencies: pedidoLatencies,
      pedidoIds,
    },
    cancel: {
      attempted: pedidoIds.length > 0,
      status: cancelStatus,
      pedidoId: cancelPedidoId,
    },
  };

  writeJson(path.join(WORKERS_DIR, `portal-worker-${WORKER_ID}.json`), result);
  console.log(
    `[portal-worker ${WORKER_ID}] sessao HTTP ${sessao.status} · pedidos ${pedidoSuccess}/${OPS} · cancel HTTP ${cancelStatus ?? 'n/a'} · ${result.durationMs.toFixed(0)}ms`,
  );
}

main().catch((err) => {
  console.error(`[portal-worker ${WORKER_ID}] FALHOU:`, err);
  process.exit(1);
});
