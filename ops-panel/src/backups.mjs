import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { firstLine, run } from './exec.mjs';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

async function fileSha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Grava `name` em `dir` pela chave restrita (backup-files.sh `get`). O arquivo só aparece
 * com o nome final depois que o sha256 confere; senão o parcial é apagado.
 * Devolve { path, bytes, verified, reused }.
 */
export async function downloadBackup({ host, dir, name, sha256 }) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, name);
  if (sha256 && existsSync(target) && (await fileSha256(target)) === sha256) {
    return { path: target, bytes: null, verified: true, reused: true };
  }
  const part = `${target}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  let stderr = '';
  const child = spawn('ssh', [...SSH_OPTIONS, host, 'get', name], { windowsHide: true });
  const timer = setTimeout(() => child.kill(), DOWNLOAD_TIMEOUT_MS);
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2_000);
  });
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  exited.catch(() => {});
  try {
    await pipeline(child.stdout, meter, createWriteStream(part));
    const code = await exited;
    if (code !== 0) throw new Error(firstLine(stderr) || `o servidor encerrou o download (código ${code})`);
    const digest = hash.digest('hex');
    if (sha256 && digest !== sha256) throw new Error('o arquivo chegou diferente do original (sha256 não confere); tente de novo');
    rmSync(target, { force: true });
    renameSync(part, target);
    return { path: target, bytes, verified: Boolean(sha256), reused: false };
  } catch (error) {
    child.kill();
    rmSync(part, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Apaga `name` no VPS (backup-files.sh `delete`); as travas valem no servidor. */
export async function deleteBackup({ host, name }) {
  const result = await run('ssh', [...SSH_OPTIONS, host, 'delete', name], { timeoutMs: 60_000 });
  if (result.code !== 0 || !result.stdout.includes(`DELETED ${name}`)) {
    throw new Error(firstLine(result.stderr) || firstLine(result.stdout) || `o servidor recusou (código ${result.code})`);
  }
}
