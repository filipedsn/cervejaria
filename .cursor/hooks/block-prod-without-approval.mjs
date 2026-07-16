import { readFileSync } from 'node:fs';

/**
 * Bloqueia mutacoes em producao ate o usuario aprovar no Cursor (beforeShellExecution).
 * stdin: { "command": "..." }
 * stdout: { "permission": "allow" | "ask", ... }
 */

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  raw = '';
}

let command = '';
try {
  const input = JSON.parse(raw || '{}');
  command = String(input.command ?? '');
} catch {
  command = '';
}

const cmd = command.toLowerCase();

function allow() {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function ask(userMessage, agentMessage) {
  process.stdout.write(
    JSON.stringify({
      permission: 'ask',
      user_message: userMessage,
      agent_message: agentMessage,
    }),
  );
  process.exit(0);
}

if (!cmd) allow();

const readOnly = [
  /prod:status\b/,
  /status\.ps1/,
  /curl(\.exe)?.*3001.*\/api\/health/,
  /curl(\.exe)?.*3001.*\/api\/ready/,
];

if (readOnly.some((re) => re.test(cmd))) allow();

const prodMutations = [
  /prod:restart\b/,
  /prod:deploy\b/,
  /prod:stop\b/,
  /prod:ensure\b/,
  /prod:install\b/,
  /prod:uninstall\b/,
  /prod:backup\b/,
  /db:migrate:prod\b/,
  /db:sync-prod\b/,
  /sync-prod-to-dev/,
  /restart-api\.ps1/,
  /deploy\.ps1/,
  /start-api\.ps1/,
  /stop-all\.ps1/,
  /\btaskkill\b/,
  /tap\.quivercloud\.com\.br/,
];

for (const re of prodMutations) {
  if (re.test(cmd)) {
    ask(
      'Comando de PRODUCAO bloqueado pelo hook do projeto. Fluxo: implementar e validar em DEV (:3002/:5202) primeiro; subir para prod (:3001) somente quando voce autorizar explicitamente (ex.: "pode fazer deploy em prod").',
      `Hook block-prod-without-approval: comando prod detectado (${re}). Nao executar em prod sem autorizacao explicita do usuario.`,
    );
  }
}

const isProdHost = /127\.0\.0\.1:3001|localhost:3001|:3001\//.test(cmd) || /tap\.quivercloud\.com\.br/.test(cmd);
const isWrite = /-x\s+(post|put|patch|delete)\b/.test(cmd) || /-method\s+(post|put|patch|delete)\b/.test(cmd);

if (isProdHost && isWrite) {
  ask(
    'Requisicao de escrita em PRODUCAO (:3001) bloqueada. Testes e validacao devem usar DEV (:3002).',
    'Hook block-prod-without-approval: POST/PUT/PATCH/DELETE em prod detectado. Usar dev para testes.',
  );
}

allow();
