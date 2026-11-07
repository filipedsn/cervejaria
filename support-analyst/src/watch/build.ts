import { join, resolve } from 'node:path';
import { readAnalystConfig, readCashNoticeConfig, readReleaseInfoConfig, readTelegramConfig, readWatchConfig, requireRuntimeElasticsearchConfig, type WatchConfig } from '../config.js';
import { NotificationService } from '../notify/service.js';
import { ElasticsearchSources } from '../sources/index.js';
import { CashNotices } from './cash.js';
import { ElasticHeartbeat, readHeartbeatConfig } from './heartbeat.js';
import { WatchRunner } from './runner.js';
import { elasticPing, machineBootTime, type ElasticPing } from './startup.js';
import { WatchStateStore } from './state.js';

type Env = Record<string, string | undefined>;
export type BuiltWatch = { ok: true; runner: WatchRunner; notifications: NotificationService; watch: WatchConfig; runtimeDir: string; store: WatchStateStore; ping: ElasticPing; bootTime: Date; environment: 'dev' | 'prd'; heartbeat: 'on' | 'off'; cashNotices: 'on' | 'off' };

/** Validates every gate before any network call. The watch does not use the pilot preflight. */
export function buildWatch(env: Env): BuiltWatch | { ok: false; reason: string } {
  const analyst = readAnalystConfig(env);
  if (!analyst.ok) return analyst;
  const runtime = requireRuntimeElasticsearchConfig(analyst.config, env);
  if (!runtime.ok) return runtime;
  if (!runtime.config.runtimeDir) return { ok: false, reason: 'SUPPORT_ANALYST_RUNTIME_DIR is required' };
  const watch = readWatchConfig(env, runtime.config.environment);
  if (!watch.ok) return watch;
  if (!watch.config.enabled) return { ok: false, reason: 'SUPPORT_ANALYST_WATCH_ENABLED=true is required' };
  const telegram = readTelegramConfig(env);
  if (!telegram.ok) return telegram;
  const cash = readCashNoticeConfig(env);
  if (!cash.ok) return cash;
  const releaseInfo = readReleaseInfoConfig(env);
  if (!releaseInfo.ok) return releaseInfo;
  const environment = runtime.config.environment;
  const beat = readHeartbeatConfig(env, environment);
  if (!beat.ok) return beat;
  const runtimeDir = resolve(runtime.config.runtimeDir);
  const notifications = new NotificationService({ config: telegram.config, runtimeDir });
  const elastic = ElasticsearchSources.fromConfig(runtime.config, env);
  const store = new WatchStateStore(runtimeDir);
  const bootTime = machineBootTime();
  const heartbeat = beat.config ? new ElasticHeartbeat(beat.config, environment) : undefined;
  const cashNotices = cash.config.enabled
    ? new CashNotices({
      elastic,
      auditIndex: elastic.indexNames().audit,
      sender: new NotificationService({ config: { ...telegram.config, maxPerHour: cash.config.maxPerHour }, runtimeDir: join(runtimeDir, 'cash') }),
    })
    : undefined;
  const runner = new WatchRunner({ config: watch.config, elastic, notifications, store, environment, bootTime, heartbeat, cash: cashNotices, releaseInfo: releaseInfo.config });
  return { ok: true, runner, notifications, watch: watch.config, runtimeDir, store, ping: elasticPing(elastic), bootTime, environment, heartbeat: heartbeat ? 'on' : 'off', cashNotices: cashNotices ? 'on' : 'off' };
}
