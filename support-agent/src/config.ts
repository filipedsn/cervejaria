import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AGENT_DIR = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(AGENT_DIR, '..');

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(AGENT_DIR, '.env'));
loadEnvFile(path.join(PROJECT_ROOT, 'deploy', 'observability', '.env.observability'));

function str(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

export const config = {
  /** Modo sombra (Fase 2): abre Issues, nunca aciona o fixer. */
  shadowMode: bool('SUPPORT_AGENT_SHADOW', true),
  /** Kill switch (Fase 5): para o fixer sem parar a triagem. */
  fixerEnabled: bool('SUPPORT_AGENT_FIXER_ENABLED', false),
  /** Nao escreve em lugar nenhum — util para inspecionar a triagem antes de ligar de verdade. */
  dryRun: bool('SUPPORT_AGENT_DRY_RUN', false),

  pollIntervalMs: Math.max(30_000, int('SUPPORT_AGENT_POLL_INTERVAL_MS', 60_000)),
  stateFile: str(
    'SUPPORT_AGENT_STATE_FILE',
    path.join(PROJECT_ROOT, 'deploy', 'runtime', 'support-agent-state.json'),
  ),
  logFile: str(
    'SUPPORT_AGENT_LOG_FILE',
    path.join(PROJECT_ROOT, 'deploy', 'logs', 'support-agent.log'),
  ),

  es: {
    url: str('SUPPORT_AGENT_ES_URL', str('KIBANA_ALERT_ES_URL', 'http://127.0.0.1:9200')).replace(
      /\/$/,
      '',
    ),
    alertIndex: str('SUPPORT_AGENT_ALERT_INDEX', 'quiver-tap-alert-events'),
    logIndex: str('SUPPORT_AGENT_LOG_INDEX', 'logs-audit*.otel-prd'),
    /**
     * Chave propria do agente. A do alert-poller nao serve: ela so le
     * quiver-tap-alert-events, e o enriquecimento depende de ler logs-* e traces-*.
     * Gere com `npm run obs:create-api-keys`; sem ela, cai em basic auth.
     */
    apiKey: str('SUPPORT_AGENT_ES_API_KEY', str('ELASTIC_API_KEY_SUPPORT_AGENT', '')),
    user: str('SUPPORT_AGENT_ES_USER', str('ELASTIC_USER', 'elastic')),
    password: str('SUPPORT_AGENT_ES_PASSWORD', str('ELASTIC_PASSWORD', '')),
  },

  kibana: {
    url: str('SUPPORT_AGENT_KIBANA_URL', 'http://127.0.0.1:5601').replace(/\/$/, ''),
  },

  github: {
    repo: str('SUPPORT_AGENT_GITHUB_REPO', str('GITHUB_REPO', 'filipedsn/cervejaria')),
    /** Vazio faz o `gh` usar as credenciais do login local. */
    token: str('SUPPORT_AGENT_GITHUB_TOKEN', ''),
    baseBranch: str('SUPPORT_AGENT_BASE_BRANCH', 'main'),
  },

  worktree: {
    root: str('SUPPORT_AGENT_WORKTREE_ROOT', 'C:\\quiver-agent-work'),
  },

  fixer: {
    cliBin: str('SUPPORT_AGENT_CURSOR_BIN', 'cursor-agent'),
    model: str('SUPPORT_AGENT_MODEL', ''),
    /** Unico limite que o CLI respeita de verdade dentro de uma execucao. */
    timeoutMs: int('SUPPORT_AGENT_FIX_TIMEOUT_MS', 20 * 60_000),
    maxAttemptsPerFingerprint: int('SUPPORT_AGENT_MAX_ATTEMPTS', 2),
    maxPrsPerDay: int('SUPPORT_AGENT_MAX_PRS_PER_DAY', 3),
    /**
     * Execucoes por dia. Este e o controle de gasto real: o `stream-json` do Cursor CLI
     * nao emite custo (so `duration_ms`), entao nao ha como abortar no meio por preco.
     * Limitar execucoes limita o gasto; o teto absoluto deve ser configurado como spend
     * limit na conta ou na service account key do Cursor.
     */
    maxRunsPerDay: int('SUPPORT_AGENT_MAX_RUNS_PER_DAY', 6),
    /** Estimativa por execucao, apenas para o orcamento diario e para o relatorio. */
    estCostUsdPerRun: Number(str('SUPPORT_AGENT_EST_COST_USD_PER_RUN', '1.5')),
    maxCostUsdPerDay: Number(str('SUPPORT_AGENT_MAX_COST_USD_PER_DAY', '10')),
  },

  otlp: {
    endpoint: str('SUPPORT_AGENT_OTLP_ENDPOINT', str('OTEL_EXPORTER_OTLP_ENDPOINT', '')),
    serviceName: str('SUPPORT_AGENT_SERVICE_NAME', 'quiver-tap-support-agent'),
    environment: str('SUPPORT_AGENT_ENV', 'prd'),
  },
} as const;

export function esAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.es.apiKey) {
    headers.Authorization = `ApiKey ${config.es.apiKey}`;
    return headers;
  }
  if (config.es.password) {
    const basic = Buffer.from(`${config.es.user}:${config.es.password}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }
  return headers;
}
