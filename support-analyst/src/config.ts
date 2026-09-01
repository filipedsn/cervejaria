import type { AnalystEnvironment } from './types.js';

export type AnalystConfig = {
  environment: AnalystEnvironment;
  elasticsearchUrl?: string;
  elasticsearchApiKey?: string;
  runtimeDir?: string;
};

export type LocalLlmConfig = {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
  numCtx: number;
  keepAlive: string;
};

export type ConfigResult =
  | { ok: true; config: AnalystConfig }
  | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

const forbiddenCredentialVariables = [
  'ELASTIC_USER',
  'ELASTIC_PASSWORD',
  'ELASTIC_API_KEY_COLLECTOR',
  'ELASTIC_API_KEY_ALERT_POLLER',
  'ELASTIC_API_KEY_SUPPORT_AGENT'
] as const;

export function readAnalystConfig(env: Env): ConfigResult {
  if (Object.keys(env).some((name) => name.startsWith('SUPPORT_AGENT_'))) {
    return { ok: false, reason: 'legacy Support Agent configuration is not accepted' };
  }
  if (forbiddenCredentialVariables.some((name) => env[name] !== undefined)) {
    return { ok: false, reason: 'privileged Elasticsearch credentials are not accepted' };
  }
  const environment = env.SUPPORT_ANALYST_ENV;
  if (environment !== 'dev' && environment !== 'prd') {
    return { ok: false, reason: 'SUPPORT_ANALYST_ENV must be dev or prd' };
  }
  const url = env.SUPPORT_ANALYST_ES_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        return { ok: false, reason: 'SUPPORT_ANALYST_ES_URL must be an HTTP(S) URL without user credentials' };
      }
    } catch {
      return { ok: false, reason: 'SUPPORT_ANALYST_ES_URL must be a valid HTTP(S) URL without user credentials' };
    }
  }
  return {
    ok: true,
    config: {
      environment,
      elasticsearchUrl: url,
      elasticsearchApiKey: env.SUPPORT_ANALYST_ES_API_KEY,
      runtimeDir: env.SUPPORT_ANALYST_RUNTIME_DIR
    }
  };
}

/**
 * Runtime credentials are deliberately exclusive to the Analyst.  TQ-SA-04 is
 * DEV-only: a future ticket must make an explicit, reviewed change before any
 * PRD runtime can exist.
 */
export function requireRuntimeElasticsearchConfig(config: AnalystConfig, env: Env): ConfigResult {
  if (!config.elasticsearchUrl || !config.elasticsearchApiKey) {
    return { ok: false, reason: 'runtime Elasticsearch configuration requires SUPPORT_ANALYST_ES_URL and SUPPORT_ANALYST_ES_API_KEY' };
  }
  if (config.environment === 'prd') {
    return { ok: false, reason: 'PRD access is not enabled for TQ-SA-04.' };
  }
  return { ok: true, config };
}

/** Configuration deliberately separate from Elasticsearch and legacy Agent settings. */
export function readLocalLlmConfig(env: Env): { ok: true; config: LocalLlmConfig } | { ok: false; reason: string } {
  const enabledValue = env.SUPPORT_ANALYST_LLM_ENABLED ?? 'false';
  if (enabledValue !== 'true' && enabledValue !== 'false') return { ok: false, reason: 'SUPPORT_ANALYST_LLM_ENABLED must be true or false' };
  const endpoint = env.SUPPORT_ANALYST_LLM_ENDPOINT ?? 'http://127.0.0.1:11434';
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return { ok: false, reason: 'SUPPORT_ANALYST_LLM_ENDPOINT must be an HTTP loopback URL' };
  } catch { return { ok: false, reason: 'SUPPORT_ANALYST_LLM_ENDPOINT must be an HTTP loopback URL' }; }
  const number = (name: string, fallback: number): number | undefined => {
    const value = env[name]; if (value === undefined) return fallback;
    const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const timeoutMs = number('SUPPORT_ANALYST_LLM_TIMEOUT_MS', 60_000);
  const numCtx = number('SUPPORT_ANALYST_LLM_NUM_CTX', 8192);
  if (!timeoutMs) return { ok: false, reason: 'SUPPORT_ANALYST_LLM_TIMEOUT_MS must be a positive integer' };
  if (!numCtx) return { ok: false, reason: 'SUPPORT_ANALYST_LLM_NUM_CTX must be a positive integer' };
  const model = env.SUPPORT_ANALYST_LLM_MODEL ?? 'gemma4:12b';
  if (!model.trim()) return { ok: false, reason: 'SUPPORT_ANALYST_LLM_MODEL must not be empty' };
  return { ok: true, config: { enabled: enabledValue === 'true', endpoint, model, timeoutMs, numCtx, keepAlive: '5m' } };
}
