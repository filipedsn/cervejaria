import { createHash, randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEV_CANONICAL_TENANTS = Object.freeze(['cmr9yis3c0000hvu00q9fe7y1', 'cmsry9xrn0000hvlgopjxy0oo']);
const key = 'PDV_CANONICAL_TENANTS';
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const wrap = (body) => ({ ...body, sha256: hash(JSON.stringify(body)) });

function activationValue(text) {
  const values = text.split(/\r?\n/).filter((line) => line.trimStart().startsWith(`${key}=`));
  if (values.length > 1) throw new Error('DEV environment has duplicate PDV_CANONICAL_TENANTS keys.');
  if (!values.length) return { line: null, value: null, index: -1 };
  const line = values[0];
  const raw = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (raw && raw !== DEV_CANONICAL_TENANTS.join(',')) throw new Error('Existing PDV_CANONICAL_TENANTS is outside the reviewed DEV activation scope.');
  return { line, value: raw || null, index: text.split(/\r?\n/).findIndex((item) => item === line) };
}

function assertConfigPath(configPath) {
  if (!path.isAbsolute(configPath) || path.basename(configPath).toLowerCase() !== '.env.development') throw new Error('Persistent activation is restricted to an explicit absolute .env.development file.');
}

function replaceActivationLine(text, { priorLine, priorIndex, originalHadTrailingNewline, desired }) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (text.includes('\r\n') && text.replaceAll('\r\n', '').includes('\n')) throw new Error('Mixed newline styles in DEV environment file; refusing activation.');
  const hadTrailingNewline = text.endsWith('\n');
  const lines = text.split(newline);
  if (hadTrailingNewline) lines.pop();
  const matches = lines.map((line, index) => line.trimStart().startsWith(`${key}=`) ? index : -1).filter((index) => index >= 0);
  if (matches.length > 1) throw new Error('DEV environment has duplicate PDV_CANONICAL_TENANTS keys.');
  if (desired !== null) {
    const line = `${key}=${desired}`;
    if (matches.length) lines[matches[0]] = line;
    else lines.push(line);
  } else if (matches.length) {
    if (priorLine !== null) lines[matches[0]] = priorLine;
    else lines.splice(matches[0], 1);
  }
  const trailing = desired === null ? originalHadTrailingNewline : (hadTrailingNewline || lines.length > 1);
  return lines.join(newline) + (trailing ? newline : '');
}

async function atomicReplace(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

/** Persist the exact tenant selector read by scripts/dev/start-dev.ps1 and backend/src/lib/load-env.ts. */
export async function applyPersistentTenantActivation({ configPath, tenants = DEV_CANONICAL_TENANTS, backupPath }) {
  assertConfigPath(configPath);
  if (!path.isAbsolute(backupPath) || path.resolve(backupPath) === path.resolve(configPath)) throw new Error('Activation rollback evidence requires a separate absolute backup path.');
  if (JSON.stringify([...tenants].sort()) !== JSON.stringify([...DEV_CANONICAL_TENANTS].sort())) throw new Error('Persistent DEV activation requires exactly the reviewed two-tenant allowlist.');
  const original = await readFile(configPath, 'utf8');
  const prior = activationValue(original);
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(newline);
  const originalHadTrailingNewline = original.endsWith('\n');
  if (originalHadTrailingNewline) lines.pop();
  const nextLines = [...lines];
  if (prior.index >= 0) nextLines[prior.index] = `${key}=${tenants.join(',')}`;
  else nextLines.push(`${key}=${tenants.join(',')}`);
  const next = nextLines.join(newline) + (originalHadTrailingNewline ? newline : '');
  const body = {
    version: 1,
    configPath: path.resolve(configPath),
    beforeSha256: hash(original),
    afterSha256: hash(next),
    tenants: [...tenants],
    priorLine: prior.line,
    priorIndex: prior.index,
    originalHadTrailingNewline,
    newline,
    changed: next !== original,
  };
  const snapshot = wrap(body);
  await writeFile(backupPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  if (body.changed) await atomicReplace(configPath, next);
  if (hash(await readFile(configPath, 'utf8')) !== body.afterSha256) throw new Error('Persistent activation did not produce its reviewed configuration hash.');
  return { status: 'PASS', configPath: body.configPath, tenants: body.tenants, beforeSha256: body.beforeSha256, afterSha256: body.afterSha256, backupPath: path.resolve(backupPath), changed: body.changed };
}

export async function rollbackPersistentTenantActivation({ configPath, backupPath }) {
  assertConfigPath(configPath);
  const snapshot = JSON.parse(await readFile(backupPath, 'utf8'));
  const { sha256, ...body } = snapshot;
  if (sha256 !== hash(JSON.stringify(body)) || body.version !== 1 || body.configPath !== path.resolve(configPath)
    || JSON.stringify([...body.tenants].sort()) !== JSON.stringify([...DEV_CANONICAL_TENANTS].sort())) throw new Error('Activation rollback evidence is invalid or belongs to another DEV config.');
  const current = await readFile(configPath, 'utf8');
  if (hash(current) !== body.afterSha256) throw new Error('DEV environment changed after activation; rollback blocked to preserve newer configuration.');
  const restored = replaceActivationLine(current, { ...body, desired: null });
  if (hash(restored) !== body.beforeSha256) throw new Error('Activation rollback reconstruction does not match the original DEV config hash.');
  if (restored !== current) await atomicReplace(configPath, restored);
  return { status: 'PASS', configPath: body.configPath, tenants: body.tenants, restoredSha256: body.beforeSha256, currentSha256: body.afterSha256, changed: restored !== current };
}

export async function assertPersistentTenantActivation({ configPath, tenants = DEV_CANONICAL_TENANTS }) {
  assertConfigPath(configPath);
  const content = await readFile(configPath, 'utf8');
  const value = activationValue(content).value;
  if (value !== [...tenants].join(',')) throw new Error('Persistent DEV backend activation does not match the completed tenant allowlist.');
  return { status: 'PASS', configPath: path.resolve(configPath), tenants: [...tenants], configSha256: hash(content) };
}
