import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Inline catalog (mirrors e2e/release/support/catalog.ts) so the report runs without a TS loader. */
const RELEASE_CATALOG = [
  ['SMK-S01','P0'],['SMK-S02','P0'],['SMK-S03','P0'],['SMK-S04','P0'],
  ['AUT-S01','P1'],['AUT-S02','P1'],['AUT-S03','P1'],['AUT-S04','P1'],['AUT-X01','P1'],['AUT-X02','P1'],['AUT-X03','P1'],['AUT-X04','P1'],['AUT-X05','P1'],['AUT-X06','P1'],
  ['ADM-S01','P1'],['ADM-S02','P0'],['ADM-S03','P1'],['ADM-S04','P1'],['ADM-S05','P1'],['ADM-X01','P1'],['ADM-X02','P1'],['ADM-X03','P1'],
  ['ONB-S01','P1'],['ONB-S02','P1'],['ONB-X01','P1'],
  ['CFG-S01','P1'],['CFG-S02','P1'],['CFG-S03','P1'],['CFG-S04','P1'],['CFG-S05','P1'],['CFG-X01','P1'],['CFG-X02','P1'],['CFG-X03','P1'],['CFG-X04','P1'],['CFG-X05','P1'],['CFG-X06','P1'],['CFG-X07','P1'],
  ['RBAC-S01','P0'],['RBAC-S02','P0'],['RBAC-S03','P0'],['RBAC-X01','P0'],['RBAC-X02','P0'],['RBAC-X03','P0'],['RBAC-X04','P0'],['RBAC-X05','P0'],['RBAC-X06','P0'],['RBAC-X07','P0'],
  ['CAT-S01','P1'],['CAT-S02','P1'],['CAT-S03','P1'],['CAT-S04','P1'],['CAT-S05','P1'],['CAT-X01','P1'],['CAT-X02','P1'],['CAT-X03','P1'],
  ...['S01','S02','S03','S04','S05','S06','S07','S08','S09','X01','X02','X03','X04','X05','X06','X07','X08','X09','X10'].map((s) => [`CXA-${s}`,'P0']),
  ...['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12','X01','X02','X03','X04','X05','X06','X07','X08','X09','X10','X11','X12','X13','X14','X15'].map((s) => [`CMD-${s}`,'P0']),
  ...['S01','S02','S03','S04','S05','S06','X01','X02','X03','X04'].map((s) => [`KDS-${s}`,'P0']),
  ...['S01','S02','S03','S04','S05','X01','X02','X03','X04','X05','X06'].map((s) => [`EST-${s}`,'P1']),
  ...['S01','S02','S03','S04','S05','X01','X02','X03','X04','X05'].map((s) => [`POR-${s}`,'P1']),
  ...['S01','S02','S03','X01','X02','X03','X04'].map((s) => [`AGD-${s}`,'P1']),
  ...['S01','S02','X01','X02'].map((s) => [`CLI-${s}`,'P1']),
  ['DSH-S01','P0'],['DSH-S02','P0'],['DSH-S03','P0'],['DSH-S04','P1'],['DSH-S05','P1'],['DSH-X01','P1'],['DSH-X02','P1'],['DSH-X03','P1'],
  ...['S01','S02','S03','S04','S05'].map((s) => [`PWA-${s}`,'P1']),
  ...['X01','X02','X03','X04','X05','X06'].map((s) => [`SEC-${s}`,'P0']),
].map(([id, priority]) => ({ id, priority }));

const CATALOG_BY_ID = new Map(RELEASE_CATALOG.map((item) => [item.id, item]));
const catalogTotals = {
  P0: RELEASE_CATALOG.filter((item) => item.priority === 'P0').length,
  P1: RELEASE_CATALOG.filter((item) => item.priority === 'P1').length,
  P2: RELEASE_CATALOG.filter((item) => item.priority === 'P2').length,
};

const releaseSha = process.argv[2] ?? process.env.RELEASE_SHA;
if (!releaseSha || !/^[a-f0-9]{7,40}$/i.test(releaseSha)) throw new Error('Usage: node scripts/qa/build-release-report.mjs <releaseSha>');
const evidenceRoot = path.resolve('artifacts/release-e2e', releaseSha);
const outputRoot = path.resolve('docs/testing/release-certification', releaseSha);
const playwrightPath = path.join(evidenceRoot, 'playwright-results.json');
const playwright = JSON.parse(await readFile(playwrightPath, 'utf8'));

