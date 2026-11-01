import type { FetchLike } from './probes.js';

type Env = Record<string, string | undefined>;

export type HeartbeatConfig = { url: string; apiKey: string; index: string };
export type HeartbeatDoc = { firing: number; skipped: boolean; quiet: boolean; releaseSha?: string };
export type HeartbeatResult = 'ok' | 'failed';
export type HeartbeatSender = { send(doc: HeartbeatDoc, now: Date): Promise<HeartbeatResult> };

/**
 * Optional proof of life written to Elastic so a Kibana rule can tell when the PC analyst goes
 * silent. Uses its own key (create_doc on this data stream only); the read key stays read-only.
 */
export function readHeartbeatConfig(env: Env, environment: 'dev' | 'prd'): { ok: true; config?: HeartbeatConfig } | { ok: false; reason: string } {
  const apiKey = env.SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY?.trim();
  if (!apiKey) return { ok: true };
  if (apiKey === env.SUPPORT_ANALYST_ES_API_KEY?.trim()) {
    return { ok: false, reason: 'SUPPORT_ANALYST_REMOTE_HEARTBEAT_API_KEY must be a dedicated write key, not the read key' };
  }
  const url = env.SUPPORT_ANALYST_ES_URL?.trim().replace(/\/+$/, '');
  if (!url) return { ok: false, reason: 'remote heartbeat requires SUPPORT_ANALYST_ES_URL' };
  return { ok: true, config: { url, apiKey, index: `logs-support_analyst.heartbeat-${environment}` } };
}

export class ElasticHeartbeat implements HeartbeatSender {
  constructor(private readonly config: HeartbeatConfig, private readonly environment: 'dev' | 'prd', private readonly fetchImpl: FetchLike = fetch) {}

  async send(doc: HeartbeatDoc, now: Date): Promise<HeartbeatResult> {
    const body = {
      '@timestamp': now.toISOString(),
      'event.dataset': 'support_analyst.heartbeat',
      'service.name': 'quiver-tap-support-analyst',
      'analyst.environment': this.environment,
      'analyst.firing': doc.firing,
      'analyst.skipped': doc.skipped,
      'analyst.quiet': doc.quiet,
      ...(doc.releaseSha ? { 'analyst.release_sha': doc.releaseSha } : {}),
    };
    try {
      const response = await this.fetchImpl(`${this.config.url}/${this.config.index}/_doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${this.config.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status === 201 || response.status === 200 ? 'ok' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
