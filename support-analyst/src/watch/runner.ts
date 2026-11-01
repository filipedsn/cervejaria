import type { WatchConfig } from '../config.js';
import { formatDigest, formatFiring, formatInfo, formatReminder, formatResolved } from '../notify/format.js';
import type { AnalystIndices } from '../sources/constants.js';
import { ElasticSourceError } from '../sources/elastic.js';
import type { HeartbeatResult, HeartbeatSender } from './heartbeat.js';
import { probeUrl, readReleaseSha, type FetchLike } from './probes.js';
import { inBootQuietWindow } from './startup.js';
import type { WatchStateStore } from './state.js';
import { DETECTOR_RULES, type ContainerState, type DetectorId, type DetectorRule, type DetectorStateEntry, type ErrorContext, type Observation, type WatchState } from './types.js';

const ALERT_POLLER_CONTAINER = 'quiver-tap-alert-poller';

export type WatchElasticReader = {
  indexNames(): AnalystIndices;
  latestTimestamp(index: string): Promise<string | undefined>;
  countLastMinutes(index: string, minutes: number, filters: unknown[]): Promise<number>;
  errorContext?(index: string, minutes: number): Promise<ErrorContext>;
  latestContainerState?(index: string, container: string): Promise<ContainerState | undefined>;
};
export type WatchNotifications = { send(kind: string, text: string, detectorId?: string): Promise<void>; flushPending(): Promise<void> };
export type WatchEvent = { kind: 'FIRING' | 'RESOLVED'; detectorId: DetectorId };
export type WatchCycleResult = { skipped: boolean; quiet: boolean; observations: Observation[]; events: WatchEvent[]; notified: string[]; heartbeat?: HeartbeatResult };
export type WatchRunnerDependencies = {
  config: WatchConfig;
  elastic: WatchElasticReader;
  notifications: WatchNotifications;
  store: WatchStateStore;
  environment?: 'dev' | 'prd';
  /** Machine boot time; notifications are held during config.bootQuietMinutes after it. */
  bootTime?: Date;
  /** Remote proof of life for the Kibana "analyst silent" rule; failures never break the cycle. */
  heartbeat?: HeartbeatSender;
  fetchImpl?: FetchLike;
  now?: () => Date;
};
type Resolved = { rule: DetectorRule; minutes: number };

const ERROR_FILTER = [{ term: { severity_text: 'ERROR' } }];

export class WatchRunner {
  constructor(private readonly deps: WatchRunnerDependencies) {}