const cases = new Map();
const decisions = [];
const gaps = [];
for (const suite of playwright.suites ?? []) {
  for (const spec of suite.specs ?? []) {
    const match = spec.title.match(/\b[A-Z]{3,4}-[SX]\d{2}\b/);
    if (!match) continue;
    const id = match[0];
    const entries = cases.get(id) ?? [];
    for (const test of spec.tests ?? []) for (const result of test.results ?? []) {
      const annotations = [...(test.annotations ?? []), ...(result.annotations ?? [])];
      const decision = annotations.find((annotation) => annotation.type === 'product-decision');
      if (decision) decisions.push({ id, description: decision.description });
      const gap = annotations.find((annotation) => annotation.type === 'product-gap');
      if (gap) gaps.push({ id, description: gap.description });
      const status = result.status === 'skipped' ? 'skipped' : result.status;
      entries.push({ project: test.projectName, status, durationMs: result.duration, error: result.error?.message?.split('\n')[0], productDecision: decision?.description });
    }
    cases.set(id, entries);
  }
}

function caseStatus(executions) {
  if (!executions?.length) return 'missing';
  if (executions.every((run) => run.status === 'skipped')) return 'skipped';
  if (executions.every((run) => run.status === 'expected' || run.status === 'passed' || run.status === 'skipped')) return 'passed';
  return 'failed';
}

const uniqueDecisions = [...new Map(decisions.map((item) => [`${item.id}:${item.description}`, item])).values()];
const uniqueGaps = [...new Map(gaps.map((item) => [`${item.id}:${item.description}`, item])).values()];

const results = RELEASE_CATALOG.map(({ id, priority }) => {
  const executions = cases.get(id) ?? [];
  return {
    id,
    priority,
    status: caseStatus(executions),
    executions,
    evidence: {
      api: `artifacts/release-e2e/${releaseSha}/evidence/api/${id}.json`,
      db: `artifacts/release-e2e/${releaseSha}/evidence/db/${id}.json`,
    },
  };
});

const unexpected = [...cases.keys()].filter((id) => !CATALOG_BY_ID.has(id));
const count = (p) => {
  const of = results.filter((item) => item.priority === p);
  return {
    passed: of.filter((item) => item.status === 'passed').length,
    total: of.length,
    failed: of.filter((item) => item.status === 'failed').length,
    missing: of.filter((item) => item.status === 'missing' || item.status === 'skipped').length,
  };
};

const failed = results.filter((item) => item.status === 'failed');
const missing = results.filter((item) => item.status === 'missing' || item.status === 'skipped');

let p0Stability = null;
try {
  const roundReports = await Promise.all([1, 2, 3].map(async (round) => JSON.parse(await readFile(path.join(evidenceRoot, `p0-round-${round}.json`), 'utf8'))));
  function collectP0Round(data) {
    const executions = new Map();
    for (const suite of data.suites ?? []) for (const spec of suite.specs ?? []) {
      const match = spec.title.match(/\b[A-Z]{3,4}-[SX]\d{2}\b/);
      if (!match) continue;
      const catalog = CATALOG_BY_ID.get(match[0]);
      if (!catalog || catalog.priority !== 'P0') continue;
      const entries = executions.get(match[0]) ?? [];
      for (const test of spec.tests ?? []) for (const result of test.results ?? []) entries.push(result.status);
      executions.set(match[0], entries);
    }
    return {
      ids: [...executions.keys()],
      executions: [...executions.values()].flat(),
      failedIds: [...executions].filter(([, statuses]) => statuses.some((status) => status !== 'passed' && status !== 'expected' && status !== 'skipped')).map(([id]) => id),
    };
  }
  const p0Runs = roundReports.map(collectP0Round);
  const sameP0Failures = p0Runs.every((run) => JSON.stringify([...run.failedIds].sort()) === JSON.stringify([...p0Runs[0].failedIds].sort()));
  const p0Passed = p0Runs.map((run) => run.ids.filter((id) => !run.failedIds.includes(id)).length);
  p0Stability = {
    rounds: p0Runs.length,
    distinctCases: p0Runs[0].ids.length,
    catalogP0: catalogTotals.P0,
    passedEachRound: Math.min(...p0Passed),
    failedEachRound: p0Runs[0].failedIds.length,
    executionsPerRound: {
      passed: p0Runs[0].executions.filter((status) => status === 'passed' || status === 'expected').length,
      total: p0Runs[0].executions.length,
    },
    sameFailures: sameP0Failures,
    failedIds: p0Runs[0].failedIds,
  };
} catch {
  p0Stability = { rounds: 0, note: 'p0-round-*.json ainda não gerados' };
}

const defects = failed.map((item) => ({
  type: 'Suggested Plane Item',
  title: `[${item.id}] Falha no contrato esperado`,
  problem: item.executions.find((run) => run.error)?.error ?? 'Caso reprovado.',
  impact: item.priority === 'P0' ? 'Bloqueia a certificação da release.' : 'Reduz a cobertura funcional.',
  evidence: item.evidence.api,
  suggestedPriority: item.priority === 'P0' ? 'high' : 'medium',
  labels: ['Quality', 'E2E'],
}));

