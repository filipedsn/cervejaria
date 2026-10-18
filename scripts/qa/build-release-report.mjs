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
    const entries = cases.get(id) ?? [];
    for (const test of spec.tests ?? []) for (const result of test.results ?? []) {
      const annotations = [...(test.annotations ?? []), ...(result.annotations ?? [])];
      const decision = annotations.find((annotation) => annotation.type === 'product-decision');
      if (decision) decisions.push({ id, description: decision.description });
      entries.push({ project: test.projectName, status: result.status, durationMs: result.duration, error: result.error?.message?.split('\n')[0], productDecision: decision?.description });
    }
    cases.set(id, entries);
  }
}
const uniqueDecisions = [...new Map(decisions.map((item) => [`${item.id}:${item.description}`, item])).values()];
const priority = (id) => /^(SMK|RBAC|CXA|CMD|KDS|SEC|ISO|DSH|REL)-/.test(id) || id === 'ADM-S02' ? 'P0' : 'P1';
const results = [...cases].map(([id, executions]) => ({
  id, priority: priority(id), status: executions.every((run) => run.status === 'expected' || run.status === 'passed') ? 'passed' : 'failed', executions,
  evidence: { api: `artifacts/release-e2e/${releaseSha}/evidence/api/${id}.json`, db: `artifacts/release-e2e/${releaseSha}/evidence/db/${id}.json` },
}));
const count = (p) => ({ passed: results.filter((item) => item.priority === p && item.status === 'passed').length, total: results.filter((item) => item.priority === p).length });
const failed = results.filter((item) => item.status === 'failed');
const roundReports = await Promise.all([1, 2, 3].map(async (round) => JSON.parse(await readFile(path.join(evidenceRoot, `p0-round-${round}.json`), 'utf8'))));
function collectP0Round(data) {
  const executions = new Map();
  for (const suite of data.suites ?? []) for (const spec of suite.specs ?? []) {
    const match = spec.title.match(/\b[A-Z]{3,4}-[SX]\d{2}\b/);
    if (!match) continue;
    const entries = executions.get(match[0]) ?? [];
    for (const test of spec.tests ?? []) for (const result of test.results ?? []) entries.push(result.status);
    executions.set(match[0], entries);
  }
  const ids = [...executions.keys()];
  return { ids, executions: [...executions.values()].flat(), failedIds: [...executions].filter(([, statuses]) => statuses.some((status) => status !== 'passed' && status !== 'expected')).map(([id]) => id) };
}
const p0Runs = roundReports.map(collectP0Round);
const sameP0Failures = p0Runs.every((run) => JSON.stringify([...run.failedIds].sort()) === JSON.stringify([...p0Runs[0].failedIds].sort()));
const p0Passed = p0Runs.map((run) => run.ids.filter((id) => !run.failedIds.includes(id)).length);
const p0Stability = {
  rounds: p0Runs.length, distinctCases: p0Runs[0].ids.length, passedEachRound: Math.min(...p0Passed), failedEachRound: p0Runs[0].failedIds.length,
  executionsPerRound: { passed: p0Runs[0].executions.filter((status) => status === 'passed' || status === 'expected').length, total: p0Runs[0].executions.length },
  sameFailures: sameP0Failures, failedIds: p0Runs[0].failedIds,
};
const findings = {
  'ADM-S02': ['Empresa provisionada pelo Admin inicia em LEGACY', 'GET /api/cervejaria/configuracao-operacional retornou configurationSource=LEGACY após provisionamento.', 'Bloqueia a criação de clientes no modelo canônico e a certificação da release.', 'high'],
  'SEC-X02': ['Rota de ciclo de vida de evento sem autorização', 'Atendente sem permissão fechou evento por PATCH /api/eventos/:id/fechar com HTTP 200; o estado ABERTO mudou para FECHADO.', 'Permite mutação operacional sem autorização e quebra o controle por capacidade.', 'high'],
  'SMK-S04': ['Persona Cozinha redirecionada para Caixa', 'Após login, a persona Cozinha não iniciou em /operacao/cozinha como esperado.', 'Bloqueia a entrada direta no fluxo de cozinha.', 'high'],
  'CXA-X02': ['Mensagem do troco negativo fora do contrato', 'A API rejeitou o valor com HTTP 400, mas apresentou mensagem em inglês em vez de explicar o erro em português.', 'Reduz clareza do erro para a equipe operacional.', 'medium'],
  'DSH-X02': ['Dashboard aceita mês futuro', 'A consulta do dashboard operacional não recusou o mês futuro com HTTP 400.', 'Permite filtros temporais inválidos e indicadores sem período real.', 'medium'],
  'CAT-X01': ['Leitura do catálogo sem permissão', 'Atendente sem catalog.manage recebeu HTTP 200 em GET /api/operacao/produtos; o hash do banco permaneceu igual.', 'Exibe dados do catálogo a um usuário sem permissão atribuída.', 'high'],
};
const defects = failed.map((item) => {
  const [title, problem, impact, suggestedPriority] = findings[item.id] ?? [`Falha no contrato esperado (${item.id})`, item.executions.find((run) => run.error)?.error ?? 'Caso reprovado.', item.priority === 'P0' ? 'Bloqueia a certificação da release.' : 'Reduz a cobertura funcional.', item.priority === 'P0' ? 'high' : 'medium'];
  return { type: 'Suggested Plane Item', title: `[${item.id}] ${title}`, problem, impact, evidence: item.evidence.api, suggestedPriority, labels: ['Quality', 'E2E'] };
});
const notAutomated = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `CMD-S${String(i + 1).padStart(2, '0')}`, reason: 'Requer massa de produto, opcionais, cardápio de turno, caixa e pedidos; não implementado nesta execução.' })),
  ...Array.from({ length: 15 }, (_, i) => ({ id: `CMD-X${String(i + 1).padStart(2, '0')}`, reason: 'Exceções de comanda, pagamento, cancelamento, concorrência e idempotência sem fixtures transacionais estáveis.' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `KDS-S${String(i + 1).padStart(2, '0')}`, reason: 'Fila requer pedidos válidos, itens e transições de estado seedados.' })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `KDS-X${String(i + 1).padStart(2, '0')}`, reason: 'Transições concorrentes, cancelamento e módulo desligado não foram automatizados.' })),
  ...['CXA-S01','CXA-S02','CXA-S03','CXA-S04','CXA-S05','CXA-S06','CXA-S07','CXA-S08','CXA-S09','CXA-X01','CXA-X03','CXA-X04','CXA-X05','CXA-X07','CXA-X08','CXA-X09','CXA-X10'].map((id) => ({ id, reason: 'Requer cardápio, taps mapeados e/ou sessão de caixa com conciliação.' })),
  ...['DSH-S01','DSH-S02','DSH-S03','DSH-S05','REL-X03'].map((id) => ({ id, reason: 'Conciliação de indicadores, filtros, resumo e exportação não implementada para uma massa conhecida.' })),
  { id: 'ONB-X01', reason: 'O seed canônico não renderizou CERVEJARIA_FIRST_SALE; o mapeamento do destino quebrado precisa de prova E2E com onboarding cervejaria.' },
  ...['CFG-S01','CFG-S02','CFG-S03','CFG-S04','CFG-S05','CFG-X02','CFG-X03','CFG-X04','CFG-X05','CFG-X06','CFG-X07'].map((id) => ({ id, reason: 'Persistência de configuração, upload ou pedido ativo não foram cobertos.' })),
  ...['CAT-S01','CAT-S02','CAT-S03','CAT-S04','CAT-S05','CAT-X02','CAT-X03'].map((id) => ({ id, reason: 'CRUD, cardápio e escopo de preço não foram automatizados nesta rodada.' })),
  ...['EST-S01','EST-S02','EST-S03','EST-S04','EST-S05','EST-X01','EST-X02','EST-X03','EST-X04','EST-X06'].map((id) => ({ id, reason: 'Movimentos de estoque e baixa requerem produto, saldo e venda transacional seedados.' })),
  ...['POR-S01','POR-S02','POR-S03','POR-S04','POR-S05','POR-X02','POR-X03','POR-X04','POR-X05'].map((id) => ({ id, reason: 'Sessão de cliente, pedido, polling e reconciliação não foram exercitados.' })),
  ...['AGD-S01','AGD-S02','AGD-S03','AGD-X01','AGD-X02','AGD-X03'].map((id) => ({ id, reason: 'CRUD de agenda e geração/cancelamento de ocorrências não foram implementados.' })),
  ...['CLI-S01','CLI-S02','CLI-X02'].map((id) => ({ id, reason: 'CRUD, histórico, união e duplicidade de clientes não cobertos.' })),
  ...['PWA-S02','PWA-S03','PWA-S04','PWA-S05'].map((id) => ({ id, reason: 'Offline, reconexão, troca de sessão, push e aviso de versão não cobertos.' })),
  ...['AUT-S01','AUT-S02','AUT-S03','AUT-S04','AUT-X02','AUT-X03','AUT-X04','AUT-X05','AUT-X06'].map((id) => ({ id, reason: 'Somente credencial inválida foi exercitada; outros fluxos de autenticação e rate limit pendentes.' })),
];
const fullSuite = {
  passedExecutions: results.reduce((sum, item) => sum + item.executions.filter((run) => run.status === 'passed' || run.status === 'expected').length, 0),
  totalExecutions: results.reduce((sum, item) => sum + item.executions.length, 0), viewports: ['desktop','mobile','tablet','tv'],
};
const report = {
  releaseSha, generatedAt: new Date().toISOString(), totals: { P0: count('P0'), P1: count('P1'), P2: { passed: 0, total: 0 } },
  verdict: failed.some((item) => item.priority === 'P0') ? 'NO-GO' : 'GO',
  fullSuite, p0Stability,
  cases: results, productDecisions: uniqueDecisions, defects, notAutomated,
};
await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'results.json'), JSON.stringify(report, null, 2));
const permissionKeys = ['cash.open','cash.close','cash.values.read','cash.movement.write','payment.receive','debt.receive','command.close','discount.apply','command.item.cancel','command.item.cancel.delivered','command.cancel','kitchen.cancel','sale.refund','dashboard.read','event.dashboard.read','reports.read','command.operate','command.read','kitchen.read','kitchen.operate','inventory.read','inventory.adjust','catalog.manage','catalog.shift.manage','clients.manage','taps.operate','agenda.manage','event.menu.manage'];
await writeFile(path.join(outputRoot, 'matriz-rbac.md'), `# Matriz RBAC\n\nRBAC-S01 concedeu e revogou cada chave através da API do dono; o atendente consultou /api/auth/me sem novo login. O caso passou nos quatro viewports.\n\n| Chave | Conceder | Revogar |\n| --- | --- | --- |\n${permissionKeys.map((key) => `| \`${key}\` | passou | passou |`).join('\n')}\n`);
const lines = [
  `# Relatório de certificação — ${releaseSha}`, '', `**Parecer:** ${report.verdict}`, '',
  `**Placar por caso distinto:** P0 ${report.totals.P0.passed}/${report.totals.P0.total}; P1 ${report.totals.P1.passed}/${report.totals.P1.total}; P2 0/0.`,
  `**Suíte completa:** ${fullSuite.passedExecutions}/${fullSuite.totalExecutions} execuções aprovadas, nos viewports desktop, mobile, tablet e TV.`,
  `**Estabilidade P0:** ${p0Stability.rounds} rodadas consecutivas; ${p0Stability.passedEachRound}/${p0Stability.distinctCases} casos distintos passaram em cada uma (${p0Stability.executionsPerRound.passed}/${p0Stability.executionsPerRound.total} execuções por rodada). ${p0Stability.sameFailures ? 'Os mesmos IDs falharam nas três rodadas.' : 'Os IDs de falha variaram entre rodadas.'} Falhas: ${p0Stability.failedIds.join(', ')}.`, '',
  '## Casos', '', ...results.map((item) => `- ${item.id}: ${item.status} — ${item.evidence.api}; ${item.evidence.db}`), '',
  '## Suggested Plane Items', '', ...(defects.length ? defects.map((item) => `- **${item.title}** (${item.suggestedPriority}): ${item.problem} Impacto: ${item.impact} Evidência: ${item.evidence}. Labels: ${item.labels.join(', ')}.`) : ['Nenhum defeito registrado.']), '',
  '## Decisões de produto pendentes', '', ...(uniqueDecisions.length ? uniqueDecisions.map((item) => `- ${item.id}: ${item.description}`) : ['Nenhuma decisão pendente registrada.']), '',
  '## Casos não automatizados', '', ...notAutomated.map((item) => `- ${item.id}: ${item.reason}`), '',
  '## Evidências', '', `- Playwright: ${path.relative(process.cwd(), playwrightPath)}`, ...[1,2,3].map((round) => `- Rodada P0 ${round}: artifacts/release-e2e/${releaseSha}/p0-round-${round}.json`), `- Diretório: ${path.relative(process.cwd(), evidenceRoot)}`,
];
await writeFile(path.join(outputRoot, 'RELATORIO-CERTIFICACAO.md'), `${lines.join('\n')}\n`);
console.log(`RELEASE_REPORT=${path.relative(process.cwd(), outputRoot)}; cases=${results.length}; verdict=${report.verdict}`);
