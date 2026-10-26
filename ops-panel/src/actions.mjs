import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deleteBackup, downloadBackup } from './backups.mjs';
import { config, ROOT } from './config.mjs';
import { firstLine, run } from './exec.mjs';
import { isOnMain } from './collectors/git.mjs';
import { fetchPendingDeployments, fetchPr, reviewDeployment } from './collectors/github.mjs';
import { collectPrd, vpsReport } from './collectors/prd.mjs';
import { BACKUP_NAME_RE, backupsView } from './infra.mjs';
import { isMergeReady, needsUpdate, ver } from './state.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

export class ActionError extends Error {}

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
// Nome de parâmetro (-Sha) não pode ir entre aspas, senão vira valor posicional.
const psArg = (value) => (/^-[A-Za-z]+$/.test(value) ? value : psQuote(value));

/**
 * -Command em vez de -File: fixa UTF-8 antes do script, senão as mensagens do próprio
 * PowerShell 5.1 saem no código de página do console (cp850) e os acentos quebram.
 */
export function powershellCommand(path, args = []) {
  const call = [psQuote(path), ...args.map(psArg)].join(' ');
  return [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); try { & ${call}; exit $LASTEXITCODE } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
  ];
}

function powershellFile(script, args = [], timeoutMs = 90_000) {
  const path = join(ROOT, 'scripts', 'dev', script);
  if (!existsSync(path)) {
    return Promise.resolve({
      code: 1,
      stdout: '',
      stderr: 'A cópia do código deste PC ainda não tem esse recurso. Quem desenvolve precisa atualizá-la (git pull na main).',
    });
  }
  return run('powershell.exe', powershellCommand(path, args), { cwd: ROOT, timeoutMs });
}