  async runCycle(): Promise<WatchCycleResult> {
    const now = this.deps.now?.() ?? new Date();
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const quiet = this.deps.bootTime ? inBootQuietWindow(now, this.deps.bootTime, this.deps.config.bootQuietMinutes) : false;
    const state = await this.deps.store.load();
    state.startedAt ??= now.toISOString();
    const observations: Observation[] = [];
    const events: WatchEvent[] = [];
    const resolved: Resolved[] = [];
    const notified: string[] = [];
    const observe = (observation: Observation) => { observations.push(observation); this.apply(state, observation, now, events, resolved); };

    // 1. Without the PC network nothing below is meaningful (and nothing could be sent).
    const network = await probeUrl(fetchImpl, this.deps.config.networkCheckUrl);
    observe({ id: 'local-network-down', bad: !network.ok, detail: network.detail });
    if (!network.ok) {
      state.cyclesSkippedSinceDigest += 1;
      await this.deps.store.save(state);
      return { skipped: true, quiet, observations, events, notified };
    }

    await this.deps.notifications.flushPending();

    // 2. External probe of the public site.
    const site = await probeUrl(fetchImpl, `${this.deps.config.publicUrl}/api/ready`);
    observe({ id: 'public-site-down', bad: !site.ok, detail: `${site.detail} em /api/ready` });

    // 3. Elastic reads; on failure, ES-derived detectors keep their previous state.
    const indices = this.deps.elastic.indexNames();
    let failure: ElasticSourceError | undefined;
    let apiLatest: string | undefined;
    let collectorLatest: string | undefined;
    let errorCount = 0;
    const watchAlertPath = Boolean(indices.dockerState && this.deps.elastic.latestContainerState);
    let poller: ContainerState | undefined;
    try {
      apiLatest = await this.deps.elastic.latestTimestamp(indices.appMetrics);
      collectorLatest = await this.deps.elastic.latestTimestamp(indices.infraHttpcheck);
      errorCount = await this.deps.elastic.countLastMinutes(indices.technical, 5, ERROR_FILTER);
      if (watchAlertPath) poller = await this.deps.elastic.latestContainerState!(indices.dockerState!, ALERT_POLLER_CONTAINER);
    } catch (error) {
      failure = error instanceof ElasticSourceError ? error : new ElasticSourceError('request_failed', 'Elasticsearch request failed');
    }
    const authFailed = failure?.kind === 'unauthorized' || failure?.kind === 'forbidden';
    observe({ id: 'elastic-auth-failed', bad: authFailed, detail: authFailed && failure ? `Elastic respondeu ${failure.kind}` : 'ok' });
    observe({ id: 'elastic-unreachable', bad: Boolean(failure) && !authFailed, detail: failure && !authFailed ? `Elastic: ${failure.kind}` : 'ok' });
    let surgeContext: ErrorContext | undefined;
    if (!failure) {
      const max = this.deps.config.freshnessMaxMinutes;
      const apiAge = ageMinutes(apiLatest, now);
      const collectorAge = ageMinutes(collectorLatest, now);
      observe({ id: 'api-telemetry-stale', bad: apiAge === undefined || apiAge > max, detail: apiAge === undefined ? 'nenhuma métrica da API nas últimas 6h' : `última métrica da API há ${apiAge} min` });
      observe({ id: 'collector-telemetry-stale', bad: collectorAge === undefined || collectorAge > max, detail: collectorAge === undefined ? 'nenhum httpcheck nas últimas 6h' : `último httpcheck há ${collectorAge} min` });
      if (watchAlertPath) {
        const healthy = poller?.status === 'running' && poller.health === 'healthy';
        observe({ id: 'alert-path-unhealthy', bad: !healthy, detail: poller ? `poller status=${poller.status} health=${poller.health}` : 'nenhum estado do poller nos últimos 10 min' });
      }
      const surge = errorCount > this.deps.config.errorLogThreshold;
      if (surge && this.deps.elastic.errorContext) {
        try { surgeContext = await this.deps.elastic.errorContext(indices.technical, 5); } catch { surgeContext = undefined; }
      }
      observe({ id: 'error-log-surge', bad: surge, detail: `${errorCount} logs ERROR nos últimos 5 min (limite ${this.deps.config.errorLogThreshold})`, context: surgeContext });
    }

    // 4. Notifications. API telemetry stale is a consequence while the site is failing, and a missing
    //    poller state is a consequence while the collector is stale: hold them.
    //    During the post-boot quiet window nothing fires; detectors keep counting and fire afterwards.
    const siteBad = (state.detectors['public-site-down']?.consecutiveBad ?? 0) > 0;
    const collectorBad = state.detectors['collector-telemetry-stale']?.status === 'FIRING';
    for (const id of Object.keys(DETECTOR_RULES) as DetectorId[]) {
      const rule = DETECTOR_RULES[id];
      const entry = state.detectors[id];
      if (quiet || !rule.notify || !entry || entry.status !== 'FIRING') continue;
      if (id === 'api-telemetry-stale' && siteBad) continue;
      if (id === 'alert-path-unhealthy' && collectorBad) continue;
      if (!entry.lastNotifiedAt) {
        const context = id === 'error-log-surge' ? surgeContext : undefined;
        await this.deps.notifications.send('FIRING', formatFiring(rule, entry.firingSince ?? now.toISOString(), entry.lastDetail ?? '', { context, kibanaUrl: this.deps.config.kibanaUrl, environment: this.deps.environment }), id);
        entry.lastNotifiedAt = now.toISOString();
        state.firingsSinceDigest[rule.severity] += 1;
        notified.push(`FIRING:${id}`);
      } else if (now.getTime() - Date.parse(entry.lastNotifiedAt) >= this.deps.config.reminderMinutes * 60_000) {
        await this.deps.notifications.send('REMINDER', formatReminder(rule, minutesSince(entry.firingSince, now), entry.lastDetail ?? ''), id);
        entry.lastNotifiedAt = now.toISOString();
        notified.push(`REMINDER:${id}`);
      }
    }
    for (const item of resolved) {
      await this.deps.notifications.send('RESOLVED', formatResolved(item.rule, item.minutes), item.rule.id);
      notified.push(`RESOLVED:${item.rule.id}`);
    }

    // 5. New release in production.
    const release = await readReleaseSha(fetchImpl, this.deps.config.publicUrl);
    if (release && state.lastReleaseSha && release !== state.lastReleaseSha) {
      await this.deps.notifications.send('INFO', formatInfo(`Nova versão no ar: ${release.slice(0, 7)}`));
      notified.push('INFO:release');
    }
    if (release) state.lastReleaseSha = release;

    // 6. Daily digest (proof of life), once per Brasília day after the configured hour.
    state.cyclesSinceDigest += 1;
    const local = brasiliaParts(now);
    if (local.hour >= this.deps.config.digestHour && state.lastDigestDate !== local.date) {
      let kibanaAlerts24h: number | undefined;
      if (!failure) {
        try { kibanaAlerts24h = await this.deps.elastic.countLastMinutes(indices.alerts, 1440, []); } catch { kibanaAlerts24h = undefined; }
      }
      const firing = (Object.keys(DETECTOR_RULES) as DetectorId[])
        .filter((id) => DETECTOR_RULES[id].notify && state.detectors[id]?.status === 'FIRING')
        .map((id) => DETECTOR_RULES[id].title);
      await this.deps.notifications.send('DIGEST', formatDigest({ date: local.date, startedAt: state.startedAt, cycles: state.cyclesSinceDigest, skipped: state.cyclesSkippedSinceDigest, firing, firings: state.firingsSinceDigest, kibanaAlerts24h, releaseSha: state.lastReleaseSha }));
      state.lastDigestDate = local.date;
      state.cyclesSinceDigest = 0;
      state.cyclesSkippedSinceDigest = 0;
      state.firingsSinceDigest = { SEV1: 0, SEV2: 0, SEV3: 0 };
      notified.push('DIGEST');
    }

    await this.deps.store.save(state);
    const firingCount = (Object.keys(DETECTOR_RULES) as DetectorId[]).filter((id) => state.detectors[id]?.status === 'FIRING').length;
    const heartbeat = await this.deps.heartbeat?.send({ firing: firingCount, skipped: false, quiet, releaseSha: state.lastReleaseSha }, now);
    return { skipped: false, quiet, observations, events, notified, ...(heartbeat ? { heartbeat } : {}) };
  }

