import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { removeStaleLock } from '../incidents/store.js';

/** Single-writer lock for the watch process; a lock from a dead PID is replaced. */
export class FileLock {
  private handle?: Awaited<ReturnType<typeof open>>;
  constructor(readonly path: string) {}

  async acquire(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { this.handle = await open(this.path, 'wx'); await this.handle.writeFile(String(process.pid)); return; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (attempt === 0 && (await this.removeOwnLeftover() || await removeStaleLock(this.path))) continue;
        throw new Error(`Watch lock in use: ${this.path} (another watch process is active).`);
      }
    }
  }

  async release(): Promise<void> {
    if (!this.handle) return;
    await this.handle.close();
    this.handle = undefined;
    await rm(this.path, { force: true });
  }

  /** In a container the restarted process gets the same PID (usually 1), so a lock with our PID is a leftover. */
  private async removeOwnLeftover(): Promise<boolean> {
    let raw: string;
    try { raw = (await readFile(this.path, 'utf8')).trim(); } catch { return false; }
    if (raw !== String(process.pid)) return false;
    await rm(this.path, { force: true });
    return true;
  }
}
