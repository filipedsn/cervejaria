import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { renderDossierMarkdown } from './markdown.js';
import { DOSSIER_LIMITS, type DeterministicDossier } from './types.js';

export class DossierStore {
  constructor(readonly runtimeDir: string) {}
  dossierPaths(incidentId: string, dossierId: string): { json: string; markdown: string } {
    const directory = join(this.runtimeDir, 'dossiers', safePathPart(incidentId));
    const name = safePathPart(dossierId);
    return { json: join(directory, `${name}.json`), markdown: join(directory, `${name}.md`) };
  }
  async save(dossier: DeterministicDossier): Promise<DeterministicDossier> {
    const paths = this.dossierPaths(dossier.incidentId, dossier.dossierId);
    const json = `${JSON.stringify(dossier, null, 2)}\n`;
    const markdown = renderDossierMarkdown(dossier);
    assertSafeDossierPayload(dossier, json, markdown);
    await mkdir(join(this.runtimeDir, 'dossiers', safePathPart(dossier.incidentId)), { recursive: true });
    const existingJson = await readOptional(paths.json);
    const existingMarkdown = await readOptional(paths.markdown);
    if (existingJson !== undefined || existingMarkdown !== undefined) {
      if (existingJson === undefined || existingMarkdown === undefined) throw new Error('Dossier snapshot is incomplete; refusing to overwrite it.');
      const existing = validateDossier(JSON.parse(existingJson));
      const expectedExisting = { ...dossier, generatedAt: existing.generatedAt };
      if (JSON.stringify(existing, null, 2) !== JSON.stringify(expectedExisting, null, 2) || existingMarkdown !== renderDossierMarkdown(existing)) throw new Error('Dossier snapshot already exists with different content.');
      return existing;
    }
    await atomicWrite(paths.markdown, markdown);
    try { await atomicWrite(paths.json, json); }
    catch (error) { await rm(paths.markdown, { force: true }); throw error; }
    return dossier;
  }
  async load(incidentId: string, dossierId: string): Promise<DeterministicDossier | undefined> {
    const path = this.dossierPaths(incidentId, dossierId).json;
    const text = await readOptional(path);
    if (text === undefined) return undefined;
    if (Buffer.byteLength(text) > DOSSIER_LIMITS.bytes) throw new Error('Dossier JSON exceeds the configured size limit.');
    try { return validateDossier(JSON.parse(text)); } catch (error) { if (error instanceof SyntaxError) throw new Error('Dossier JSON is corrupted.'); throw error; }
  }
  async exists(dossierId: string): Promise<boolean> {
    const root = join(this.runtimeDir, 'dossiers');
    try {
      const { readdir } = await import('node:fs/promises');
      const incidents = await readdir(root, { withFileTypes: true });
      for (const incident of incidents.filter((item) => item.isDirectory())) if (await readOptional(join(root, incident.name, `${safePathPart(dossierId)}.json`)) !== undefined) return true;
      return false;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
}

export function assertDossierPrivacy(value: unknown): void {
  const prohibited = new Set(['authorization', 'cookie', 'token', 'password', 'secret', 'connectionstring', 'sql', 'bindings', 'body', 'stack', 'email', 'phone', 'actorid', 'rawpayload', 'rawsource']);
  const visit = (item: unknown): void => {
    if (typeof item === 'string') { if (/\b(?:authorization\s*:|bearer\s+[a-z0-9._~+/=-]+|(?:password|token|secret)\s*[:=]\s*[^\s,;]+|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/)/i.test(item)) throw new Error('Dossier rejects secret-like text.'); return; }
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
      if (prohibited.has(key.toLowerCase())) throw new Error(`Dossier rejects prohibited field: ${key}`);
      visit(nested);
    }
  };
  visit(value);
}
function assertSafeDossierPayload(value: DeterministicDossier, json: string, markdown: string): void {
  assertDossierPrivacy(value);
  for (const payload of [json, markdown]) if (Buffer.byteLength(payload) > DOSSIER_LIMITS.bytes) throw new Error('Dossier exceeds the configured 1 MiB size limit.');
}
function validateDossier(value: unknown): DeterministicDossier {
  assertDossierPrivacy(value);
  if (!value || typeof value !== 'object') throw new Error('Dossier schema is incompatible.');
  const dossier = value as DeterministicDossier;
  if (dossier.schemaVersion !== 1 || typeof dossier.dossierId !== 'string' || typeof dossier.incidentId !== 'string' || !Array.isArray(dossier.facts) || !Array.isArray(dossier.evidence) || !Array.isArray(dossier.timeline)) throw new Error('Dossier schema is incompatible.');
  return dossier;
}
async function readOptional(path: string): Promise<string | undefined> { try { const info = await stat(path); if (info.size > DOSSIER_LIMITS.bytes) throw new Error('Dossier file exceeds the configured size limit.'); return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }
async function atomicWrite(path: string, payload: string): Promise<void> { const temporary = `${path}.${process.pid}.tmp`; let handle; try { handle = await open(temporary, 'wx'); await handle.writeFile(payload, 'utf8'); await handle.sync(); await handle.close(); handle = undefined; await rename(temporary, path); } catch (error) { await handle?.close(); await rm(temporary, { force: true }); throw error; } }
function safePathPart(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_'); }
