import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Incident, ProcessingHealth } from '../types.js';

const MAX_STORE_BYTES = 5 * 1024 * 1024;
const STORE_VERSION = 1;
export type IncidentStoreSnapshot = { schemaVersion: 1; storeVersion: 1; incidents: Incident[] };
export type StateSnapshot = { schemaVersion: 1; storeVersion: 1; health: ProcessingHealth };

/** Local JSON store only. It has no network or application-side effects. */
export class IncidentStore {
  readonly incidentsPath: string;
  readonly statePath: string;
  readonly lockPath: string;
  private lockHandle?: Awaited<ReturnType<typeof open>>;
  constructor(readonly runtimeDir: string) { this.incidentsPath = join(runtimeDir, 'incidents.json'); this.statePath = join(runtimeDir, 'state.json'); this.lockPath = join(runtimeDir, 'analyst.lock'); }

  async acquireLock(): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true });
    try { this.lockHandle = await open(this.lockPath, 'wx'); await this.lockHandle.writeFile(String(process.pid)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Support Analyst runtime lock already exists; another writer may be active.'); throw error; }
  }
  async releaseLock(): Promise<void> { if (this.lockHandle) { await this.lockHandle.close(); this.lockHandle = undefined; await rm(this.lockPath, { force: true }); } }
  async loadIncidents(): Promise<IncidentStoreSnapshot> { return this.read(this.incidentsPath, emptyIncidents, validateIncidents); }
  async loadState(): Promise<StateSnapshot> { return this.read(this.statePath, emptyState, validateState); }
  async saveIncidents(incidents: readonly Incident[]): Promise<void> { await this.atomic(this.incidentsPath, { schemaVersion: 1, storeVersion: STORE_VERSION, incidents: [...incidents].sort((a, b) => a.incidentId.localeCompare(b.incidentId)) }); }
  async saveState(health: ProcessingHealth): Promise<void> { await this.atomic(this.statePath, { schemaVersion: 1, storeVersion: STORE_VERSION, health }); }

  private async read<T>(path: string, fallback: () => T, validate: (value: unknown) => value is T): Promise<T> {
    try {
      const info = await stat(path); if (info.size > MAX_STORE_BYTES) throw new Error(`Incident store file exceeds ${MAX_STORE_BYTES} bytes.`);
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!validate(value)) throw new Error('Incident store schema is incompatible.');
      assertPrivacy(value); return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
      if (error instanceof SyntaxError) throw new Error(`Incident store is corrupted: ${path}`);
      throw error;
    }
  }
  private async atomic(path: string, value: unknown): Promise<void> {
    assertPrivacy(value); await mkdir(this.runtimeDir, { recursive: true });
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(payload) > MAX_STORE_BYTES) throw new Error(`Incident store file exceeds ${MAX_STORE_BYTES} bytes.`);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, payload, { encoding: 'utf8', flag: 'w' });
    await rename(temporary, path);
  }
}

export function emptyHealth(): ProcessingHealth { return { schemaVersion: 1, eventsProcessed: 0, eventsRejected: 0, incidentsCreated: 0, incidentsUpdated: 0, processingFailures: 0 }; }
/** Caller-supplied timestamps keep local health deterministic during replay. */
export function recordProcessingHealth(current: ProcessingHealth, update: { referenceTime: string; eventsProcessed: number; eventsRejected?: number; incidentsCreated?: number; incidentsUpdated?: number; failed?: boolean }): ProcessingHealth {
  return {
    ...current,
    processStartedAt: current.processStartedAt ?? update.referenceTime,
    lastProcessingAt: update.referenceTime,
    ...(update.failed ? {} : { lastProcessingSuccessAt: update.referenceTime }),
    eventsProcessed: current.eventsProcessed + update.eventsProcessed,
    eventsRejected: current.eventsRejected + (update.eventsRejected ?? 0),
    incidentsCreated: current.incidentsCreated + (update.incidentsCreated ?? 0),
    incidentsUpdated: current.incidentsUpdated + (update.incidentsUpdated ?? 0),
    processingFailures: current.processingFailures + (update.failed ? 1 : 0)
  };
}
function emptyIncidents(): IncidentStoreSnapshot { return { schemaVersion: 1, storeVersion: 1, incidents: [] }; }
function emptyState(): StateSnapshot { return { schemaVersion: 1, storeVersion: 1, health: emptyHealth() }; }
function validateIncidents(value: unknown): value is IncidentStoreSnapshot { return isRecord(value) && value.schemaVersion === 1 && value.storeVersion === 1 && Array.isArray(value.incidents) && value.incidents.every(validIncident); }
function validateState(value: unknown): value is StateSnapshot { return isRecord(value) && value.schemaVersion === 1 && value.storeVersion === 1 && isRecord(value.health) && value.health.schemaVersion === 1; }
function validIncident(value: unknown): value is Incident { return isRecord(value) && value.schemaVersion === 1 && typeof value.incidentId === 'string' && typeof value.fingerprint === 'string' && Array.isArray(value.eventIds) && Array.isArray(value.affectedTenantIds) && Array.isArray(value.reasons) && isRecord(value.signals); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

const prohibited = new Set(['authorization', 'cookie', 'jwt', 'password', 'email', 'phone', 'sql', 'bindings', 'connectionstring', 'body', 'raw', 'actorid', 'traceid', 'spanid', 'correlationid', 'requestid']);
export function assertPrivacy(value: unknown): void {
  const visit = (child: unknown): void => { if (Array.isArray(child)) child.forEach(visit); else if (isRecord(child)) for (const [key, nested] of Object.entries(child)) { if (prohibited.has(key.toLowerCase())) throw new Error(`Incident persistence rejects prohibited field: ${key}`); visit(nested); } };
  visit(value);
}
