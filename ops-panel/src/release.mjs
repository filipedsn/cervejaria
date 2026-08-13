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
  'support-agent-test',
  'ops-panel-test',
];

export const OVERRIDE_CONFIRM = 'DEPLOY-SEM-GATE';

const AGENT_BRANCH_RE = /^fix\/auto-\d+$/;

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

export function isAgentBranch(branch) {
  return typeof branch === 'string' && AGENT_BRANCH_RE.test(branch);
}

/**
 * Decide se o deploy pode rodar. Funcao pura: recebe os fatos ja coletados e
 * devolve os impedimentos, para que a regra seja testavel sem git nem rede.
 */
export function evaluateReleaseGate(state, options = {}) {
  const requiredChecks = options.requiredChecks || DEFAULT_REQUIRED_CHECKS;
  const blockers = [];
  const warnings = [];

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
