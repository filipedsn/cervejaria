import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const releaseSha = process.argv[2] ?? process.env.RELEASE_SHA;
if (!releaseSha || !/^[a-f0-9]{7,40}$/i.test(releaseSha)) throw new Error('Usage: node scripts/qa/build-release-report.mjs <releaseSha>');
const evidenceRoot = path.resolve('artifacts/release-e2e', releaseSha);
const outputRoot = path.resolve('docs/testing/release-certification', releaseSha);
const playwrightPath = path.join(evidenceRoot, 'playwright-results.json');
const playwright = JSON.parse(await readFile(playwrightPath, 'utf8'));
const cases = new Map();
const decisions = [];
for (const suite of playwright.suites ?? []) {
  for (const spec of suite.specs ?? []) {
    const match = spec.title.match(/\b[A-Z]{3,4}-[SX]\d{2}\b/);
    if (!match) continue;
    const id = match[0];
    const tests = spec.tests ?? [];
    const entries = cases.get(id) ?? [];
    for (const test of tests) for (const result of test.results ?? []) {
      const annotations = [...(test.annotations ?? []), ...(result.annotations ?? [])];
      const decision = annotations.find((annotation) => annotation.type === 'product-decision');
      if (decision) decisions.push({ id, description: decision.description });
      entries.push({ project: test.projectName, status: result.status, durationMs: result.duration, error: result.error?.message?.split('\n')[0], productDecision: decision?.description });
    }
    cases.set(id, entries);
  }
}
const priority = (id) => /^(SMK|ADM-S02|RBAC|CXA|CMD|KDS|SEC|ISO|DSH|REL)-/.test(id) ? 'P0' : 'P1';
const results = [...cases].map(([id, executions]) => ({ id, priority: priority(id), status: executions.every((run) => run.status === 'expected' || run.status === 'passed') ? 'passed' : 'failed', executions, evidence: { api: `artifacts/release-e2e/${releaseSha}/evidence/api/${id}.json`, db: `artifacts/release-e2e/${releaseSha}/evidence/db/${id}.json` } }));
const count = (p) => ({ passed: results.filter((item) => item.priority === p && item.status === 'passed').length, total: results.filter((item) => item.priority === p).length });
const failed = results.filter((item) => item.status === 'failed');
const report = {
  releaseSha, generatedAt: new Date().toISOString(), totals: { P0: count('P0'), P1: count('P1'), P2: { passed: 0, total: 0 } },
  verdict: failed.some((item) => item.priority === 'P0') ? 'NO-GO' : 'GO',
  cases: results,
  productDecisions: decisions,
  defects: failed.map((item) => ({ type: 'Suggested Plane Item', title: `[${item.id}] Falha no contrato esperado`, problem: item.executions.find((run) => run.error)?.error ?? 'Caso reprovado', impact: item.priority === 'P0' ? 'Bloqueia certificação da release.' : 'Reduz a cobertura funcional.', evidence: item.evidence.api, suggestedPriority: item.priority === 'P0' ? 'high' : 'medium', labels: ['Quality', 'E2E'] })),
  notAutomated: [],
};
await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'results.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(outputRoot, 'matriz-rbac.md'), '# Matriz RBAC\n\nA cobertura será preenchida pelos casos RBAC da etapa 3.\n');
const lines = [
  `# Relatório de certificação — ${releaseSha}`, '',
  `**Parecer:** ${report.verdict}`, '',
  `**Placar:** P0 ${report.totals.P0.passed}/${report.totals.P0.total}; P1 ${report.totals.P1.passed}/${report.totals.P1.total}; P2 0/0.`, '',
  '## Casos', '',
  ...results.map((item) => `- ${item.id}: ${item.status} — ${item.evidence.api}; ${item.evidence.db}`), '',
  '## Suggested Plane Items', '',
  ...(report.defects.length ? report.defects.map((item) => `- **${item.title}** (${item.suggestedPriority}): ${item.problem} Impacto: ${item.impact} Evidência: ${item.evidence}. Labels: ${item.labels.join(', ')}.`) : ['Nenhum defeito registrado.']), '',
  '## Decisões de produto pendentes', '',
  ...(decisions.length ? decisions.map((item) => `- ${item.id}: ${item.description}`) : ['Nenhuma decisão pendente registrada.']), '',
  '## Casos não automatizados', '', '- Nenhum registrado.', '',
  '## Evidências', '', `- Playwright: ${path.relative(process.cwd(), playwrightPath)}`, `- Diretório: ${path.relative(process.cwd(), evidenceRoot)}`,
];
await writeFile(path.join(outputRoot, 'RELATORIO-CERTIFICACAO.md'), `${lines.join('\n')}\n`);
console.log(`RELEASE_REPORT=${path.relative(process.cwd(), outputRoot)}; cases=${results.length}; verdict=${report.verdict}`);