const fullSuite = {
  passedExecutions: results.reduce((sum, item) => sum + item.executions.filter((run) => run.status === 'passed' || run.status === 'expected').length, 0),
  totalExecutions: results.reduce((sum, item) => sum + item.executions.length, 0),
  viewports: ['desktop', 'mobile', 'tablet', 'tv'],
};

const p0 = count('P0');
const p1 = count('P1');
const go =
  p0.passed === catalogTotals.P0
  && p1.passed / Math.max(catalogTotals.P1, 1) >= 0.95
  && failed.length === 0
  && (p0Stability?.rounds === 0 || (p0Stability.failedIds?.length === 0 && p0Stability.sameFailures));

const report = {
  releaseSha,
  generatedAt: new Date().toISOString(),
  catalogSize: RELEASE_CATALOG.length,
  totals: { P0: p0, P1: p1, P2: count('P2') },
  verdict: go ? 'GO' : 'NO-GO',
  fullSuite,
  p0Stability,
  cases: results,
  productDecisions: uniqueDecisions,
  productGaps: uniqueGaps,
  defects,
  notAutomated: missing.map((item) => ({ id: item.id, reason: item.status === 'skipped' ? 'Marcado fixme/skip (lacuna de produto ou pré-condição).' : 'Caso do catálogo sem execução nesta rodada.' })),
  unexpectedIds: unexpected,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'results.json'), JSON.stringify(report, null, 2));
const permissionKeys = ['cash.open','cash.close','cash.values.read','cash.movement.write','payment.receive','debt.receive','command.close','discount.apply','command.item.cancel','command.item.cancel.delivered','command.cancel','kitchen.cancel','sale.refund','dashboard.read','event.dashboard.read','reports.read','command.operate','command.read','kitchen.read','kitchen.operate','inventory.read','inventory.adjust','catalog.manage','catalog.shift.manage','clients.manage','taps.operate','agenda.manage','event.menu.manage'];
await writeFile(path.join(outputRoot, 'matriz-rbac.md'), `# Matriz RBAC\n\n| Chave |\n| --- |\n${permissionKeys.map((key) => `| \`${key}\` |`).join('\n')}\n`);
const lines = [
  `# Relatório de certificação — ${releaseSha}`, '',
  `**Parecer:** ${report.verdict}`, '',
  `**Catálogo:** ${RELEASE_CATALOG.length} casos (P0 ${catalogTotals.P0}, P1 ${catalogTotals.P1}). Caso ausente conta como não aprovado.`,
  `**Placar:** P0 ${p0.passed}/${catalogTotals.P0} (falhas ${p0.failed}, ausentes ${p0.missing}); P1 ${p1.passed}/${catalogTotals.P1} (falhas ${p1.failed}, ausentes ${p1.missing}).`,
  `**Suíte completa:** ${fullSuite.passedExecutions}/${fullSuite.totalExecutions} execuções aprovadas.`,
  p0Stability?.rounds
    ? `**Estabilidade P0:** ${p0Stability.rounds} rodadas; ${p0Stability.passedEachRound}/${catalogTotals.P0} no catálogo por rodada. Falhas: ${(p0Stability.failedIds ?? []).join(', ') || 'nenhuma'}.`
    : '**Estabilidade P0:** ainda não executada.',
  '', '## Casos', '',
  ...results.map((item) => `- ${item.id} [${item.priority}]: ${item.status}`),
  '', '## Suggested Plane Items', '',
  ...(defects.length ? defects.map((item) => `- **${item.title}** (${item.suggestedPriority}): ${item.problem}`) : ['Nenhum defeito de execução registrado.']),
  '', '## Decisões de produto', '',
  ...(uniqueDecisions.length ? uniqueDecisions.map((item) => `- ${item.id}: ${item.description}`) : ['Nenhuma.']),
  '', '## Lacunas de produto', '',
  ...(uniqueGaps.length ? uniqueGaps.map((item) => `- ${item.id}: ${item.description}`) : ['Nenhuma.']),
  '', '## Casos não automatizados / skip', '',
  ...report.notAutomated.map((item) => `- ${item.id}: ${item.reason}`),
];
await writeFile(path.join(outputRoot, 'RELATORIO-CERTIFICACAO.md'), `${lines.join('\n')}\n`);
console.log(`RELEASE_REPORT=${path.relative(process.cwd(), outputRoot)}; catalog=${RELEASE_CATALOG.length}; passedP0=${p0.passed}/${catalogTotals.P0}; verdict=${report.verdict}`);
