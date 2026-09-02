import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeterministicDossier } from '../dossiers/types.js';

const MAX_REVIEW_QUEUE_BYTES = 1024 * 1024;
export type ReviewStatus = 'PENDING' | 'REVIEWED';
export type ReviewQueueItem = { dossierId: string; incidentId: string; generatedAt: string; class: DeterministicDossier['class']; severity: DeterministicDossier['severity']; confidence: DeterministicDossier['confidence']; enrichmentAvailable: boolean; reviewStatus: ReviewStatus };
type QueueSnapshot = { schemaVersion: 1; items: ReviewQueueItem[] };

/** Minimal human-review index; it never duplicates a dossier body or reviewer identity. */
export class ReviewQueueStore {
  readonly path: string;
  constructor(readonly runtimeDir: string) { this.path = join(runtimeDir, 'review-queue.json'); }
  async enqueue(dossier: DeterministicDossier, enrichmentAvailable: boolean): Promise<void> {
    const current = await this.load();
    const existing = current.items.find((item) => item.dossierId === dossier.dossierId);
    if (existing) { if (enrichmentAvailable && !existing.enrichmentAvailable) { existing.enrichmentAvailable = true; await this.save(current); } return; }
    current.items.push({ dossierId: dossier.dossierId, incidentId: dossier.incidentId, generatedAt: dossier.generatedAt, class: dossier.class, severity: dossier.severity, confidence: dossier.confidence, enrichmentAvailable, reviewStatus: 'PENDING' });
    current.items.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt) || a.dossierId.localeCompare(b.dossierId));
    await this.save(current);
  }
  async markReviewed(dossierId: string): Promise<void> { const current = await this.load(); const item = current.items.find((candidate) => candidate.dossierId === dossierId); if (item && item.reviewStatus !== 'REVIEWED') { item.reviewStatus = 'REVIEWED'; await this.save(current); } }
  async pending(): Promise<ReviewQueueItem[]> { return (await this.load()).items.filter((item) => item.reviewStatus === 'PENDING'); }
  private async load(): Promise<QueueSnapshot> {
    try { const info = await stat(this.path); if (info.size > MAX_REVIEW_QUEUE_BYTES) throw new Error('Review queue exceeds bounded storage limit.'); const value: unknown = JSON.parse(await readFile(this.path, 'utf8')); if (!valid(value)) throw new Error('Review queue schema is incompatible.'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, items: [] }; if (error instanceof SyntaxError) throw new Error('Review queue is corrupted.'); throw error; }
  }
  private async save(value: QueueSnapshot): Promise<void> {
    const payload = `${JSON.stringify(value, null, 2)}\n`; if (Buffer.byteLength(payload) > MAX_REVIEW_QUEUE_BYTES) throw new Error('Review queue exceeds bounded storage limit.');
    await mkdir(this.runtimeDir, { recursive: true }); const temporary = `${this.path}.${process.pid}.tmp`; let handle: Awaited<ReturnType<typeof open>> | undefined;
    try { handle = await open(temporary, 'wx'); await handle.writeFile(payload, 'utf8'); await handle.sync(); await handle.close(); handle = undefined; await rename(temporary, this.path); }
    catch (error) { await handle?.close(); await rm(temporary, { force: true }); throw error; }
  }
}
function valid(value: unknown): value is QueueSnapshot { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).schemaVersion === 1 && Array.isArray((value as Record<string, unknown>).items); }
