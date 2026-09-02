import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Heartbeat, SupportAnalystHealthSnapshot } from './types.js';

const MAX_HEALTH_BYTES = 256 * 1024;
export class HealthStore {
  readonly directory: string;
  readonly heartbeatPath: string;
  readonly snapshotPath: string;
  constructor(runtimeDir: string) { this.directory = join(runtimeDir, 'health'); this.heartbeatPath = join(this.directory, 'heartbeat.json'); this.snapshotPath = join(this.directory, 'health.json'); }
  async writeHeartbeat(value: Heartbeat): Promise<void> { await this.atomic(this.heartbeatPath, value); }
  async writeSnapshot(value: SupportAnalystHealthSnapshot): Promise<void> { await this.atomic(this.snapshotPath, value); }
  async readHeartbeat(): Promise<Heartbeat | undefined> { return this.read<Heartbeat>(this.heartbeatPath); }
  async readSnapshot(): Promise<SupportAnalystHealthSnapshot | undefined> { return this.read<SupportAnalystHealthSnapshot>(this.snapshotPath); }
  private async read<T>(path: string): Promise<T | undefined> { try { const text = await readFile(path, 'utf8'); if (Buffer.byteLength(text) > MAX_HEALTH_BYTES) return undefined; return JSON.parse(text) as T; } catch { return undefined; } }
  private async atomic(path: string, value: unknown): Promise<void> {
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(payload) > MAX_HEALTH_BYTES) throw new Error('Health snapshot exceeds bounded storage limit');
    await mkdir(this.directory, { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, payload, 'utf8'); await rename(tmp, path);
  }
}
