import { stat } from 'node:fs/promises';
import { HealthStore } from './store.js';
import type { HealthStatus, SupportAnalystHealthSnapshot } from './types.js';
export type HealthCheckResult = { status: HealthStatus; exitCode: 0 | 1 | 2 | 3; reasons: string[]; snapshot?: SupportAnalystHealthSnapshot };
export async function checkExternalHealth(runtimeDir: string | undefined, options: { heartbeatStaleMs: number; snapshotStaleMs: number; now?: Date } ): Promise<HealthCheckResult> {
  if (!runtimeDir) return { status: 'UNKNOWN', exitCode: 3, reasons: ['runtime directory is not configured'] };
  const store = new HealthStore(runtimeDir); const now = options.now ?? new Date(); const heartbeat = await store.readHeartbeat(); const snapshot = await store.readSnapshot(); const reasons: string[] = [];
  if (!heartbeat) reasons.push('HEARTBEAT_MISSING'); else if (now.getTime() - Date.parse(heartbeat.heartbeatAt) > options.heartbeatStaleMs) reasons.push('HEARTBEAT_STALE');
  if (!snapshot) reasons.push('HEALTH_SNAPSHOT_MISSING'); else if (now.getTime() - Date.parse(snapshot.generatedAt) > options.snapshotStaleMs) reasons.push('HEALTH_SNAPSHOT_STALE');
  if (reasons.length) return { status: 'UNHEALTHY', exitCode: 2, reasons, snapshot };
  if (!snapshot || snapshot.schemaVersion !== 1) return { status: 'UNKNOWN', exitCode: 3, reasons: ['invalid health snapshot'] };
  const exitCode = snapshot.overall === 'HEALTHY' ? 0 : snapshot.overall === 'DEGRADED' ? 1 : snapshot.overall === 'UNHEALTHY' ? 2 : 3;
  return { status: snapshot.overall, exitCode, reasons: snapshot.reasons.map((reason) => reason.code), snapshot };
}
