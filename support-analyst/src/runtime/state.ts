import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_STATE_BYTES = 64 * 1024;
export type SourceWatermark = { schemaVersion: 1; source: 'alerts'; committedAt: string; latestEventAt?: string };

/** A single small, atomic watermark. Replaying its overlap is intentional. */
export class RuntimeStateStore {
  readonly stateDir: string;
  readonly watermarkPath: string;
  constructor(readonly runtimeDir: string) { this.stateDir = join(runtimeDir, 'state'); this.watermarkPath = join(this.stateDir, 'source-watermark.json'); }
  async loadWatermark(): Promise<SourceWatermark | undefined> {
    try {
      const info = await stat(this.watermarkPath); if (info.size > MAX_STATE_BYTES) throw new Error('Runtime watermark exceeds bounded storage limit.');
      const value: unknown = JSON.parse(await readFile(this.watermarkPath, 'utf8'));
      if (!validWatermark(value)) throw new Error('Runtime watermark schema is incompatible.');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) throw new Error('Runtime watermark is corrupted.');
      throw error;
    }
  }
  async saveWatermark(value: SourceWatermark): Promise<void> {
    if (!validWatermark(value)) throw new Error('Runtime watermark is invalid.');
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new Error('Runtime watermark exceeds bounded storage limit.');
    await mkdir(this.stateDir, { recursive: true });
    const temporary = `${this.watermarkPath}.${process.pid}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try { handle = await open(temporary, 'wx'); await handle.writeFile(payload, 'utf8'); await handle.sync(); await handle.close(); handle = undefined; await rename(temporary, this.watermarkPath); }
    catch (error) { await handle?.close(); await rm(temporary, { force: true }); throw error; }
  }
}

function validWatermark(value: unknown): value is SourceWatermark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schemaVersion === 1 && item.source === 'alerts' && typeof item.committedAt === 'string' && !Number.isNaN(Date.parse(item.committedAt)) && (item.latestEventAt === undefined || typeof item.latestEventAt === 'string' && !Number.isNaN(Date.parse(item.latestEventAt)));
}