async function must(promise, what) {
  const result = await promise;
  if (result.code !== 0) throw new ActionError(firstLine(result.stderr) || firstLine(result.stdout) || `${what} terminou com erro (código ${result.code}).`);
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

// A primeira troca cria a pasta própria do DEV e instala as dependências: pode levar minutos.
const SWITCH_TIMEOUT_MS = 900_000;

async function devSync() {
  await must(powershellFile('sync-dev-main.ps1', [], SWITCH_TIMEOUT_MS), 'Trazer a versão oficial');
  return 'Ambiente de testes atualizado com a versão oficial; fica pronto em cerca de 30 segundos.';
}

export const COPY_PRD_WORD = 'COPIAR';

async function copyPrdDb() {
  const result = await must(powershellFile('copy-prd-to-dev.ps1', [], 900_000), 'Copiar o banco do site');
  const m = result.stdout.match(/PRD_COPY_OK tables=(\d+) rows=(\d+)/);
  return m ? ` (${m[1]} tabelas, ${Number(m[2]).toLocaleString('pt-BR')} linhas)` : '';
}

async function devCopyPrd(params) {
  if (params.confirm !== COPY_PRD_WORD) throw new ActionError(`Para confirmar, digite ${COPY_PRD_WORD}.`);
  const detail = await copyPrdDb();
  return `Banco do site copiado para o ambiente de testes${detail}. Na cópia, e-mail e notificações ficam desligados. Pronto em cerca de 30 segundos.`;
}

/** Coloca no DEV a versão que está no site agora; com withDb, copia também o banco do site. */
async function devMatchPrd(params) {
  const withDb = params.withDb === true;
  if (withDb && params.confirm !== COPY_PRD_WORD) throw new ActionError(`Para copiar o banco do site, digite ${COPY_PRD_WORD}.`);
  const prd = await collectPrd();
  const sha = prd.releaseSha;
  if (!sha || !SHA_RE.test(sha)) throw new ActionError('Não foi possível ler a versão do site agora. Tente de novo em instantes.');
  if (!(await isOnMain(sha))) throw new ActionError('A versão do site não faz parte da versão oficial (main); chame quem desenvolve.');
  const args = ['-Sha', sha, '-Kind', 'prd', ...(withDb ? ['-SkipMigrate'] : [])];
  await must(powershellFile('switch-dev-code.ps1', args, SWITCH_TIMEOUT_MS), 'Igualar ao site');
  if (!withDb) return `Ambiente de testes com a mesma versão do site (${ver(sha)}), mantendo os dados de teste. Pronto em cerca de 30 segundos.`;
  const detail = await copyPrdDb();
  return `Ambiente de testes igual ao site: versão ${ver(sha)} e banco copiado${detail}. Na cópia, e-mail e notificações ficam desligados. Pronto em cerca de 30 segundos.`;
}

/** Coloca no DEV a última versão de um PR pronto, para testar antes de aceitar. */
async function devTestPr(params) {
  const number = positiveInt(params.number, 'PR');
  const pr = await fetchPr(number);
  if (!isMergeReady(pr)) throw new ActionError(`O PR #${number} ainda não está pronto (testes: ${pr.ci}). Só dá para testar PR que passou nos testes.`);
  if (!SHA_RE.test(pr.headSha ?? '')) throw new ActionError(`Não foi possível ler a versão do PR #${number}.`);
  await must(powershellFile('switch-dev-code.ps1', ['-Sha', pr.headSha, '-Kind', 'pr', '-Pr', String(number)], SWITCH_TIMEOUT_MS), `Testar o PR #${number}`);
  return `Ambiente de testes com o PR #${number}; fica pronto em cerca de 30 segundos em http://localhost:5202. O site dos clientes não mudou e o PR ainda não foi aceito.`;
}

/** Backup que está no servidor agora (lista recém-lida), com o sha256 esperado. */
async function knownBackup(params) {
  const name = String(params.name ?? '');
  if (!BACKUP_NAME_RE.test(name)) throw new ActionError('Nome de backup inválido.');
  if (!config.backupSshHost) throw new ActionError('Baixar e apagar backups não estão configurados neste PC (OPS_BACKUP_SSH_HOST).');
  const vps = await vpsReport(10_000, true);
  const view = vps?.ok ? backupsView(vps.data, { version: ver, manage: true }) : null;
  if (!view) throw new ActionError('Não foi possível ler a lista de backups do servidor agora. Tente de novo em instantes.');
  const backup = view.items.find((b) => b.name === name);
  if (!backup) throw new ActionError(`O backup ${name} não está mais no servidor. Clique em Recarregar no topo.`);
  return backup;
}

async function backupDownload(params) {
  const backup = await knownBackup(params);
  const result = await downloadBackup({ host: config.backupSshHost, dir: config.backupDownloadDir, name: backup.name, sha256: backup.sha256 });
  if (result.reused) return `O backup ${backup.name} já estava em ${result.path}, idêntico ao do servidor.`;
  const check = result.verified ? 'conferido com o sha256 do servidor' : 'sem conferência (o servidor não tem o .sha256 desse arquivo)';
  return `Backup ${backup.name} (${backup.sizeText}) salvo em ${result.path}, ${check}. Ele tem dados reais de clientes: não compartilhe.`;
}

async function backupDelete(params) {
  const backup = await knownBackup(params);
  if (String(params.confirm ?? '').trim() !== backup.name) throw new ActionError('Para confirmar, digite o nome do arquivo exatamente como aparece.');
  if (!backup.canDelete) throw new ActionError(`Esse backup não pode ser apagado: ${backup.deleteBlock}.`);
  await deleteBackup({ host: config.backupSshHost, name: backup.name });
  await vpsReport(0, true);
  return `Backup ${backup.name} apagado do servidor. A cópia externa (OneDrive) não muda.`;
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
  'dev.matchPrd': { label: 'Igualar o ambiente de testes ao site', run: devMatchPrd },
  'dev.testPr': { label: 'Testar PR no ambiente de testes', run: devTestPr },
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
  'backup.download': { label: 'Baixar backup do banco', run: backupDownload },
  'backup.delete': { label: 'Apagar backup do banco', run: backupDelete },
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

export const AUDIT_PAGE_SIZE = 10;

/** Página `page` (1 = mais recentes) do histórico; página fora do intervalo cai na mais próxima. */
export function readAudit(page = 1, size = AUDIT_PAGE_SIZE) {
  const entries = existsSync(config.auditLog)
    ? readFileSync(config.auditLog, 'utf8')
        .split(/\r?\n/)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((e) => e && e.action)
        .reverse()
    : [];
  const pages = Math.max(1, Math.ceil(entries.length / size));
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pages);
  const items = entries
    .slice((current - 1) * size, current * size)
    .map((e) => ({ ...e, label: ACTIONS[e.action]?.label ?? e.action }));
  return { items, page: current, pages, total: entries.length };
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
