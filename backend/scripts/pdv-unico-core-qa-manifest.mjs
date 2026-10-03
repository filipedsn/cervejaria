import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function git(args, encoding = 'buffer') {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: encoding === 'buffer' ? undefined : encoding });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').slice(0, 500)}`);
  return result.stdout;
}

export function readCandidateSchemaFromIndex() {
  return git(['show', ':backend/prisma/schema.prisma']);
}

export function getCandidateCoreManifestData({ baseCommit, historicalManifestSha256, migrationName, migrationPath, migrationSql, schemaSha256 }) {
  const data = { baseCommit, historicalManifestSha256, migrationName, migrationPath, migrationSha256: digest(migrationSql), schemaPath: 'backend/prisma/schema.prisma', schemaSha256 };
  return { ...data, manifestSha256: digest(Buffer.from(JSON.stringify(data))) };
}

export async function verifyCandidateCoreManifest(manifest, historicalManifest) {
  if (git(['cat-file', '-t', manifest.baseCommit], 'utf8').trim() !== 'commit') throw new Error('Candidate baseline must be an existing commit');
  if (historicalManifest.manifestSha256 !== manifest.historicalManifestSha256) throw new Error('Historical FK manifest hash differs from candidate manifest');
  const { manifestSha256, ...data } = manifest;
  if (digest(Buffer.from(JSON.stringify(data))) !== manifestSha256) throw new Error('Candidate manifest digest mismatch');
  const migrationSql = await readFile(path.resolve(repoRoot, manifest.migrationPath));
  if (digest(migrationSql) !== manifest.migrationSha256) throw new Error('Candidate migration SQL differs from recorded hash');
  if (digest(readCandidateSchemaFromIndex()) !== manifest.schemaSha256) throw new Error('Candidate schema in Git index differs from recorded hash');
  return { migrationSql, schema: readCandidateSchemaFromIndex() };
}
