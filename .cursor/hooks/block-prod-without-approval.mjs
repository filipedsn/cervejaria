import { readFileSync } from 'node:fs';

/**
 * Bloqueia mutacoes em producao ate o usuario aprovar no Cursor (beforeShellExecution).
 * stdin: { "command": "..." }
 * stdout: { "permission": "allow" | "ask" | "deny", ... }
 *
 * Em execucao headless (QUIVER_AGENT_HEADLESS=1) nao ha humano para responder ao
 * "ask", e `agent --force` permite tudo que nao for explicitamente negado. Nesse
 * contexto o hook escala "ask" para "deny".
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

const headless = process.env.QUIVER_AGENT_HEADLESS === '1';

function allow() {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function ask(userMessage, agentMessage) {
  const permission = headless ? 'deny' : 'ask';
  const suffix = headless
    ? ' Execucao headless: comando negado (nenhuma acao de producao e permitida sem um humano).'
    : '';
  process.stdout.write(
    JSON.stringify({
      permission,
      user_message: userMessage + suffix,
      agent_message: agentMessage + suffix,
    }),
  );
  process.exit(0);
}

if (!cmd) allow();

const readOnly = [
  /prod:status\b/,
  /prod:verify\b/,
  /verify-prod-artifacts\.ps1/,
  /status\.ps1/,
  /curl(\.exe)?.*3001.*\/api\/health/,
  /curl(\.exe)?.*3001.*\/api\/ready/,
];

if (readOnly.some((re) => re.test(cmd))) allow();

/**
 * Restricoes que valem apenas para o agente de suporte headless.
 * Um humano pode fazer estas operacoes; o agente automatizado nao.
 */
const headlessOnlyDenied = [
  { re: /git\s+push[^|;]*\borigin\s+main\b/, why: 'push direto em main' },
  { re: /git\s+push[^|;]*\s--force\b/, why: 'push forcado' },
  { re: /git\s+push[^|;]*\s-f\b/, why: 'push forcado' },
  { re: /git\s+(reset\s+--hard|clean\s+-[a-z]*f)/, why: 'descarte destrutivo de working tree' },
  { re: /git\s+(config|remote\s+(set-url|add))/, why: 'alteracao de configuracao do git' },
  { re: />\s*[^|;]*\.env(\.|\b)/, why: 'escrita em arquivo .env' },
  { re: /(set-content|out-file|add-content)[^|;]*\.env(\.|\b)/, why: 'escrita em arquivo .env' },
  { re: /\.cursor[\\/](hooks|cli\.json)/, why: 'alteracao dos proprios guardrails' },
  { re: /prisma\s+migrate\s+(dev|deploy|reset)/, why: 'migration de banco' },
  { re: /\bdocker\s+(compose\s+)?(down|rm|stop|kill)/, why: 'parada de containers' },
  { re: /gh\s+(pr\s+merge|release|secret|auth)/, why: 'operacao privilegiada no GitHub' },
];

if (headless) {
  for (const { re, why } of headlessOnlyDenied) {
    if (re.test(cmd)) {
      process.stdout.write(
        JSON.stringify({
          permission: 'deny',
          user_message: `Agente headless bloqueado: ${why}.`,
          agent_message: `Hook block-prod-without-approval (headless): ${why} nao e permitido ao agente automatizado. Faca a alteracao de codigo e deixe esta operacao para o humano revisar.`,
        }),
      );
      process.exit(0);
    }
  }
}

const prodMutations = [
  /prod:restart\b/,
  /prod:deploy\b/,
  /prod:rollback\b/,
  /rollback\.ps1/,
  /prod:materialize-runtime\b/,
  /prod:stop\b/,
  /prod:ensure\b/,
  /prod:install\b/,
  /prod:uninstall\b/,
  /prod:backup\b/,
  /db:migrate:prod\b/,
  /db:sync-prod\b/,
  /sync-prod-to-dev/,
  /restart-api\.ps1/,
  /materialize-prod-runtime\.ps1/,
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

const deployAuthorized =
  /prod:deploy\b/.test(cmd) ||
  /prod:rollback\b/.test(cmd) ||
  /rollback\.ps1/.test(cmd) ||
  /deploy\.ps1/.test(cmd) ||
  /publish-artifacts\.ps1/.test(cmd) ||
  /install-autostart\.ps1/.test(cmd);

const materializeAuthorized =
  /prod:materialize-runtime\b/.test(cmd) ||
  /materialize-prod-runtime\.ps1/.test(cmd);

const prodArtifactWrites = [
  /\bbuild:prod\b/,
  /prod-artifacts/,
  /vite build.*outdir.*prod-artifacts/,
];

if (!deployAuthorized && !materializeAuthorized && prodArtifactWrites.some((re) => re.test(cmd))) {
  ask(
    'Escrita em artefatos de PRODUCAO bloqueada. Builds locais (ci:frontend, vite build) vao para frontend/dist e NAO afetam prod. Publicar somente via npm run prod:deploy apos autorizacao explicita.',
    'Hook block-prod-without-approval: tentativa de escrever em deploy/prod-artifacts ou build:prod fora do deploy.',
  );
}

allow();
