import { config } from '../config.mjs';
import { cached, collect, firstLine, httpProbe, parseReleaseSha, run } from '../exec.mjs';

async function collectVps() {
  const result = await run(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', config.vpsSshHost, 'report'],
    { timeoutMs: 15_000 },
  );
  if (result.code !== 0) throw new Error(firstLine(result.stderr) || `ssh saiu com código ${result.code}`);
  return JSON.parse(result.stdout);
}

export async function collectPrd({ force = false } = {}) {
  const ts = Date.now();
  const [health, ready, vps] = await Promise.all([
    httpProbe(`${config.prdUrl}/api/health?ts=${ts}`, 8_000),
    httpProbe(`${config.prdUrl}/api/ready?ts=${ts}`, 8_000),
    config.vpsSshHost
      ? cached('vps', 60_000, () => collect(collectVps), force)
      : Promise.resolve(null),
  ]);
  let startedAt = null;
  try {
    startedAt = JSON.parse(health.body).startedAt ?? null;
  } catch {
    // corpo não-JSON: health fora
  }
  return {
    url: config.prdUrl,
    healthOk: health.ok,
    readyOk: ready.ok,
    readyStatus: ready.status,
    latencyMs: health.ms,
    releaseSha: parseReleaseSha(health.body),
    startedAt,
    vps: vps ? { configured: true, ...vps } : { configured: false },
  };
}
