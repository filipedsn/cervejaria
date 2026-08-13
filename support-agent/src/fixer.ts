import path from 'node:path';

import { canAttemptFix } from './circuit-breaker.js';
import { config } from './config.js';
import { commentOnIssue, createPullRequest, listTriagedIssues } from './github.js';
import { killSwitchActive } from './killswitch.js';
import { log } from './logger.js';
import * as metrics from './metrics.js';
import { checkChangedPaths, policyPromptSection } from './policy.js';
import { run } from './shell.js';
import { incrementPrsOpened, loadState, recordCliRun, saveState, upsertFingerprint } from './state.js';
import {
  changedPaths,
  commitAll,
  createWorktree,
  diffSummary,
  installDependencies,
  pushBranch,
  removeWorktree,
} from './worktree.js';

/**
 * Fase 3 — correcao automatica.
 *
 * Ordem inegociavel: worktree isolado, Cursor CLI headless, verificacao executavel,
 * checagem de policy de caminhos, e so entao PR. Se qualquer etapa falhar, o agente
 * comenta o diagnostico na Issue e nao abre PR. Um PR que nao passa nos testes gera
 * mais trabalho para o revisor do que nao existir.
 */

const FINGERPRINT_RE = /quiver-fingerprint:\s*([^\s>]+)/;

export type FixOutcome =
  | { status: 'pr-aberto'; prNumber: number; durationMs: number }
  | { status: 'sem-mudanca'; durationMs: number }
  | { status: 'verificacao-falhou'; detail: string; durationMs: number }
  | { status: 'policy-violada'; detail: string; durationMs: number }
  | { status: 'bloqueado'; detail: string }
  | { status: 'erro'; detail: string; durationMs: number };

function buildPrompt(issueNumber: number, issueBody: string): string {
  return [
    `Voce esta corrigindo o bug descrito na Issue #${issueNumber} do Quiver Tap.`,
    '',
    'DOSSIE DA ISSUE:',
    '---',
    issueBody,
    '---',
    '',
    'Siga a skill `.cursor/skills/quiver-tap-bugfix/SKILL.md` deste repositorio.',
    '',
    'PROCEDIMENTO OBRIGATORIO:',
    '1. Leia os arquivos suspeitos e entenda a causa raiz antes de editar qualquer linha.',
    '2. Escreva primeiro um teste que FALHA por causa do bug, em `backend/src/**/*.test.ts`,',
    '   usando `node --test` e (quando fizer sentido) `fast-check`. Registre o teste em',
    '   `test:unit` no `backend/package.json` se for arquivo novo.',
    '3. Corrija a causa raiz — nao mascare o sintoma com try/catch nem com valor default.',
    '4. Rode `npm run test:unit --prefix backend` e garanta que passa.',
    '5. Explique a causa raiz em uma frase no final.',
    '',
    'SE VOCE NAO IDENTIFICAR A CAUSA RAIZ COM CONFIANCA, PARE.',
    'Escreva "NAO CONSEGUI DIAGNOSTICAR" e explique o que faltou no dossie.',
    'Nao invente uma correcao plausivel — um PR errado custa mais caro que nenhum PR.',
    '',
    policyPromptSection(),
  ].join('\n');
}

type CursorRun = {
  code: number;
  /** Texto do agente: `result` do evento terminal, ou a concatenacao das mensagens. */
  output: string;
  durationMs: number;
  isError: boolean;
  timedOut: boolean;
};

/**
 * Le o NDJSON do `--output-format stream-json`.
 *
 * O formato emite eventos `system`, `user`, `assistant`, `tool_call` e um `result`
 * terminal. Nao ha evento de custo nem contagem de tokens — por isso o controle de
 * gasto e por numero de execucoes, nao por preco (ver circuit-breaker.ts).
 */
