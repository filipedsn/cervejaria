import type { AnalystEnvironment } from './types.js';

export type AnalystConfig = {
  environment: AnalystEnvironment;
  elasticsearchUrl?: string;
  elasticsearchApiKey?: string;
  runtimeDir?: string;
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
