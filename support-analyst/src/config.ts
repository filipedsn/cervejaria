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

export type HealthConfig = {
  enabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatStaleMs: number;
  snapshotStaleMs: number;
  processingStaleMs: number;
};

/** Settings for the foreground, read-only pilot process. */
export type PilotRuntimeConfig = {
  pollIntervalMs: number;
  overlapMs: number;
  initialWindowMs: number;
  maxEvents: number;
};

/** Settings for the separate watch process (detectors); independent from the pilot. */
export type WatchConfig = {
  enabled: boolean;
  publicUrl: string;
  networkCheckUrl: string;
  freshnessMaxMinutes: number;
  errorLogThreshold: number;
  reminderMinutes: number;
  digestHour: number;
  intervalMs: number;
  /** Silence window after boot: Elastic/network failures are recorded but not alerted. */
  bootQuietMinutes: number;
  kibanaUrl?: string;
};

export type TelegramConfig = {
  enabled: boolean;
  dryRun: boolean;
  botToken?: string;
  chatId?: string;
  maxPerHour: number;
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
 * Runtime credentials are deliberately exclusive to the Analyst. PRD requires three explicit
 * markers and a non-loopback endpoint; DEV only accepts the local Elasticsearch.
 */
export function requireRuntimeElasticsearchConfig(config: AnalystConfig, env: Env): ConfigResult {
  if (!config.elasticsearchUrl || !config.elasticsearchApiKey) {
    return { ok: false, reason: 'runtime Elasticsearch configuration requires SUPPORT_ANALYST_ES_URL and SUPPORT_ANALYST_ES_API_KEY' };
  }
  let host = '';
  try { host = new URL(config.elasticsearchUrl).hostname; } catch { return { ok: false, reason: 'SUPPORT_ANALYST_ES_URL must be a valid HTTP(S) URL' }; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (config.environment === 'prd') {
    if (env.SUPPORT_ANALYST_ALLOW_PRD !== 'true') return { ok: false, reason: 'PRD requires SUPPORT_ANALYST_ALLOW_PRD=true' };
    if (env.SUPPORT_ANALYST_CREDENTIAL_ENV !== 'prd' || env.SUPPORT_ANALYST_ENDPOINT_ENV !== 'prd') {
      return { ok: false, reason: 'PRD requires SUPPORT_ANALYST_CREDENTIAL_ENV=prd and SUPPORT_ANALYST_ENDPOINT_ENV=prd' };
    }
    if (loopback) return { ok: false, reason: 'PRD runtime cannot target a loopback Elasticsearch (that is DEV)' };
  } else if (!loopback) {
    return { ok: false, reason: 'DEV runtime must target the local Elasticsearch (localhost or 127.0.0.1)' };
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

/** File-only operational health settings; deliberately independent from ES and LLM settings. */
export function readHealthConfig(env: Env): { ok: true; config: HealthConfig } | { ok: false; reason: string } {
  const enabled = env.SUPPORT_ANALYST_HEALTH_ENABLED ?? 'true';
  if (enabled !== 'true' && enabled !== 'false') return { ok: false, reason: 'SUPPORT_ANALYST_HEALTH_ENABLED must be true or false' };
  const positive = (name: string, fallback: number): number | undefined => {
    const raw = env[name]; if (raw === undefined) return fallback;
    const value = Number(raw); return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  const heartbeatIntervalMs = positive('SUPPORT_ANALYST_HEARTBEAT_INTERVAL_MS', 30_000);
  const heartbeatStaleMs = positive('SUPPORT_ANALYST_HEARTBEAT_STALE_MS', 90_000);
  const snapshotStaleMs = positive('SUPPORT_ANALYST_HEALTH_STALE_MS', 120_000);
  const processingStaleMs = positive('SUPPORT_ANALYST_PROCESSING_STALE_MS', 300_000);
  if (!heartbeatIntervalMs || !heartbeatStaleMs || !snapshotStaleMs || !processingStaleMs) return { ok: false, reason: 'health intervals must be positive integers' };
  if (heartbeatStaleMs < heartbeatIntervalMs) return { ok: false, reason: 'SUPPORT_ANALYST_HEARTBEAT_STALE_MS must be at least the heartbeat interval' };
  return { ok: true, config: { enabled: enabled === 'true', heartbeatIntervalMs, heartbeatStaleMs, snapshotStaleMs, processingStaleMs } };
}

/** Deliberately small polling surface: no queue, scheduler, or service manager. */
export function readPilotRuntimeConfig(env: Env): { ok: true; config: PilotRuntimeConfig } | { ok: false; reason: string } {
  const positive = (name: string, fallback: number): number | undefined => {
    const raw = env[name]; if (raw === undefined) return fallback;
    const value = Number(raw); return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  const pollIntervalMs = positive('SUPPORT_ANALYST_POLL_INTERVAL_MS', 60_000);
  const overlapMs = positive('SUPPORT_ANALYST_OVERLAP_MS', 120_000);
  const initialWindowMs = positive('SUPPORT_ANALYST_INITIAL_WINDOW_MS', 300_000);
  const maxEvents = positive('SUPPORT_ANALYST_MAX_EVENTS', 50);
  if (!pollIntervalMs || !overlapMs || !initialWindowMs || !maxEvents || maxEvents > 100) return { ok: false, reason: 'pilot runtime settings must be positive integers and SUPPORT_ANALYST_MAX_EVENTS must be at most 100' };
  if (overlapMs > initialWindowMs) return { ok: false, reason: 'SUPPORT_ANALYST_OVERLAP_MS must not exceed SUPPORT_ANALYST_INITIAL_WINDOW_MS' };
  return { ok: true, config: { pollIntervalMs, overlapMs, initialWindowMs, maxEvents } };
}

/** Watch settings. Public URL defaults to the real site in PRD and the local API in DEV. */
export function readWatchConfig(env: Env, environment: AnalystEnvironment): { ok: true; config: WatchConfig } | { ok: false; reason: string } {
  const enabled = env.SUPPORT_ANALYST_WATCH_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false') return { ok: false, reason: 'SUPPORT_ANALYST_WATCH_ENABLED must be true or false' };
  const publicUrl = (env.SUPPORT_ANALYST_PUBLIC_URL ?? (environment === 'prd' ? 'https://tap.quivercloud.com.br' : 'http://127.0.0.1:3002')).replace(/\/+$/, '');
  const networkCheckUrl = env.SUPPORT_ANALYST_NETWORK_CHECK_URL ?? 'https://1.1.1.1/cdn-cgi/trace';
  const kibanaUrl = env.SUPPORT_ANALYST_KIBANA_URL?.trim().replace(/\/+$/, '') || undefined;
  const urls: Array<[string, string]> = [['SUPPORT_ANALYST_PUBLIC_URL', publicUrl], ['SUPPORT_ANALYST_NETWORK_CHECK_URL', networkCheckUrl]];
  if (kibanaUrl) urls.push(['SUPPORT_ANALYST_KIBANA_URL', kibanaUrl]);
  for (const [name, value] of urls) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { return { ok: false, reason: `${name} must be a valid HTTP(S) URL` }; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return { ok: false, reason: `${name} must be an HTTP(S) URL without credentials` };
  }
  if (environment === 'prd' && !publicUrl.startsWith('https://')) return { ok: false, reason: 'SUPPORT_ANALYST_PUBLIC_URL must use https in PRD' };
  const positive = (name: string, fallback: number): number | undefined => {
    const raw = env[name]; if (raw === undefined) return fallback;
    const value = Number(raw); return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  const freshnessMaxMinutes = positive('SUPPORT_ANALYST_FRESHNESS_MAX_MINUTES', 10);
  const errorLogThreshold = positive('SUPPORT_ANALYST_ERROR_LOG_THRESHOLD', 20);
  const reminderMinutes = positive('SUPPORT_ANALYST_REMINDER_MINUTES', 60);
  const intervalMs = positive('SUPPORT_ANALYST_WATCH_INTERVAL_MS', 60_000);
  if (!freshnessMaxMinutes || !errorLogThreshold || !reminderMinutes || !intervalMs || intervalMs < 30_000) {
    return { ok: false, reason: 'watch settings must be positive integers and SUPPORT_ANALYST_WATCH_INTERVAL_MS must be at least 30000' };
  }
  const bootQuietMinutes = Number(env.SUPPORT_ANALYST_BOOT_QUIET_MINUTES ?? '10');
  if (!Number.isInteger(bootQuietMinutes) || bootQuietMinutes < 0 || bootQuietMinutes > 120) return { ok: false, reason: 'SUPPORT_ANALYST_BOOT_QUIET_MINUTES must be an integer between 0 and 120' };
  const digestHour = Number(env.SUPPORT_ANALYST_DIGEST_HOUR ?? '8');
  if (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23) return { ok: false, reason: 'SUPPORT_ANALYST_DIGEST_HOUR must be an integer between 0 and 23' };
  return { ok: true, config: { enabled: enabled === 'true', publicUrl, networkCheckUrl, freshnessMaxMinutes, errorLogThreshold, reminderMinutes, digestHour, intervalMs, bootQuietMinutes, kibanaUrl } };
}

/** Telegram settings. Dry-run is the default; live mode needs token and chat. */
export function readTelegramConfig(env: Env): { ok: true; config: TelegramConfig } | { ok: false; reason: string } {
  const enabled = env.SUPPORT_ANALYST_TELEGRAM_ENABLED ?? 'false';
  const dryRun = env.SUPPORT_ANALYST_TELEGRAM_DRY_RUN ?? 'true';
  if (!['true', 'false'].includes(enabled) || !['true', 'false'].includes(dryRun)) {
    return { ok: false, reason: 'SUPPORT_ANALYST_TELEGRAM_ENABLED and SUPPORT_ANALYST_TELEGRAM_DRY_RUN must be true or false' };
  }
  const maxPerHour = Number(env.SUPPORT_ANALYST_TELEGRAM_MAX_PER_HOUR ?? '20');
  if (!Number.isSafeInteger(maxPerHour) || maxPerHour < 1 || maxPerHour > 100) return { ok: false, reason: 'SUPPORT_ANALYST_TELEGRAM_MAX_PER_HOUR must be an integer between 1 and 100' };
  const botToken = env.SUPPORT_ANALYST_TELEGRAM_BOT_TOKEN?.trim() || undefined;
  const chatId = env.SUPPORT_ANALYST_TELEGRAM_CHAT_ID?.trim() || undefined;
  if (enabled === 'true' && dryRun === 'false' && (!botToken || !chatId)) {
    return { ok: false, reason: 'live Telegram requires SUPPORT_ANALYST_TELEGRAM_BOT_TOKEN and SUPPORT_ANALYST_TELEGRAM_CHAT_ID' };
  }
  return { ok: true, config: { enabled: enabled === 'true', dryRun: dryRun === 'true', botToken, chatId, maxPerHour } };
}
