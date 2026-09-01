import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmEnrichment, LlmInteraction } from './types.js';

const MAX_INTERACTION_LOG_BYTES = 10 * 1024 * 1024;

export class EnrichmentStore {
  constructor(readonly runtimeDir: string) {}
  async save(enrichment: LlmEnrichment): Promise<void> {
    const directory = join(this.runtimeDir, 'enrichments', safe(enrichment.dossierId));
    const file = join(directory, `${safe(enrichment.enrichmentId)}.json`);
    const content = `${JSON.stringify(enrichment, null, 2)}\n`;
    await mkdir(directory, { recursive: true });
    try {
      const existing = await readFile(file, 'utf8');
      if (existing !== content) throw new Error('Enrichment snapshot already exists with different content.');
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await atomicWrite(file, content);
  }
}

/** Append-only evaluation record; it refuses growth past a conservative local limit. */
export class InteractionStore {
  constructor(readonly runtimeDir: string) {}
  async append(interaction: LlmInteraction): Promise<void> {
    const directory = join(this.runtimeDir, 'llm'); const path = join(directory, 'interactions.jsonl');
    const line = `${JSON.stringify(interaction)}\n`;
    if (/\b(?:thinking|authorization\s*:|bearer\s+[\w.+/=-]+)/i.test(line)) throw new Error('Interaction refuses unsafe content.');
    await mkdir(directory, { recursive: true });
    try { if ((await stat(path)).size + Buffer.byteLength(line) > MAX_INTERACTION_LOG_BYTES) throw new Error('Interaction log size limit reached; rotate it before recording more.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const handle = await open(path, 'a');
    try { await handle.writeFile(line, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  }
}

async function atomicWrite(path: string, content: string): Promise<void> { const temporary = `${path}.${process.pid}.tmp`; let handle; try { handle = await open(temporary, 'wx'); await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = undefined; await rename(temporary, path); } catch (error) { await handle?.close(); await rm(temporary, { force: true }); throw error; } }
function safe(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_'); }
