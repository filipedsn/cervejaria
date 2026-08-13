import { config } from './config.js';
import { log } from './logger.js';
import { run, runOrThrow } from './shell.js';
import type { Dossier, LogEvent } from './types.js';

/**
 * Fase 2 — abertura de Issue com dossie.
 *
 * Usa o `gh` CLI em vez da API REST direta para reaproveitar o login local,
 * sem precisar de um token extra em arquivo.
 */

export const LABELS = ['bug', 'auto-triagem', 'prod'] as const;

function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (config.github.token) env.GH_TOKEN = config.github.token;
  return env;
}

export async function ghAvailable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await run('gh', ['auth', 'status'], { env: ghEnv(), timeoutMs: 30_000 });
    if (result.code !== 0) return { ok: false, detail: (result.stderr || result.stdout).trim().slice(0, 200) };
    const scopes = /Token scopes:([^\n]*)/.exec(result.stdout + result.stderr)?.[1]?.trim() ?? '';
    return { ok: true, detail: scopes || 'autenticado' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Cria os labels do agente se ainda nao existirem (idempotente). */
export async function ensureLabels(): Promise<void> {
  const colors: Record<string, string> = {
    bug: 'd73a4a',
    'auto-triagem': '5319e7',
    prod: 'b60205',
  };
  for (const label of LABELS) {
    await run(
      'gh',
      [
        'label',
        'create',
        label,
        '--repo',
        config.github.repo,
        '--color',
        colors[label] ?? 'ededed',
        '--description',
        'Criado pelo agente de suporte autonomo',
      ],
      { env: ghEnv(), timeoutMs: 30_000 },
    );
  }
}

function fmtLog(event: LogEvent): string {
  const parts = [
    event.timestamp,
    event.severity.toUpperCase(),
    event.httpMethod && event.httpRoute ? `${event.httpMethod} ${event.httpRoute}` : event.eventAction,
    event.httpStatus != null ? `-> ${event.httpStatus}` : undefined,
    event.cervejariaSlug ? `[${event.cervejariaSlug}]` : undefined,
    event.message,
  ].filter(Boolean);
  return parts.join(' | ');
}

/** Corpo em markdown do dossie. E o insumo do fixer — a qualidade dele define tudo. */
export function issueBody(dossier: Dossier): string {
  const { alert, evidence, decision, fingerprint, suspects, kibanaLinks } = dossier;
  const lines: string[] = [];

  lines.push('## Sintoma');
  lines.push('');
  lines.push(`Regra Kibana **${alert.ruleName}** disparou em ${alert.timestamp}.`);
  if (alert.reason) lines.push('');
  if (alert.reason) lines.push(`> ${alert.reason}`);
  lines.push('');
  lines.push(`Classificacao da triagem: **${decision.kind}**`);
  if (decision.kind !== 'codigo') lines.push(`Motivo: ${decision.reason}`);
  lines.push('');

  lines.push('## Evidencia');
  lines.push('');
  lines.push(`- Janela analisada: \`${evidence.windowFrom}\` a \`${evidence.windowTo}\``);
  lines.push(`- Logs na janela: ${evidence.totalInWindow}`);
  lines.push(`- Falhas de servidor (5xx / error / outcome failure): ${evidence.serverFailureCount}`);
  lines.push(`- Erros 4xx no mesmo periodo: ${evidence.clientErrorCount} (contexto, nao bug)`);
  if (evidence.occurrences7d != null) {
    lines.push(`- Ocorrencias em 7 dias: ${evidence.occurrences7d}`);
  }
  if (evidence.firstSeen) lines.push(`- Primeira aparicao: \`${evidence.firstSeen}\``);
  if (evidence.traceId) lines.push(`- trace_id: \`${evidence.traceId}\``);
  lines.push('');

  if (evidence.gap) {
    lines.push('> [!WARNING]');
    lines.push(`> **Lacuna no enriquecimento:** ${evidence.gap}`);
    lines.push('');
  }

  if (evidence.byRoute.length) {
    lines.push('### Rotas com falha de servidor');
    lines.push('');
    for (const { route, count } of evidence.byRoute) lines.push(`- \`${route}\` — ${count}x`);
    lines.push('');
  }

  if (evidence.byTenant.length) {
    lines.push('### Tenants afetados');
    lines.push('');
    for (const { slug, count } of evidence.byTenant) lines.push(`- \`${slug}\` — ${count}x`);
    lines.push('');
  }

  if (evidence.byAction.length) {
    lines.push('### Acoes de evento');
    lines.push('');
    for (const { action, count } of evidence.byAction) lines.push(`- \`${action}\` — ${count}x`);
    lines.push('');
  }

  if (evidence.stack) {
    lines.push('### Stack trace');
    lines.push('');
    lines.push('```');
    lines.push(evidence.stack.split('\n').slice(0, 30).join('\n'));
    lines.push('```');
    lines.push('');
  } else {
    lines.push('### Stack trace');
    lines.push('');
    lines.push(
      '_Nenhum stack trace nos logs correlacionados._ Sem ele o ponto de partida no codigo ' +
        'vem apenas da rota HTTP, o que reduz a confianca de qualquer correcao automatica.',
    );
    lines.push('');
  }

  if (evidence.failures.length) {
    lines.push('### Logs de falha (servidor primeiro)');
    lines.push('');
    lines.push('```');
    for (const event of evidence.failures.slice(0, 10)) lines.push(fmtLog(event));
    lines.push('```');
    lines.push('');
  }

  if (suspects.length) {
    lines.push('## Arquivos suspeitos');
    lines.push('');
    for (const { path, why } of suspects) lines.push(`- \`${path}\` — ${why}`);
    lines.push('');
  }

  lines.push('## Links');
  lines.push('');
  if (kibanaLinks.alert) lines.push(`- [Alerta no Kibana](${kibanaLinks.alert})`);
  lines.push(`- [Logs da janela no Discover](${kibanaLinks.logs})`);
  if (kibanaLinks.trace) lines.push(`- [Trace no APM](${kibanaLinks.trace})`);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`<!-- quiver-fingerprint: ${fingerprint} -->`);
  lines.push(
    `Aberto automaticamente pelo agente de suporte (\`support-agent/\`). Fingerprint \`${fingerprint}\`.`,
  );

  return lines.join('\n');
}

