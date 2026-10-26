import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config, ROOT } from './config.mjs';
import { firstLine, run } from './exec.mjs';
import { isOnMain } from './collectors/git.mjs';
import { fetchPendingDeployments, fetchPr, reviewDeployment } from './collectors/github.mjs';
import { isMergeReady } from './state.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

export class ActionError extends Error {}

function powershellFile(script, args = [], timeoutMs = 90_000) {
  return run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'dev', script), ...args],
    { cwd: ROOT, timeoutMs },
  );
}

async function must(promise, what) {
  const result = await promise;
  if (result.code !== 0) throw new ActionError(`${what}: ${firstLine(result.stderr) || firstLine(result.stdout) || `código ${result.code}`}`);
  return result;
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ActionError(`${name} inválido`);
  return n;
}

async function devStart() {
  await must(powershellFile('supervisor.ps1'), 'Ligar DEV');
  return 'Supervisor do DEV iniciado; API e web sobem em alguns segundos.';
}

async function devStop() {
  await must(powershellFile('stop-dev.ps1'), 'Desligar DEV');
  return 'DEV desligado.';
}

async function review(params, state) {
  const runId = positiveInt(params.runId, 'runId');
  const pending = await fetchPendingDeployments(runId);
  if (!pending?.length) throw new ActionError('Esse run não está mais aguardando aprovação.');
  const ids = pending.map((p) => p.environment.id);
  const comment = state === 'approved' ? 'Aprovado pelo painel Ops' : 'Rejeitado pelo painel Ops';
  await reviewDeployment(runId, ids, state, comment);
  return state === 'approved' ? `Deploy aprovado (run ${runId}); a esteira segue sozinha.` : `Deploy rejeitado (run ${runId}).`;
}

/** Lista fechada: nome → { validate?, run }. Parâmetros vindos do browser são revalidados aqui. */
export const ACTIONS = {
  'dev.start': { label: 'Ligar DEV', run: devStart },
  'dev.stop': { label: 'Desligar DEV', run: devStop },
  'dev.restart': {
    label: 'Reiniciar DEV',
    run: async () => {
      await devStop();
      return devStart();
    },
  },
  'pr.merge': {
    label: 'Mergear PR',
    run: async (params) => {
      const number = positiveInt(params.number, 'PR');
      const pr = await fetchPr(number);
      if (!isMergeReady(pr)) {
        throw new ActionError(`PR #${number} não está pronto (CI ${pr.ci}, ${pr.mergeable}${pr.isDraft ? ', draft' : ''}).`);
      }
      await must(run('gh', ['pr', 'merge', String(number), '--repo', config.repo, '--squash'], { timeoutMs: 60_000 }), `Merge do PR #${number}`);
      return `PR #${number} mergeado. A esteira começa CI + build e para aguardando aprovação.`;
    },
  },
  'deploy.approve': { label: 'Aprovar deploy', run: (params) => review(params, 'approved') },
  'deploy.reject': { label: 'Rejeitar deploy', run: (params) => review(params, 'rejected') },
  'deploy.dispatch': {
    label: 'Publicar commit',
    run: async (params) => {
      const sha = params.sha ? String(params.sha) : '';
      if (sha && !SHA_RE.test(sha)) throw new ActionError('SHA inválido (40 hex).');
      if (sha && !(await isOnMain(sha))) throw new ActionError('Esse commit não pertence à main.');
      const head = (await run('git', ['rev-parse', 'origin/main'], { cwd: ROOT })).stdout.trim();
      const args = ['workflow', 'run', config.deployWorkflow, '--repo', config.repo, '--ref', 'main'];
      if (sha && sha !== head) args.push('-f', `sha=${sha}`);
      await must(run('gh', args, { timeoutMs: 30_000 }), 'Disparar a esteira');
      return `Esteira disparada para ${(sha || head).slice(0, 7)}; ela para aguardando sua aprovação.`;
    },
  },
};

export function audit(entry) {
  mkdirSync(dirname(config.auditLog), { recursive: true });
  appendFileSync(config.auditLog, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

export function readAudit(limit = 15) {
  if (!existsSync(config.auditLog)) return [];
  const lines = readFileSync(config.auditLog, 'utf8').trim().split(/\r?\n/).slice(-limit * 4);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.action)
    .slice(-limit)
    .reverse()
    .map((e) => ({ ...e, label: ACTIONS[e.action]?.label ?? e.action }));
}

let busy = null;

export async function executeAction(name, params = {}) {
  const action = ACTIONS[name];
  if (!action) throw new ActionError(`Ação desconhecida: ${name}`);
  if (busy) throw new ActionError(`Aguarde: "${busy}" ainda está em andamento.`);
  busy = action.label;
  try {
    const message = await action.run(params ?? {});
    audit({ action: name, params, ok: true, message });
    return message;
  } catch (error) {
    audit({ action: name, params, ok: false, message: error.message });
    throw error instanceof ActionError ? error : new ActionError(error.message);
  } finally {
    busy = null;
  }
}
