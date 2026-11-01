import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JourneyCriteria } from './types.js';

export const JOURNEY_RETENTION_DAYS = 30;
const FILE_PATTERN = /^jornada-[a-z0-9-]+\.txt$/;

/** Repository root, from src/journey or dist/journey. */
export function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** deploy/runtime is ignored by Git: journeys (with personal data) never get versioned. */
export function defaultJourneyDir(): string {
  return join(repositoryRoot(), 'deploy', 'runtime', 'support-analyst', 'journeys');
}

/** The criterion value goes only into a short hash so file names carry no personal data. */
export function journeyFileName(criteria: Pick<JourneyCriteria, 'environment' | 'mode' | 'value'>, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  const hash = createHash('sha256').update(criteria.value).digest('hex').slice(0, 8);
  return `jornada-${criteria.environment}-${criteria.mode}-${stamp}-${hash}.txt`;
}

/** Removes journey files older than the retention; other files in the folder are left alone. */
export async function cleanupJourneys(dir: string, now: Date, retentionDays = JOURNEY_RETENTION_DAYS): Promise<number> {
  let names: string[];
  try { names = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  let removed = 0;
  for (const name of names) {
    if (!FILE_PATTERN.test(name)) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (info.isFile() && info.mtimeMs < cutoff) { await rm(path, { force: true }); removed += 1; }
    } catch { /* concurrent removal */ }
  }
  return removed;
}

export async function saveJourney(dir: string, name: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  return path;
}