export function parseCursorStream(lines: string[]): Omit<CursorRun, 'code' | 'timedOut'> {
  const messages: string[] = [];
  let finalText = '';
  let durationMs = 0;
  let isError = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (event.type === 'result') {
      if (typeof event.result === 'string') finalText = event.result;
      if (typeof event.duration_ms === 'number') durationMs = event.duration_ms;
      if (event.is_error === true || event.subtype === 'error') isError = true;
      continue;
    }

    if (event.type !== 'assistant') continue;
    // Com --stream-partial-output o mesmo texto aparece em flushes duplicados; sem a
    // flag ha um evento por mensagem completa, que e o que usamos.
    if (event.model_call_id != null) continue;
    const content = (event.message as Record<string, unknown> | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as Record<string, unknown>)?.text;
      if (typeof text === 'string' && text) messages.push(text);
    }
  }

  return { output: finalText || messages.join('\n'), durationMs, isError };
}

async function runCursorAgent(worktreeDir: string, prompt: string): Promise<CursorRun> {
  const lines: string[] = [];

  const args = [
    '--print',
    '--force',
    // headless: aceita o workspace sem prompt de confianca
    '--trust',
    '--workspace',
    worktreeDir,
    '--output-format',
    'stream-json',
  ];
  if (config.fixer.model) args.push('--model', config.fixer.model);
  args.push(prompt);

  const result = await run(config.fixer.cliBin, args, {
    cwd: worktreeDir,
    timeoutMs: config.fixer.timeoutMs,
    env: {
      ...process.env,
      // O hook block-prod-without-approval escala 'ask' para 'deny' com esta variavel.
      QUIVER_AGENT_HEADLESS: '1',
    },
    onStdoutLine: (line) => lines.push(line),
  });

  const parsed = parseCursorStream(lines);
  return {
    code: result.code,
    output: parsed.output || (result.stderr || result.stdout).slice(-4000),
    durationMs: parsed.durationMs,
    isError: parsed.isError,
    timedOut: result.timedOut,
  };
}