  private apply(state: WatchState, observation: Observation, now: Date, events: WatchEvent[], resolved: Resolved[]): void {
    const rule = DETECTOR_RULES[observation.id];
    const entry: DetectorStateEntry = state.detectors[observation.id] ?? { status: 'OK', consecutiveBad: 0, consecutiveGood: 0 };
    if (observation.bad) { entry.consecutiveBad += 1; entry.consecutiveGood = 0; } else { entry.consecutiveGood += 1; entry.consecutiveBad = 0; }
    entry.lastDetail = observation.detail;
    if (entry.status === 'OK' && entry.consecutiveBad >= rule.fireAfter) {
      entry.status = 'FIRING';
      entry.firingSince = now.toISOString();
      entry.lastNotifiedAt = undefined;
      events.push({ kind: 'FIRING', detectorId: observation.id });
    } else if (entry.status === 'FIRING' && entry.consecutiveGood >= rule.resolveAfter) {
      if (entry.lastNotifiedAt && rule.notify) resolved.push({ rule, minutes: minutesSince(entry.firingSince, now) });
      entry.status = 'OK';
      entry.firingSince = undefined;
      entry.lastNotifiedAt = undefined;
      events.push({ kind: 'RESOLVED', detectorId: observation.id });
    }
    state.detectors[observation.id] = entry;
  }
}

/** Accepts ISO and the OTel exporter format: epoch milliseconds as text (e.g. "1793059738435.0"). */
export function ageMinutes(timestamp: string | undefined, now: Date): number | undefined {
  if (!timestamp) return undefined;
  const parsed = /^\d+(\.\d+)?$/.test(timestamp) ? Number(timestamp) : Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round((now.getTime() - parsed) / 60_000));
}

function minutesSince(iso: string | undefined, now: Date): number {
  return ageMinutes(iso, now) ?? 0;
}

export function brasiliaParts(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
