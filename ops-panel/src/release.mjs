import fs from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Gate de liberacao de release.
 *
 * O repositorio esta no plano Free do GitHub, que nao oferece branch protection. A
 * disciplina de "so vai para producao o que esta em origin/main com CI verde" e
 * garantida aqui, no caminho do botao de deploy, e nao pelo GitHub.
 *
 * Detalhe que dita o desenho: `deploy.ps1` compila a partir da working tree local,
 * nao de origin/main. Por isso o gate olha o HEAD local e se ha alteracao nao
 * commitada — sem isso, "deploy do main" publicaria codigo que ninguem revisou.
 */

// backend-build fica fora de proposito: tem continue-on-error no workflow enquanto os
// erros de tsc pre-existentes nao forem zerados, entao exigi-lo travaria todo deploy.
export const DEFAULT_REQUIRED_CHECKS = [
  'frontend',
  'backend-validate',
  'backend-test',
  'ops-panel-test',
];

export const OVERRIDE_CONFIRM = 'DEPLOY-SEM-GATE';

export function runGit(args, cwd, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, windowsHide: true });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(err.message || err) });
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: String(err.message || err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * Le JSON escrito pelo PowerShell. `Set-Content -Encoding UTF8` no PS 5.1 grava BOM,
 * e JSON.parse rejeita o BOM — sem remover, todo manifest de deploy parece inexistente.
 */
export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export function readManifest(manifestPath) {
  const raw = readJsonFile(manifestPath);
  if (!raw) return null;
  try {
    return {
      gitSha: raw.gitSha || null,
      deployedAt: raw.deployedAt || null,
      deploy: raw.deploy || null,
    };
  } catch {
    return null;
  }
}

export function readRollbackPoint(previousDir) {
  const available =
    fs.existsSync(`${previousDir}/frontend/index.html`) ||
    fs.existsSync(`${previousDir}/backend/dist/index.js`);

  if (!available) return { available: false };

  const meta = readJsonFile(`${previousDir}/rollback-point.json`);
  return {
    available: true,
    gitSha: meta?.gitSha || null,
    savedAt: meta?.savedAt || null,
    parts: meta?.parts || [],
  };
}

/** Le o ledger local; arquivo ausente ou corrompido nunca impede o Ops Panel. */
export function readReleaseHistory(historyPath, limit = 10) {
  if (!fs.existsSync(historyPath)) {
    return { exists: false, corrupted: false, events: [], lastDeploy: null, lastSuccessfulDeploy: null, lastRollback: null };
  }
  const raw = readJsonFile(historyPath);
  if (!raw || !Array.isArray(raw.events)) {
    return { exists: true, corrupted: true, events: [], lastDeploy: null, lastSuccessfulDeploy: null, lastRollback: null };
  }
  const events = raw.events
    .filter((event) => event && (event.type === 'DEPLOY' || event.type === 'ROLLBACK'))
    .map((event) => {
      const base = {
        id: typeof event.id === 'string' ? event.id.slice(0, 120) : null,
        type: event.type,
        startedAt: event.startedAt || null,
        finishedAt: event.finishedAt || null,
        durationSeconds: Number.isFinite(Number(event.durationSeconds)) ? Number(event.durationSeconds) : null,
        result: event.result || null,
        smoke: event.smoke || 'NOT_RUN',
        errorSummary: safeRecoveryText(event.errorSummary, null),
      };
      return event.type === 'DEPLOY'
        ? {
            ...base,
            gitSha: event.gitSha || null,
            gitShortSha: event.gitShortSha || null,
            previousGitSha: event.previousGitSha || null,
            backup: event.backup?.name ? { name: event.backup.name } : null,
            migrations: { executed: event.migrations?.executed === 'SIM' ? 'SIM' : 'NAO', appliedCount: event.migrations?.appliedCount ?? null },
            backfillExecuted: event.backfillExecuted === 'SIM' ? 'SIM' : 'NAO',
            finalPhase: event.finalPhase || null,
            rollbackAvailable: event.rollbackAvailable === 'SIM' ? 'SIM' : 'NAO',
          }
        : { ...base, removedGitSha: event.removedGitSha || null, restoredGitSha: event.restoredGitSha || null };
    });
  const newestFirst = [...events].reverse();
  return {
    exists: true,
    corrupted: false,
    events: newestFirst.slice(0, limit),
    lastDeploy: newestFirst.find((event) => event.type === 'DEPLOY') || null,
    lastSuccessfulDeploy: newestFirst.find((event) => event.type === 'DEPLOY' && event.result === 'SUCCESS') || null,
    lastRollback: newestFirst.find((event) => event.type === 'ROLLBACK') || null,
  };
}

function safeRecoveryText(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url-removida]')
    .replace(/(password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[removido]')
    .slice(0, 500);
}

/** Le o bloqueio persistente criado somente apos uma transicao de banco falhar. */
export function readDeployRecovery(recoveryPath) {
  if (!fs.existsSync(recoveryPath)) return { active: false };

  const raw = readJsonFile(recoveryPath);
  if (!raw || raw.active !== true) {
    return {
      active: true,
      failurePhase: 'UNKNOWN',
      failureReason: 'Arquivo de recovery ilegivel ou incompleto. Intervencao manual necessaria.',
    };
  }

  return {
    active: true,
    recordedAt: raw.recordedAt || null,
    deployStartedAt: raw.deployStartedAt || null,
    failedAt: raw.failedAt || null,
    failurePhase: raw.failurePhase || 'UNKNOWN',
    failureReason: safeRecoveryText(raw.failureReason, 'Falha sem resumo. Consulte o log do deploy.'),
    previousRelease: {
      gitSha: raw.previousRelease?.gitSha || null,
      deployedAt: raw.previousRelease?.deployedAt || null,
    },
    candidateRelease: { gitSha: raw.candidateRelease?.gitSha || null },
    backup: raw.backup
      ? { name: raw.backup.name || null, createdAt: raw.backup.createdAt || null, relativePath: raw.backup.relativePath || null }
      : null,
    migration: {
      started: raw.migration?.started === true,
      completed: raw.migration?.completed === true,
    },
    backfill: {
      started: raw.backfill?.started === true,
      completed: raw.backfill?.completed === true,
    },
    swap: {
      started: raw.swap?.started === true,
      completed: raw.swap?.completed === true,
    },
    watchdog: { paused: raw.watchdog?.paused === true },
  };
}

/** Agrega os check-runs de um commit num unico veredito por nome de check. */
export function summarizeChecks(checkRuns) {
  const byName = new Map();
  for (const run of checkRuns || []) {
    const name = run.name;
    const previous = byName.get(name);
    // GitHub pode ter varias execucoes do mesmo check (re-run); vale a mais recente.
    if (previous && previous.startedAt >= (run.started_at || '')) continue;
    byName.set(name, {
      name,
      status: run.status,
      conclusion: run.conclusion || null,
      url: run.html_url || null,
      startedAt: run.started_at || '',
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function checkVerdict(check) {
  if (!check) return 'ausente';
  if (check.status !== 'completed') return 'rodando';
  if (check.conclusion === 'success') return 'sucesso';
  if (check.conclusion === 'skipped' || check.conclusion === 'neutral') return 'ignorado';
  return 'falhou';
}

/**
 * Decide se o repositorio local deve ser alinhado com origin/main automaticamente.
 * Funcao pura — testavel sem executar git.
 */
export function shouldAutoSyncMain(state) {
  if (!state.gitAvailable) return false;
  if (state.workingTreeDirty) return false;
  if (!state.originMain?.sha) return false;

  const branch = state.head?.branch || '';
  const behind = state.behindOriginMain || 0;
  const ahead = state.aheadOriginMain || 0;
  const onMain = branch === 'main';

  if (onMain && ahead > 0) return false;
  if (onMain && behind === 0 && ahead === 0 && state.headOnOriginMain) return false;

  return branch !== 'main' || behind > 0 || !state.headOnOriginMain;
}

/**
 * Executa checkout main + pull --ff-only quando shouldAutoSyncMain permitir.
 * Chamado ao verificar release e antes do deploy.
 */
export async function tryAutoSyncLocalMain(projectRoot, state) {
  if (!shouldAutoSyncMain(state)) {
    return { attempted: false, performed: false };
  }

  const previousBranch = state.head?.branch;
  const previousSha = state.head?.sha;

  const fetch = await runGit(['fetch', 'origin', 'main', '--quiet'], projectRoot, 60_000);
  if (!fetch.ok) {
    return {
      attempted: true,
      performed: false,
      previousBranch,
      previousSha,
      error: fetch.stderr || 'git fetch origin main falhou',
    };
  }

  if (previousBranch !== 'main') {
    const checkout = await runGit(['checkout', 'main'], projectRoot);
    if (!checkout.ok) {
      return {
        attempted: true,
        performed: false,
        previousBranch,
        previousSha,
        error: checkout.stderr || 'git checkout main falhou',
      };
    }
  }

  const pull = await runGit(['pull', '--ff-only', 'origin', 'main'], projectRoot, 60_000);
  if (!pull.ok) {
    return {
      attempted: true,
      performed: false,
      previousBranch,
      previousSha,
      error: pull.stderr || 'git pull --ff-only origin main falhou',
    };
  }

  const newHead = await runGit(['rev-parse', 'HEAD'], projectRoot);
  return {
    attempted: true,
    performed: true,
    previousBranch,
    previousSha,
    newSha: newHead.ok ? newHead.stdout : undefined,
  };
}

/** Coleta estado git e tenta alinhar main com origin/main quando seguro. */
export async function collectGitStateWithAutoSync(projectRoot, deployedSha) {
  let git = await collectGitState(projectRoot, deployedSha);
  if (!git.gitAvailable) {
    return { git, sync: { attempted: false, performed: false } };
  }

  const sync = await tryAutoSyncLocalMain(projectRoot, git);
  if (sync.performed) {
    git = await collectGitState(projectRoot, deployedSha);
  }

  return { git, sync };
}

/**
 * Decide se o deploy pode rodar. Funcao pura: recebe os fatos ja coletados e
 * devolve os impedimentos, para que a regra seja testavel sem git nem rede.
 */
export function evaluateReleaseGate(state, options = {}) {
  const requiredChecks = options.requiredChecks || DEFAULT_REQUIRED_CHECKS;
  const blockers = [];
  const warnings = [];

  if (state.recovery?.active) {
    blockers.push({
      code: 'recovery-manual-required',
      message:
        `INTERVENCAO MANUAL NECESSARIA: producao esta em recovery (${state.recovery.failurePhase || 'UNKNOWN'}). ` +
        'Valide banco e artefatos conforme deploy/RECOVERY.md antes de liberar o watchdog.',
      overridable: false,
    });
  }

  if (!state.gitAvailable) {
    blockers.push({
      code: 'git-indisponivel',
      message: 'Nao foi possivel ler o repositorio git local. Deploy bloqueado por falta de procedencia.',
      overridable: false,
    });
    return { allowed: false, overridden: false, blockers, warnings, requiredChecks };
  }

  if (!state.originMain?.sha) {
    blockers.push({
      code: 'origin-desconhecido',
      message:
        'origin/main nao pode ser lido (git fetch falhou?). Sem isso nao ha como provar que o codigo foi revisado.',
      overridable: true,
    });
  }

  if (state.originMain?.sha && !state.headOnOriginMain) {
    blockers.push({
      code: 'head-fora-do-main',
      message:
        `O commit local (${short(state.head?.sha)}, branch ${state.head?.branch || '?'}) nao esta em origin/main. ` +
        'Faca merge do PR antes de publicar.',
      overridable: true,
    });
  }

  if (state.workingTreeDirty) {
    const lista = (state.dirtyFiles || []).slice(0, 5).join(', ');
    const sufixo = lista ? ` Arquivos: ${lista}${state.dirtyCount > 5 ? '…' : ''}.` : '';
    blockers.push({
      code: 'working-tree-suja',
      message:
        `Ha ${state.dirtyCount} arquivo(s) alterado(s) e nao commitado(s). O deploy compila a working tree, ` +
        `ou seja, publicaria codigo que nao esta em nenhum commit.${sufixo}`,
      overridable: true,
    });
  }

  if (state.checksConfigured === false) {
    // Sem token nao ha como provar que o CI passou, e "nao sei" nao pode virar "pode ir".
    blockers.push({
      code: 'ci-nao-verificavel',
      message:
        'GITHUB_TOKEN nao configurado em ops-panel/.env: nao ha como verificar o CI deste commit.',
      overridable: true,
    });
  } else if (state.checksError) {
    blockers.push({
      code: 'ci-nao-verificavel',
      message: `Falha ao consultar os checks no GitHub: ${state.checksError}`,
      overridable: true,
    });
  }

  for (const name of state.checksConfigured === false ? [] : requiredChecks) {
    const check = state.checks?.find((c) => c.name === name);
    const verdict = checkVerdict(check);
    if (verdict === 'sucesso' || verdict === 'ignorado') continue;
    blockers.push({
      code: `check-${verdict}`,
      message:
        verdict === 'ausente'
          ? `O check \`${name}\` nao rodou para ${short(state.head?.sha)}.`
          : verdict === 'rodando'
            ? `O check \`${name}\` ainda esta rodando. Aguarde o CI terminar.`
            : `O check \`${name}\` falhou (${check.conclusion}).`,
      overridable: true,
    });
  }

  if (state.migrationsChanged?.length && !options.acknowledgeMigrations) {
    blockers.push({
      code: 'migrations-sem-confirmacao',
      message:
        `${state.migrationsChanged.length} migration(s) entram neste deploy. Confirme explicitamente, ` +
        'porque migration aplicada nao volta com rollback de artefato.',
      overridable: true,
    });
  }

  if (!state.deployed?.gitSha) {
    warnings.push(
      'Sem manifest em prod-artifacts: nao da para listar o que ja esta publicado nem detectar migrations novas. ' +
        'O primeiro deploy por aqui passa a preencher isso.',
    );
  }

  if (state.pendingError) {
    warnings.push(state.pendingError);
  }

  if (!state.pending?.length && state.deployed?.gitSha) {
    warnings.push(
      `Nenhum commit novo em relacao ao que esta publicado (${state.deployed.gitSha}). O deploy vai republicar o mesmo codigo.`,
    );
  }

  if (state.behindOriginMain > 0) {
    warnings.push(
      `O HEAD local esta ${state.behindOriginMain} commit(s) atras de origin/main — voce publicaria codigo mais antigo que o main.`,
    );
  }

  if (state.pending?.some((c) => c.fromAgent)) {
    warnings.push('Ha commit escrito por agente automatico neste deploy. Confira a causa raiz, nao apenas o CI verde.');
  }

  const overridden = Boolean(options.override) && blockers.every((b) => b.overridable);
  return {
    allowed: blockers.length === 0 || overridden,
    overridden: overridden && blockers.length > 0,
    blockers,
    warnings,
    requiredChecks,
  };
}

function short(sha) {
  return typeof sha === 'string' ? sha.slice(0, 7) : '?';
}

/** Coleta os fatos de git. Nao acessa rede alem do `git fetch`. */
export async function collectGitState(projectRoot, deployedSha) {
  const head = await runGit(['rev-parse', 'HEAD'], projectRoot);
  if (!head.ok) {
    return { gitAvailable: false, error: head.stderr || 'git rev-parse falhou' };
  }

  const [branch, subject, status, fetch] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot),
    runGit(['log', '-1', '--pretty=%an%x1f%aI%x1f%s'], projectRoot),
    runGit(['status', '--porcelain'], projectRoot),
    runGit(['fetch', 'origin', 'main', '--quiet'], projectRoot, 60_000),
  ]);

  const originMain = await runGit(['rev-parse', 'origin/main'], projectRoot);
  const [author = '', date = '', message = ''] = (subject.stdout || '').split('\u001f');

  const dirtyLines = (status.stdout || '').split('\n').filter((l) => l.trim());
  const dirtyFiles = dirtyLines.map((line) => line.slice(3).trim()).filter(Boolean);
  const headOnOriginMain = originMain.ok
    ? (await runGit(['merge-base', '--is-ancestor', head.stdout, 'origin/main'], projectRoot)).ok
    : false;

  const behind = originMain.ok
    ? await runGit(['rev-list', '--count', `${head.stdout}..origin/main`], projectRoot)
    : { ok: false, stdout: '0' };

  const ahead = originMain.ok
    ? await runGit(['rev-list', '--count', `origin/main..${head.stdout}`], projectRoot)
    : { ok: false, stdout: '0' };

  const pending = deployedSha
    ? await listPendingCommits(projectRoot, deployedSha, head.stdout)
    : { commits: [], error: null };

  const migrations = deployedSha
    ? await runGit(
        ['diff', '--name-only', `${deployedSha}..${head.stdout}`, '--', 'backend/prisma/migrations'],
        projectRoot,
      )
    : { ok: true, stdout: '' };

  return {
    gitAvailable: true,
    head: { sha: head.stdout, branch: branch.stdout, author, date, message },
    workingTreeDirty: dirtyLines.length > 0,
    dirtyCount: dirtyLines.length,
    dirtyFiles,
    originMain: {
      sha: originMain.ok ? originMain.stdout : null,
      fetchOk: fetch.ok,
      fetchError: fetch.ok ? null : fetch.stderr,
    },
    headOnOriginMain,
    behindOriginMain: Number(behind.stdout || 0) || 0,
    aheadOriginMain: Number(ahead.stdout || 0) || 0,
    pending: pending.commits,
    pendingError: pending.error,
    migrationsChanged: (migrations.stdout || '').split('\n').filter((l) => l.trim()),
  };
}

async function listPendingCommits(projectRoot, fromSha, headSha) {
  const exists = await runGit(['cat-file', '-e', `${fromSha}^{commit}`], projectRoot);
  if (!exists.ok) {
    return {
      commits: [],
      error: `O commit publicado (${fromSha}) nao existe neste repositorio local — nao da para listar o que esta pendente.`,
    };
  }

  const log = await runGit(
    ['log', '--pretty=%H%x1f%an%x1f%aI%x1f%s', `${fromSha}..${headSha}`],
    projectRoot,
  );
  if (!log.ok) return { commits: [], error: log.stderr };

  const commits = (log.stdout || '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, author, date, message] = line.split('\u001f');
      return { sha, shortSha: sha.slice(0, 7), author, date, message };
    });

  return { commits, error: null };
}
