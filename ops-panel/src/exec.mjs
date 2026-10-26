import { execFile } from 'node:child_process';

export function firstLine(text) {
  return String(text ?? '').trim().split(/\r?\n/)[0]?.slice(0, 300) ?? '';
}

/** Executa sem shell; nunca lança — devolve { code, stdout, stderr }. */
export function run(cmd, args, { cwd, timeoutMs = 15_000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr || (error ? error.message : '') });
      },
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function runJson(cmd, args, options) {
  const result = await run(cmd, args, options);
  if (result.code !== 0) throw new Error(firstLine(result.stderr) || `${cmd} saiu com código ${result.code}`);
  return JSON.parse(result.stdout || 'null');
}

export async function httpProbe(url, timeoutMs = 4_000) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'cache-control': 'no-cache' },
      redirect: 'manual',
    });
    const body = (await res.text()).slice(0, 4_096);
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, body: '', ms: Date.now() - started, error: error.message };
  }
}

export function parseReleaseSha(body) {
  const match = String(body ?? '').match(/"releaseSha"\s*:\s*"([0-9a-f]{7,40})"/);
  return match ? match[1] : null;
}

/** Coletor nunca derruba o snapshot: devolve { ok, data } ou { ok:false, error }. */
export async function collect(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const cache = new Map();
export async function cached(key, ttlMs, fn, force = false) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