/** Preflight: sem o CLI instalado, o fixer nao tem como funcionar. */
export async function cursorCliAvailable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await run(config.fixer.cliBin, ['--version'], { timeoutMs: 30_000 });
    if (result.code !== 0) return { ok: false, detail: (result.stderr || result.stdout).trim().slice(0, 200) };
    return { ok: true, detail: result.stdout.trim() };
  } catch (err) {
    const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ok: false,
      detail: notFound
        ? `\`${config.fixer.cliBin}\` nao encontrado no PATH. Instale o Cursor CLI ou ajuste SUPPORT_AGENT_CURSOR_BIN.`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

type Verification = { ok: boolean; detail: string };

async function verify(worktreeDir: string): Promise<Verification> {
  const steps: { label: string; command: string; args: string[]; cwd: string }[] = [
    {
      label: 'test:unit',
      command: 'npm',
      args: ['run', 'test:unit'],
      cwd: path.join(worktreeDir, 'backend'),
    },
    {
      label: 'ci:validate',
      command: 'npm',
      args: ['run', 'ci:validate'],
      cwd: worktreeDir,
    },
  ];

  for (const step of steps) {
    log.info(`Verificando: ${step.label}`);
    const result = await run(step.command, step.args, { cwd: step.cwd, timeoutMs: 15 * 60_000 });
    if (result.code !== 0) {
      const tail = (result.stdout + result.stderr).trim().split('\n').slice(-40).join('\n');
      return { ok: false, detail: `\`${step.label}\` falhou (exit ${result.code}):\n\n\`\`\`\n${tail}\n\`\`\`` };
    }
  }

  return { ok: true, detail: 'test:unit e ci:validate passaram' };
}

/**
 * O agente precisa ter escrito ao menos um teste. Sem teste novo nao ha prova de que
 * o bug foi reproduzido, e a correcao e so uma afirmacao.
 */
export function hasNewTest(paths: readonly string[]): boolean {
  return paths.some((p) => /\.(test|spec)\.ts$/.test(p));
}

export async function fixIssue(issueNumber: number, issueBody: string): Promise<FixOutcome> {
  const fingerprint = FINGERPRINT_RE.exec(issueBody)?.[1] ?? `issue-${issueNumber}`;

  let state = loadState();
  const breaker = canAttemptFix(state, fingerprint);
  if (!breaker.allowed) {
    metrics.record('support_agent.circuit_breaker_acionado', 1, { motivo: 'limite' });
    log.warn('Circuit breaker impediu a tentativa', { issue: issueNumber, reason: breaker.reason });
    return { status: 'bloqueado', detail: breaker.reason };
  }

  state = upsertFingerprint(state, fingerprint, {
    fixAttempts: (state.fingerprints[fingerprint]?.fixAttempts ?? 0) + 1,
  });
  saveState(state);
  metrics.record('support_agent.fix_tentativas', 1, {});

  let worktree: Awaited<ReturnType<typeof createWorktree>> | null = null;
  let durationMs = 0;

  try {
    worktree = await createWorktree(issueNumber);
    log.info('Worktree criado', { dir: worktree.dir, branch: worktree.branch });

    await installDependencies(worktree.dir);

    const agentRun = await runCursorAgent(worktree.dir, buildPrompt(issueNumber, issueBody));
    durationMs = agentRun.durationMs;
    state = recordCliRun(loadState(), durationMs);
    saveState(state);
    metrics.record('support_agent.cli_execucoes', 1, {});

    if (agentRun.timedOut) {
      return { status: 'erro', detail: `O CLI excedeu ${config.fixer.timeoutMs / 60_000} min.`, durationMs };
    }

    if (agentRun.isError || agentRun.code !== 0) {
      return {
        status: 'erro',
        detail: `O CLI terminou com erro (exit ${agentRun.code}):\n\n${agentRun.output.slice(-2000)}`,
        durationMs,
      };
    }

    if (/NAO CONSEGUI DIAGNOSTICAR/i.test(agentRun.output)) {
      return {
        status: 'verificacao-falhou',
        detail: `O agente declarou que nao conseguiu diagnosticar:\n\n${agentRun.output.slice(-2000)}`,
        durationMs,
      };
    }

    const changed = await changedPaths(worktree.dir);
    if (!changed.length) {
      return { status: 'sem-mudanca', durationMs };
    }

    const violations = checkChangedPaths(changed);
    if (violations.length) {
      metrics.record('support_agent.prs_bloqueados_por_policy', 1, {});
      const detail = violations.map((v) => `- \`${v.path}\`: ${v.reason}`).join('\n');
      return { status: 'policy-violada', detail, durationMs };
    }

    if (!hasNewTest(changed)) {
      return {
        status: 'verificacao-falhou',
        detail:
          'Nenhum arquivo de teste foi criado ou alterado. A correcao precisa vir com um teste ' +
          'que falha antes e passa depois — sem isso nao ha prova de que o bug foi reproduzido.\n\n' +
          `Arquivos alterados:\n${changed.map((p) => `- \`${p}\``).join('\n')}`,
        durationMs,
      };
    }

    const verification = await verify(worktree.dir);
    if (!verification.ok) {
      metrics.record('support_agent.fix_falhou_verificacao', 1, {});
      return { status: 'verificacao-falhou', detail: verification.detail, durationMs };
    }

    const stat = await diffSummary(worktree.dir);
    await commitAll(
      worktree.dir,
      `fix: corrige ${fingerprint} (#${issueNumber})\n\nCorrecao automatica gerada pelo agente de suporte.\nVerificado com test:unit e ci:validate.\n\nCloses #${issueNumber}`,
    );
    await pushBranch(worktree.dir, worktree.branch);

    const prNumber = await createPullRequest({
      branch: worktree.branch,
      title: `fix: ${fingerprint} (#${issueNumber})`,
      body: prBody(issueNumber, fingerprint, stat, verification.detail, durationMs),
    });

    state = incrementPrsOpened(loadState());
    state = upsertFingerprint(state, fingerprint, {
      prNumbers: [...(state.fingerprints[fingerprint]?.prNumbers ?? []), prNumber],
    });
    saveState(state);
    metrics.record('support_agent.prs_abertos', 1, {});

    return { status: 'pr-aberto', prNumber, durationMs };
  } catch (err) {
    return { status: 'erro', detail: err instanceof Error ? err.message : String(err), durationMs };
  } finally {
    if (worktree) {
      await removeWorktree(worktree.dir).catch((err) =>
        log.warn('Falha ao remover worktree', { dir: worktree?.dir, err: String(err) }),
      );
    }
  }
}

function prBody(
  issueNumber: number,
  fingerprint: string,
  stat: string,
  verification: string,
  durationMs: number,
): string {
  return [
    `Correcao automatica para a Issue #${issueNumber}.`,
    '',
    '## Verificacao executada',
    '',
    `- ${verification}`,
    '- Teste de regressao incluido no diff',
    '',
    '## Diff',
    '',
    '```',
    stat || '(sem estatistica)',
    '```',
    '',
    '## Procedencia',
    '',
    `- Fingerprint: \`${fingerprint}\``,
    `- Gerado por: agente de suporte autonomo (\`support-agent/\`)`,
    `- Tempo de geracao: ${(durationMs / 1000).toFixed(1)}s`,
    '',
    '> [!IMPORTANT]',
    '> Este PR foi escrito por um agente. Revise a causa raiz, nao apenas se os testes passam.',
    '> O deploy em producao continua sendo liberado manualmente no ops-panel `:3099`.',
    '',
    `Closes #${issueNumber}`,
  ].join('\n');
}

/** Processa uma lista de Issues elegiveis, respeitando os circuit breakers. */
export async function runFixerForIssues(issueNumbers: number[]): Promise<void> {
  const cli = await cursorCliAvailable();
  if (!cli.ok) {
    log.error('Cursor CLI indisponivel — nenhuma correcao sera tentada', { detail: cli.detail });
    return;
  }
  log.info('Cursor CLI disponivel', { versao: cli.detail });

  const issues = await listTriagedIssues();
  const targets = issues.filter((i) => issueNumbers.includes(i.number));

  for (const issue of targets) {
    // Reconsultado a cada Issue: uma correcao leva minutos, e o operador precisa poder
    // interromper a fila sem matar o agente.
    const kill = killSwitchActive();
    if (kill.active) {
      log.warn('Kill switch acionado durante a fila — correcoes restantes abortadas', {
        motivo: kill.reason,
        restantes: targets.slice(targets.indexOf(issue)).map((i) => i.number),
      });
      break;
    }

    log.info('Iniciando correcao', { issue: issue.number, titulo: issue.title });
    const outcome = await fixIssue(issue.number, issue.body);
    log.info('Correcao finalizada', { issue: issue.number, status: outcome.status });
    await reportOutcome(issue.number, outcome);
  }

  await metrics.flush();
}

async function reportOutcome(issueNumber: number, outcome: FixOutcome): Promise<void> {
  if (outcome.status === 'pr-aberto') {
    await commentOnIssue(
      issueNumber,
      `PR automatico aberto: #${outcome.prNumber}. Verificacao (\`test:unit\` + \`ci:validate\`) passou. ` +
        `Tempo de geracao: ${(outcome.durationMs / 1000).toFixed(1)}s.`,
    ).catch(() => undefined);
    return;
  }

  const header: Record<Exclude<FixOutcome['status'], 'pr-aberto'>, string> = {
    'sem-mudanca': 'O agente rodou e nao alterou nenhum arquivo.',
    'verificacao-falhou': '**Nenhum PR foi aberto: a verificacao nao passou.**',
    'policy-violada': '**Nenhum PR foi aberto: o agente tentou alterar arquivos fora do escopo.**',
    bloqueado: '**Correcao nao tentada: circuit breaker acionado.**',
    erro: '**A tentativa de correcao falhou com erro.**',
  };

  const detail = 'detail' in outcome ? outcome.detail : '';
  const tempo =
    'durationMs' in outcome
      ? `\n\nTempo da tentativa: ${(outcome.durationMs / 1000).toFixed(1)}s.`
      : '';

  await commentOnIssue(
    issueNumber,
    `${header[outcome.status]}\n\n${detail}${tempo}\n\nEsta Issue continua aberta para analise humana.`,
  ).catch(() => undefined);
}
