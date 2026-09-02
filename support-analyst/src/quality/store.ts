import { mkdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { QualityReview } from './types.js';
import { validateQualityReview } from './validation.js';

const MAX_REVIEW_LOG_BYTES = 10 * 1024 * 1024;
export class QualityReviewStore {
  constructor(private readonly runtimeDir: string, private readonly runId: string) {}
  path(): string { return join(this.runtimeDir, 'quality', this.runId, 'reviews.jsonl'); }
  async append(review: unknown): Promise<QualityReview> {
    const valid = validateQualityReview(review, this.runId);
    const line = `${JSON.stringify(valid)}\n`; const path = this.path();
    await mkdir(join(this.runtimeDir, 'quality', this.runId), { recursive: true });
    try { if ((await stat(path)).size + Buffer.byteLength(line) > MAX_REVIEW_LOG_BYTES) throw new Error('Review log size limit reached; rotate it before recording more.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const handle = await open(path, 'a'); try { await handle.writeFile(line, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    return valid;
  }
}
