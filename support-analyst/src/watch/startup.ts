import { uptime } from 'node:os';
import { ElasticSourceError } from '../sources/elastic.js';
import type { AnalystIndices } from '../sources/constants.js';
import type { WatchStateStore } from './state.js';

/** Retry delays while the Elastic endpoint is unreachable at startup; the last one repeats. */
export const BACKOFF_SECONDS = [5, 10, 30, 60] as const;

export function backoffDelayMs(attempt: number): number {
  const index = Math.min(Math.max(0, Math.trunc(attempt)), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[index]! * 1000;
}

export function machineBootTime(now = new Date(), uptimeSeconds = uptime()): Date {
  return new Date(now.getTime() - uptimeSeconds * 1000);
}

export function inBootQuietWindow(now: Date, bootTime: Date, quietMinutes: number): boolean {
  return now.getTime() - bootTime.getTime() < quietMinutes * 60_000;
}

export type PingResult = { reachable: boolean; detail: string };
export type ElasticPing = () => Promise<PingResult>;

/** Any HTTP answer from Elasticsearch (even 401/403) means the network path is up. */
export function elasticPing(elastic: { indexNames(): AnalystIndices; latestTimestamp(index: string): Promise<string | undefined> }): ElasticPing {
  return async () => {
    try {
      await elastic.latestTimestamp(elastic.indexNames().appMetrics);
      return { reachable: true, detail: 'Elastic respondeu' };
    } catch (error) {
      if (error instanceof ElasticSourceError) {
        const answered = ['unauthorized', 'forbidden', 'rate_limited', 'malformed_response'].includes(error.kind) || /HTTP \d{3}/.test(error.message);
        return { reachable: answered, detail: answered ? `Elastic respondeu (${error.kind})` : `Elastic: ${error.kind}` };
      }
      return { reachable: false, detail: 'Elastic: erro de rede' };
    }
  };
}

export type WaitForElasticDependencies = {
  ping: ElasticPing;
  store: WatchStateStore;
  bootTime: Date;
  quietMinutes: number;
  now?: () => Date;
  sleep: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  log?: (line: string) => void;
};

/**
 * Waits for the Elastic endpoint with backoff (5s, 10s, 30s, 60s, then 60s) while still inside the
 * post-boot quiet window, recording "aguardando rede" in the watch state. Once the window is over it
 * hands control to the regular loop, whose detectors then alert normally.
 */
export async function waitForElastic(deps: WaitForElasticDependencies): Promise<{ ready: boolean; attempts: number }> {
  const now = deps.now ?? (() => new Date());
  const since = now().toISOString();
  let attempts = 0;
  for (;;) {
    if (deps.shouldStop?.()) return { ready: false, attempts };
    const result = await deps.ping();
    attempts += 1;
    const at = now();
    const quiet = inBootQuietWindow(at, deps.bootTime, deps.quietMinutes);
    const state = await deps.store.load();
    const status = result.reachable ? 'pronto' : quiet ? 'aguardando rede' : 'desistiu (janela pós-boot encerrada)';
    state.waiting = { status, since, attempts, lastAttemptAt: at.toISOString(), lastDetail: result.detail };
    await deps.store.save(state);
    if (result.reachable) return { ready: true, attempts };
    if (!quiet) return { ready: false, attempts };
    const delay = backoffDelayMs(attempts - 1);
    deps.log?.(JSON.stringify({ at: at.toISOString(), waiting: status, attempt: attempts, nextRetrySeconds: delay / 1000, detail: result.detail }));
    await deps.sleep(delay);
  }
}
