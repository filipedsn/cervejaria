import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(backendRoot, '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: null });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} falhou: ${String(result.stderr ?? '').slice(0, 300)}`);
  return result.stdout;
}

export function readPinnedBlob(commit, filePath) {
  return git(['show', `${commit}:${filePath}`]);
}

export async function verifyMigratorQaManifest(manifest) {
  const { manifestSha256, ...manifestBody } = manifest;
  if (sha256(Buffer.from(JSON.stringify(manifestBody))) !== manifestSha256) throw new Error('Digest do manifesto do migrador difere do conteudo registrado.');
  const base = manifest.confirmedBaseline;
  if (!base?.commit || git(['cat-file', '-t', base.commit]).toString('utf8').trim() !== 'commit') throw new Error('Baseline confirmado precisa referenciar um commit Git existente.');
  const schema = readPinnedBlob(base.commit, base.schema.path);
  const migration = readPinnedBlob(base.commit, base.migration.path);
  if (sha256(schema) !== base.schema.sha256) throw new Error('Schema do baseline confirmado difere do SHA fixado.');
  if (sha256(migration) !== base.migration.sha256) throw new Error('SQL do baseline confirmado difere do SHA fixado.');
  for (const reference of [base.historicalManifest, base.previousCoreManifest]) {
    const bytes = await readFile(path.resolve(repoRoot, reference.path));
    if (sha256(bytes) !== reference.sha256) throw new Error(`Manifesto histórico alterado: ${reference.path}`);
  }
  if (manifest.deliveryCandidates?.schema !== null) throw new Error('Este ensaio exige schema candidato explícito null; use manifesto novo para ensaiar schema candidato.');
  if ((manifest.deliveryCandidates?.migrations ?? []).length !== 0) throw new Error('Esta entrega não registra migrations candidatas de negócio/schema.');
  for (const candidate of manifest.deliveryCandidates?.code ?? []) {
    const bytes = await readFile(path.resolve(repoRoot, candidate.path));
    if (sha256(bytes) !== candidate.sha256) throw new Error(`Código sob ensaio difere do hash fixado: ${candidate.path}`);
  }
  return { schema, migration };
}

export const digestQaBytes = sha256;
