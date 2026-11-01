import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WatchState } from './types.js';

export function emptyWatchState(): WatchState {
  return { detectors: {}, cyclesSinceDigest: 0, cyclesSkippedSinceDigest: 0, firingsSinceDigest: { SEV1: 0, SEV2: 0, SEV3: 0 } };
}

/** Local JSON only; atomic write so a crash never leaves a half-written state. */
export class WatchStateStore {
  readonly path: string;
  constructor(runtimeDir: string) { this.path = join(runtimeDir, 'watch', 'state.json'); }

  async load(): Promise<WatchState> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<WatchState>;
      const base = emptyWatchState();
      return { ...base, ...value, detectors: value.detectors ?? {}, firingsSinceDigest: { ...base.firingsSinceDigest, ...(value.firingsSinceDigest ?? {}) } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return emptyWatchState();
      throw error;
    }
  }

  async save(state: WatchState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temp, this.path);
  }
}
