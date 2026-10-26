import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config, ROOT } from './config.mjs';
import { firstLine, run } from './exec.mjs';
import { isOnMain } from './collectors/git.mjs';
import { fetchPendingDeployments, fetchPr, reviewDeployment } from './collectors/github.mjs';
import { isMergeReady, needsUpdate } from './state.mjs';

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
  await must(powershellFile('supervisor.ps1'), 'Ligar o ambiente de testes');
  return 'Ambiente de testes ligando; fica pronto em cerca de 30 segundos.';
}

async function devSync() {
  await must(powershellFile('sync-dev-main.ps1', [], 600_000), 'Trazer a versão oficial');
  return 'Ambiente de testes atualizado com a versão oficial; fica pronto em cerca de 30 segundos.';
}

export const COPY_PRD_WORD = 'COPIAR';

async function devCopyPrd(params) {
  if (params.confirm !== COPY_PRD_WORD) throw new ActionError(`Para confirmar, digite ${COPY_PRD_WORD}.`);
  const result = await must(powershellFile('copy-prd-to-dev.ps1', [], 900_000), 'Copiar o banco do site');
  const m = result.stdout.match(/PRD_COPY_OK tables=(\d+) rows=(\d+)/);
  const detail = m ? ` (${m[1]} tabelas, ${Number(m[2]).toLocaleString('pt-BR')} linhas)` : '';
  return `Banco do site copiado para o ambiente de testes${detail}. Na cópia, e-mail e notificações ficam desligados. Pronto em cerca de 30 segundos.`;
}

async function devStop() {
  await must(powershellFile('stop-dev.ps1'), 'Desligar o ambiente de testes');
  return 'Ambiente de testes desligado.';
}

async function review(params, state) {
  const runId = positiveInt(params.runId, 'runId');
  const pending = await fetchPendingDeployments(runId);
  if (!pending?.length) throw new ActionError('Essa versão não está mais esperando autorização. Clique em Recarregar no topo.');
  const ids = pending.map((p) => p.environment.id);
  const comment = state === 'approved' ? 'Aprovado pelo painel Ops' : 'Rejeitado pelo painel Ops';
  await reviewDeployment(runId, ids, state, comment);
  return state === 'approved'
    ? 'Publicação autorizada. A nova versão fica no ar em 1 a 3 minutos.'
    : 'Publicação recusada. O site dos clientes continua na versão atual.';
}

/** Lista fechada: nome → { validate?, run }. Parâmetros vindos do browser são revalidados aqui. */
export const ACTIONS = {
  'dev.start': { label: 'Ligar o ambiente de testes', run: devStart },
  'dev.stop': { label: 'Desligar o ambiente de testes', run: devStop },
  'dev.sync': { label: 'Trazer a versão oficial para o ambiente de testes', run: devSync },
  'dev.copyPrd': { label: 'Copiar o banco do site para o ambiente de testes', run: devCopyPrd },
  'dev.restart': {
    label: 'Reiniciar o ambiente de testes',
    run: async () => {
      await devStop();
      return devStart();
    },
  },
  'pr.merge': {
    label: 'Aceitar PR',
    run: async (params) => {
      const number = positiveInt(params.number, 'PR');
      const pr = await fetchPr(number);
      if (needsUpdate(pr)) throw new ActionError(`O PR #${number} precisa ser atualizado antes. Use o botão Atualizar do PR.`);
      if (!isMergeReady(pr)) {
        throw new ActionError(`O PR #${number} ainda não pode ser aceito (testes: ${pr.ci}, ${pr.mergeable}${pr.isDraft ? ', rascunho' : ''}).`);
      }
      await must(run('gh', ['pr', 'merge', String(number), '--repo', config.repo, '--squash'], { timeoutMs: 60_000 }), `Aceitar o PR #${number}`);
      return `PR #${number} aceito. A esteira começou a testar e vai pedir sua autorização em alguns minutos.`;
    },
  },
  'pr.update': {
    label: 'Atualizar PR',
    run: async (params) => {
      const number = positiveInt(params.number, 'PR');
      const pr = await fetchPr(number);
      if (!needsUpdate(pr)) throw new ActionError(`O PR #${number} não precisa ser atualizado agora. Clique em Recarregar no topo.`);
      await must(run('gh', ['pr', 'update-branch', String(number), '--repo', config.repo], { timeoutMs: 60_000 }), `Atualizar o PR #${number}`);
      return `PR #${number} atualizado. Os testes rodam de novo (1 a 3 minutos); depois aparece o botão para aceitar.`;
    },
  },
  'deploy.approve': { label: 'Autorizar publicação', run: (params) => review(params, 'approved') },
  'deploy.reject': { label: 'Recusar publicação', run: (params) => review(params, 'rejected') },
  'deploy.dispatch': {
    label: 'Iniciar a esteira',
    run: async (params) => {
      const sha = params.sha ? String(params.sha) : '';
      if (sha && !SHA_RE.test(sha)) throw new ActionError('Versão inválida (SHA de 40 caracteres).');
      if (sha && !(await isOnMain(sha))) throw new ActionError('Essa versão não faz parte da versão oficial (main).');
      const head = (await run('git', ['rev-parse', 'origin/main'], { cwd: ROOT })).stdout.trim();
      const args = ['workflow', 'run', config.deployWorkflow, '--repo', config.repo, '--ref', 'main'];
      if (sha && sha !== head) args.push('-f', `sha=${sha}`);
      await must(run('gh', args, { timeoutMs: 30_000 }), 'Iniciar a esteira');
      return `Esteira iniciada para a versão ${(sha || head).slice(0, 7)}. Ela vai pedir sua autorização em alguns minutos.`;
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
