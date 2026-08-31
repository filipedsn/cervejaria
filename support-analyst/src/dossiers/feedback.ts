import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeFreeText } from '../privacy/sanitize.js';
import { DOSSIER_LIMITS, type DossierFeedback, type DossierFeedbackFlag } from './types.js';

const ratings = new Set(['USEFUL', 'PARTIAL', 'WRONG']);
const flags = new Set<DossierFeedbackFlag>(['CLASSIFICATION_WRONG', 'SEVERITY_WRONG', 'CORRELATION_WRONG', 'DUPLICATE_WRONG', 'MISSING_CONTEXT', 'UNSUPPORTED_CLAIM', 'RECOMMENDED_CHECKS_NOT_USEFUL', 'OTHER']);

export type FeedbackInput = { dossierId: string; createdAt: string; rating: DossierFeedback['rating']; flags?: readonly DossierFeedbackFlag[]; comment?: string };
/** Append-only local review data. No reviewer identity is accepted or persisted. */
export class FeedbackStore {
  readonly path: string;
  readonly lockPath: string;
  constructor(readonly runtimeDir: string) { this.path = join(runtimeDir, 'feedback.jsonl'); this.lockPath = join(runtimeDir, 'feedback.lock'); }
  async append(input: FeedbackInput, dossierExists: (dossierId: string) => Promise<boolean>): Promise<DossierFeedback> {
    if (!await dossierExists(input.dossierId)) throw new Error('Feedback requires an existing dossier.');
    const feedback = createFeedback(input);
    const line = `${JSON.stringify(feedback)}\n`;
    if (Buffer.byteLength(line) > DOSSIER_LIMITS.feedbackLineBytes) throw new Error('Feedback line exceeds its size limit.');
    await mkdir(this.runtimeDir, { recursive: true });
    let lock;
    try {
      lock = await open(this.lockPath, 'wx');
      await lock.writeFile(String(process.pid));
      await open(this.path, 'a').then(async (file) => { try { await file.writeFile(line, 'utf8'); await file.sync(); } finally { await file.close(); } });
      return feedback;
    } finally { await lock?.close(); await rm(this.lockPath, { force: true }); }
  }
  async list(): Promise<DossierFeedback[]> {
    try {
      const info = await stat(this.path); if (info.size > DOSSIER_LIMITS.bytes) throw new Error('Feedback history exceeds the configured size limit.');
      const text = await readFile(this.path, 'utf8');
      return text.split('\n').filter(Boolean).map((line, index) => { try { return validateFeedback(JSON.parse(line)); } catch { throw new Error(`Feedback history is corrupted at line ${index + 1}.`); } });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
}
export function createFeedback(input: FeedbackInput): DossierFeedback {
  if (!ratings.has(input.rating)) throw new Error('Feedback rating is invalid.');
  if (Number.isNaN(Date.parse(input.createdAt))) throw new Error('Feedback requires a valid createdAt timestamp.');
  const cleanFlags = [...new Set(input.flags ?? [])].sort();
  if (cleanFlags.some((flag) => !flags.has(flag))) throw new Error('Feedback flag is invalid.');
  const comment = input.comment === undefined ? undefined : sanitizeFreeText(input.comment, 1000).replace(/[\r\n\t]/g, ' ').trim();
  const material = `${input.dossierId}|${input.createdAt}|${input.rating}|${cleanFlags.join(',')}|${comment ?? ''}`;
  return { schemaVersion: 1, feedbackId: `fb1:${createHash('sha256').update(material).digest('hex')}`, dossierId: input.dossierId, createdAt: input.createdAt, rating: input.rating, ...(cleanFlags.length ? { flags: cleanFlags } : {}), ...(comment ? { comment } : {}) };
}
function validateFeedback(value: unknown): DossierFeedback { if (!value || typeof value !== 'object') throw new Error('Invalid feedback.'); const feedback = value as DossierFeedback; if (feedback.schemaVersion !== 1 || typeof feedback.feedbackId !== 'string' || typeof feedback.dossierId !== 'string' || !ratings.has(feedback.rating)) throw new Error('Invalid feedback.'); return feedback; }
