import { prisma } from '../src/lib/prisma.js';
import { percentile } from './lib/http.js';
import { renderHtml } from './lib/render.js';
import { CONTEXT_PATH, HTML_PATH, SUITE_PATH, readJson, readPortalWorkerResults, readWorkerResults, writeJson } from './lib/store.js';
import type { PerfMetric, PortalWorkerResult, QaContext, SuiteArtifact, TestResult, WorkerResult } from './lib/types.js';

async function main() {
  const ctx = readJson<QaContext>(CONTEXT_PATH);
  const suite = readJson<SuiteArtifact>(SUITE_PATH);
  const workers = readWorkerResults<WorkerResult>();
  const portalWorkers = readPortalWorkerResults<PortalWorkerResult>();

  const results: TestResult[] = [...suite.results];
  const perf: PerfMetric[] = [...suite.perf];

  const push = (r: TestResult) => results.push(r);
  const t = (over: Partial<TestResult> & { id: string; name: string }): TestResult => ({
    category: 'Integridade',
    status: 'passed',
    durationMs: 0,
    requirement: over.id,
    ...over,
  });

  // ── DB-01: totais consistentes ─────────────────────────────────────────
  const drift = await prisma.$queryRaw<{ id: string; total: number; soma: number }[]>`
    SELECT c.id, c.total::float AS total, COALESCE(SUM(i."precoUnit"::float * i.quantidade),0) AS soma
    FROM "Comanda" c
    LEFT JOIN "ItemComanda" i ON i."comandaId" = c.id
    WHERE c."eventoId" IN (
      SELECT e.id FROM "Evento" e JOIN "Cervejaria" cb ON cb.id = e."cervejariaId"
      WHERE cb.slug LIKE 'qa-load-%' OR cb.slug = 'qa-arena' OR cb.slug = 'qa-multi-trailer'
    )
    GROUP BY c.id, c.total
    HAVING ABS(c.total::float - COALESCE(SUM(i."precoUnit"::float * i.quantidade),0)) > 0.02`;
  push(t({
    id: 'DB-01', name: 'Comanda.total == Σ itens (todas as comandas QA)', category: 'Integridade',
    status: drift.length === 0 ? 'passed' : 'failed',
    message: drift.length === 0 ? 'Todos os totais consistentes' : `${drift.length} comanda(s) divergente(s)`,
    expected: '0 divergências', actual: `${drift.length}`,
    details: drift.slice(0, 5).map((d) => `${d.id}: total=${d.total} soma=${d.soma}`).join('\n') || undefined,
  }));

  // ── DB-02: cliente cross-tenant ────────────────────────────────────────
  const crossClient = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt FROM "Comanda" co
    JOIN "Evento" e ON e.id = co."eventoId"
    JOIN "Cliente" cl ON cl.id = co."clienteId"
    WHERE e."cervejariaId" != cl."cervejariaId"`;
  const crossClientN = Number(crossClient[0]?.cnt ?? 0);
  push(t({
    id: 'DB-02', name: 'Nenhuma comanda com cliente de outra cervejaria',
    status: crossClientN === 0 ? 'passed' : 'failed',
    message: crossClientN === 0 ? 'Zero vazamento cliente↔evento' : `${crossClientN} inconsistências`,
    expected: '0', actual: String(crossClientN),
  }));

  // ── DB-03: item com produto de outra cervejaria ────────────────────────
  const crossItem = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt FROM "ItemComanda" i
    JOIN "Comanda" co ON co.id = i."comandaId"
    JOIN "Evento" e ON e.id = co."eventoId"
    JOIN "Produto" p ON p.id = i."produtoId"
    WHERE e."cervejariaId" != p."cervejariaId"`;
  const crossItemN = Number(crossItem[0]?.cnt ?? 0);
  push(t({
    id: 'DB-03', name: 'Nenhum item com produto de outra cervejaria',
    status: crossItemN === 0 ? 'passed' : 'failed',
    message: crossItemN === 0 ? 'Produtos consistentes por tenant' : `${crossItemN} itens cross-tenant`,
    expected: '0', actual: String(crossItemN),
  }));

  // ── DB-05: no máximo 1 evento ABERTO por trailer ───────────────────────
  const openPerTrailer = await prisma.$queryRaw<{ trailerId: string; cnt: bigint }[]>`
    SELECT e."trailerId", COUNT(*) AS cnt
    FROM "Evento" e
    JOIN "Cervejaria" cb ON cb.id = e."cervejariaId"
    WHERE e.status = 'ABERTO' AND e.data IS NOT NULL
      AND (cb.slug LIKE 'qa-load-%' OR cb.slug = 'qa-arena' OR cb.slug = 'qa-multi-trailer')
    GROUP BY e."trailerId"
    HAVING COUNT(*) > 1`;
  const trailerViolations = openPerTrailer.length;
  push(t({
    id: 'DB-05', name: 'No máximo 1 evento ABERTO por trailer (dados QA)',
    status: trailerViolations === 0 ? 'passed' : 'failed',
    message: trailerViolations === 0 ? 'Invariante por trailer respeitada' : `${trailerViolations} trailer(s) com >1 evento aberto`,
    expected: '0 violações', actual: String(trailerViolations),
  }));

  // ── DB-06: pedido com cliente da comanda ───────────────────────────────
  const pedidoClienteMismatch = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt FROM "PedidoCliente" p
    JOIN "Comanda" c ON c.id = p."comandaId"
    WHERE c."clienteId" != p."clienteId"`;
  const pedidoMismatchN = Number(pedidoClienteMismatch[0]?.cnt ?? 0);
  push(t({
    id: 'DB-06', name: 'PedidoCliente.comandaId pertence ao mesmo clienteId',
    status: pedidoMismatchN === 0 ? 'passed' : 'failed',
    message: pedidoMismatchN === 0 ? 'Zero pedido com comanda de outro cliente' : `${pedidoMismatchN} inconsistência(s)`,
    expected: '0', actual: String(pedidoMismatchN),
  }));

  // ── DB-07: no máximo 1 comanda ABERTA por (evento, cliente) ─────────────
  const dupComandas = await prisma.$queryRaw<{ eventoId: string; clienteId: string; cnt: bigint }[]>`
    SELECT "eventoId", "clienteId", COUNT(*) AS cnt
    FROM "Comanda"
    WHERE status = 'ABERTA'
      AND "eventoId" IN (
        SELECT e.id FROM "Evento" e JOIN "Cervejaria" cb ON cb.id = e."cervejariaId"
        WHERE cb.slug LIKE 'qa-load-%' OR cb.slug = 'qa-arena' OR cb.slug = 'qa-multi-trailer'
      )
    GROUP BY "eventoId", "clienteId"
    HAVING COUNT(*) > 1`;
  const dupComandasN = dupComandas.length;
  push(t({
    id: 'DB-07', name: 'No máximo 1 comanda ABERTA por (evento, cliente) nos dados QA',
    status: dupComandasN === 0 ? 'passed' : 'failed',
    message: dupComandasN === 0 ? 'Sem comandas ABERTA duplicadas' : `${dupComandasN} par(es) com >1 comanda aberta`,
    expected: '0 violações', actual: String(dupComandasN),
    details: dupComandas.slice(0, 3).map((d) => `${d.eventoId}/${d.clienteId}: ${d.cnt}`).join('\n') || undefined,
  }));

  // ── DB-08: pedidos QA-CLIENT-* na comanda correta ──────────────────────
  const qaClientPedidos = await prisma.pedidoCliente.findMany({
    where: { observacao: { startsWith: 'QA-CLIENT-' } },
    select: { id: true, observacao: true, comandaId: true, clienteId: true },
  });
  let db08Violations = 0;
  for (const p of qaClientPedidos) {
    const comanda = await prisma.comanda.findUnique({
      where: { id: p.comandaId },
      select: { clienteId: true },
    });
    if (!comanda || comanda.clienteId !== p.clienteId) db08Violations++;
  }
  push(t({
    id: 'DB-08', name: 'Pedidos QA-CLIENT-* vinculados à comanda do cliente correto',
    status: db08Violations === 0 ? 'passed' : 'failed',
    message: db08Violations === 0
      ? `${qaClientPedidos.length} pedido(s) QA-CLIENT consistentes`
      : `${db08Violations} pedido(s) inconsistentes`,
    expected: '0 violações', actual: String(db08Violations),
  }));

  // ── Concorrência multi-processo (workers) ──────────────────────────────
  const totalAttempted = workers.reduce((s, w) => s + w.itemOps.attempted, 0);
  const totalSuccess = workers.reduce((s, w) => s + w.itemOps.success, 0);
  const totalFailed = workers.reduce((s, w) => s + w.itemOps.failed, 0);

  const arenaComanda = await prisma.comanda.findUnique({
    where: { id: ctx.arena.comandaId },
    include: { itens: true },
  });
  const arenaItemCount = arenaComanda?.itens.reduce((s, i) => s + i.quantidade, 0) ?? 0;
  const arenaTotal = Number(arenaComanda?.total ?? 0);
  const expectedTotal = arenaItemCount * ctx.arena.preco;

  push(t({
    id: 'CONC-01', name: `Itens concorrentes (${workers.length} processos) sem lost update`,
    category: 'Concorrência', requirement: 'CONC-01',
    status: arenaItemCount === totalSuccess && Math.abs(arenaTotal - expectedTotal) < 0.01 ? 'passed' : 'failed',
    message: `${workers.length} workers · ${totalSuccess}/${totalAttempted} itens OK · comanda tem ${arenaItemCount} itens (R$ ${arenaTotal.toFixed(2)})`,
    expected: `${totalSuccess} itens / R$ ${expectedTotal.toFixed(2)}`,
    actual: `${arenaItemCount} itens / R$ ${arenaTotal.toFixed(2)}`,
    details: totalFailed > 0 ? `${totalFailed} requisições falharam sob carga.` : undefined,
  }));

  const openEvents = await prisma.evento.count({ where: { cervejariaId: ctx.arena.cervejariaId, status: 'ABERTO' } });
  const dupCreated = workers.filter((w) => w.duplicateEvent.status === 201).length;
  const dupRejected = workers.filter((w) => w.duplicateEvent.status === 409).length;
  push(t({
    id: 'CONC-02', name: 'Concorrência: segundo evento no mesmo trailer rejeitado',
    category: 'Concorrência', requirement: 'CONC-02',
    status: dupRejected > 0 && dupCreated === 0 ? 'passed' : dupCreated > 0 ? 'failed' : 'warning',
    message: `${openEvents} evento(s) ABERTO(s) na arena; ${dupRejected}/${workers.length} rejeições 409; ${dupCreated} criações indevidas`,
    expected: '409 no mesmo trailer', actual: dupCreated > 0 ? `${dupCreated}×201` : `${dupRejected}×409`,
  }));

  // ── Latência agregada multi-processo (CONC-04) ─────────────────────────
  const allLat = workers.flatMap((w) => w.itemOps.latencies);
  if (allLat.length) {
    perf.push({
      label: `POST /comandas/:id/itens (${workers.length} processos concorrentes)`,
      samples: allLat.length,
      p50: percentile(allLat, 50), p95: percentile(allLat, 95), p99: percentile(allLat, 99),
      max: Math.max(...allLat), errors: totalFailed, target: 600,
    });
  }

  // ── Portal workers (CONC-05) ───────────────────────────────────────────
  const portalSessaoLat = portalWorkers.map((w) => w.sessao.latencyMs);
  const portalPedidoLat = portalWorkers.flatMap((w) => w.pedidoOps.latencies);
  const portalSessaoOk = portalWorkers.filter((w) => w.sessao.status === 201).length;
  const portalPedidoOk = portalWorkers.reduce((s, w) => s + w.pedidoOps.success, 0);
  const portalPedidoAttempted = portalWorkers.reduce((s, w) => s + w.pedidoOps.attempted, 0);
  const sessaoP95 = percentile(portalSessaoLat, 95);
  const pedidoP95 = percentile(portalPedidoLat, 95);

  if (portalSessaoLat.length) {
    perf.push({
      label: `POST /public/.../sessao (${portalWorkers.length} portal-workers)`,
      samples: portalSessaoLat.length,
      p50: percentile(portalSessaoLat, 50), p95: sessaoP95, p99: percentile(portalSessaoLat, 99),
      max: Math.max(...portalSessaoLat), errors: portalWorkers.length - portalSessaoOk, target: 2000,
    });
  }
  if (portalPedidoLat.length) {
    perf.push({
      label: `POST /public/cliente/pedidos (${portalWorkers.length} portal-workers)`,
      samples: portalPedidoLat.length,
      p50: percentile(portalPedidoLat, 50), p95: pedidoP95, p99: percentile(portalPedidoLat, 99),
      max: Math.max(...portalPedidoLat),
      errors: portalPedidoAttempted - portalPedidoOk,
      target: 1000,
    });
  }

  push(t({
    id: 'CONC-05',
    name: `Portal stress (${portalWorkers.length} clientes simultâneos)`,
    category: 'Concorrência',
    requirement: 'CONC-05',
    status:
      portalSessaoOk === portalWorkers.length &&
      portalPedidoOk === portalPedidoAttempted &&
      sessaoP95 <= 2000 &&
      pedidoP95 <= 1000
        ? 'passed'
        : portalSessaoOk < portalWorkers.length || portalPedidoOk < portalPedidoAttempted
          ? 'failed'
          : 'warning',
    message: `${portalSessaoOk}/${portalWorkers.length} sessões · ${portalPedidoOk}/${portalPedidoAttempted} pedidos · p95 sessão ${sessaoP95.toFixed(0)}ms · p95 pedido ${pedidoP95.toFixed(0)}ms`,
    expected: '100% OK · p95 sessão ≤2s · p95 pedido ≤1s',
    actual: `${portalSessaoOk}/${portalWorkers.length} sessões · p95 ${sessaoP95.toFixed(0)}/${pedidoP95.toFixed(0)}ms`,
  }));

  // ── Recomendações ──────────────────────────────────────────────────────
  const failed = results.filter((r) => r.status === 'failed');
  const warnings = results.filter((r) => r.status === 'warning');
  const rec: string[] = [];
  if (results.some((r) => r.expected === '403' && r.actual === '500'))
    rec.push('Registrar @fastify/sensible para que RBAC e cervejaria inativa retornem 403 (hoje 500). Impacta requireDono, requireAdmin e assertCervejariaAtiva.');
  if (warnings.some((r) => r.id === 'SESS-07'))
    rec.push('Definir expiresIn no @fastify/jwt (ex.: 8h) e implementar refresh token — hoje a sessão nunca expira.');
  if (warnings.some((r) => r.id === 'SESS-09'))
    rec.push('Revalidar existência/estado do usuário (sub) no hook authenticate, não apenas assinatura + cervejaria ativa.');
  if (warnings.some((r) => r.id === 'CONC-02'))
    rec.push('Workers de concorrência devem receber 409 ao tentar abrir evento no mesmo trailer/horário da arena.');
  if (failed.some((r) => r.id === 'CONC-03'))
    rec.push('Fechar comanda em transação com lock (SELECT ... FOR UPDATE / update condicional por status) para evitar cobrança dupla.');
  if (failed.some((r) => r.id === 'CONC-01'))
    rec.push('Revisar recalcTotal: recomputar total dentro de transação para eliminar lost update sob concorrência.');
  if (failed.some((r) => r.id === 'DB-07' || r.id === 'PORTAL-04'))
    rec.push('Adicionar índice único parcial (eventoId, clienteId) WHERE status=ABERTA e retry em findOrCreateComandaAberta para eliminar comandas duplicadas.');
  if (failed.some((r) => r.id === 'DB-06' || r.id === 'DB-08'))
    rec.push('CRÍTICO: pedido caiu em comanda de outro cliente — revisar binding session.comandaId/clienteId no portal.');
  if (perf.some((p) => p.target && p.p95 > p.target))
    rec.push('Otimizar endpoints acima da meta de p95 (índices, evitar N+1, cache de agregações).');
  rec.push('Concluir UAT manual: PWA offline, fluxo de pagamento PIX/cartão real, branding por tenant e recorrência semanal.');

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: failed.length,
    warnings: warnings.length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };

  const html = renderHtml({
    generatedAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    apiBase: ctx.apiBase,
    durationMs: suite.durationMs,
    loadProfile: ctx.loadProfile,
    workers: { count: workers.length, attempted: totalAttempted, success: totalSuccess, failed: totalFailed },
    summary,
    results,
    perf,
    recommendations: rec,
  });
  writeJson(SUITE_PATH.replace('suite.json', 'final.json'), { summary, recommendations: rec });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(HTML_PATH, html, 'utf-8');

  console.log('\n═══════════════════════════════════════════');
  console.log('  RELATÓRIO QA APROFUNDADO — Cervejaria Móvel');
  console.log('═══════════════════════════════════════════');
  console.log(`  Casos     : ${summary.total}`);
  console.log(`  Aprovados : ${summary.passed}`);
  console.log(`  Falhas    : ${summary.failed}`);
  console.log(`  Alertas   : ${summary.warnings}`);
  console.log(`  Ignorados : ${summary.skipped}`);
  console.log(`  Workers   : ${workers.length} processos · ${totalSuccess}/${totalAttempted} itens`);
  console.log(`  HTML      : ${HTML_PATH}`);
  console.log('═══════════════════════════════════════════\n');
  failed.forEach((f) => console.error(`  XX ${f.id} ${f.name} — ${f.message}`));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[report] FATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