export function issueTitle(dossier: Dossier): string {
  const { alert, evidence } = dossier;
  const focus =
    evidence.byRoute[0]?.route ??
    evidence.byAction[0]?.action ??
    evidence.failures[0]?.eventAction ??
    'sem rota identificada';
  return `[auto] ${alert.ruleName}: ${focus}`;
}

/** Issue aberta com o mesmo fingerprint, para nao duplicar. */
export async function findIssueByFingerprint(fingerprint: string): Promise<number | null> {
  const result = await run(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      config.github.repo,
      '--state',
      'open',
      '--label',
      'auto-triagem',
      '--limit',
      '100',
      '--json',
      'number,body',
    ],
    { env: ghEnv(), timeoutMs: 60_000 },
  );
  if (result.code !== 0) return null;
  try {
    const issues = JSON.parse(result.stdout) as { number: number; body: string }[];
    return issues.find((i) => i.body?.includes(`quiver-fingerprint: ${fingerprint}`))?.number ?? null;
  } catch {
    return null;
  }
}

export async function createIssue(dossier: Dossier): Promise<number> {
  const args = [
    'issue',
    'create',
    '--repo',
    config.github.repo,
    '--title',
    issueTitle(dossier),
    '--body',
    issueBody(dossier),
  ];
  for (const label of LABELS) args.push('--label', label);

  const result = await runOrThrow('gh', args, { env: ghEnv(), timeoutMs: 60_000 });
  const number = Number(/\/issues\/(\d+)/.exec(result.stdout)?.[1]);
  if (!Number.isFinite(number)) {
    throw new Error(`Nao foi possivel ler o numero da Issue criada: ${result.stdout.trim()}`);
  }
  return number;
}

export async function commentOnIssue(issueNumber: number, body: string): Promise<void> {
  await runOrThrow(
    'gh',
    ['issue', 'comment', String(issueNumber), '--repo', config.github.repo, '--body', body],
    { env: ghEnv(), timeoutMs: 60_000 },
  );
}

export async function createPullRequest(options: {
  branch: string;
  title: string;
  body: string;
}): Promise<number> {
  const result = await runOrThrow(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      config.github.repo,
      '--base',
      config.github.baseBranch,
      '--head',
      options.branch,
      '--title',
      options.title,
      '--body',
      options.body,
    ],
    { env: ghEnv(), timeoutMs: 90_000 },
  );
  const number = Number(/\/pull\/(\d+)/.exec(result.stdout)?.[1]);
  if (!Number.isFinite(number)) {
    throw new Error(`Nao foi possivel ler o numero do PR criado: ${result.stdout.trim()}`);
  }
  log.info('PR aberto', { pr: number, branch: options.branch });
  return number;
}

/** Issues abertas pelo agente que estao prontas para o fixer. */
export async function listTriagedIssues(): Promise<{ number: number; title: string; body: string }[]> {
  const result = await run(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      config.github.repo,
      '--state',
      'open',
      '--label',
      'auto-triagem',
      '--limit',
      '50',
      '--json',
      'number,title,body,labels',
    ],
    { env: ghEnv(), timeoutMs: 60_000 },
  );
  if (result.code !== 0) return [];
  try {
    const issues = JSON.parse(result.stdout) as {
      number: number;
      title: string;
      body: string;
      labels: { name: string }[];
    }[];
    // 'nao-corrigir' e a valvula manual: marcar a Issue impede o fixer de tentar
    return issues.filter((i) => !i.labels?.some((l) => l.name === 'nao-corrigir'));
  } catch {
    return [];
  }
}
