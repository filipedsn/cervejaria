import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { cached, collect, firstLine, httpProbe, parseReleaseSha, run } from '../exec.mjs';
import { historySample, pushSample } from '../infra.mjs';

const HISTORY_FILE = join(config.runtimeDir, 'vps-history.json');

function loadHistory() {
  try {
    const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let history = loadHistory();

function remember(report) {
  const next = pushSample(history, historySample(report));
  if (next === history) return;
  history = next;
  try {
    mkdirSync(config.runtimeDir, { recursive: true });
    writeFileSync(HISTORY_FILE, JSON.stringify(history), 'utf8');
  } catch {
    // histórico é só para os mini-gráficos; sem disco, fica em memória
  }
}

async function collectVps() {
  const result = await run(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', config.vpsSshHost, 'report'],
    { timeoutMs: 20_000 },
  );
  if (result.code !== 0) throw new Error(firstLine(result.stderr) || `ssh saiu com código ${result.code}`);
  const report = JSON.parse(result.stdout);
  remember(report);
  return report;
}

export async function collectPrd({ force = false, vpsMaxAgeMs = 60_000 } = {}) {
  const ts = Date.now();
  const [health, ready, vps] = await Promise.all([
    httpProbe(`${config.prdUrl}/api/health?ts=${ts}`, 8_000),
    httpProbe(`${config.prdUrl}/api/ready?ts=${ts}`, 8_000),
    config.vpsSshHost
      ? cached('vps', vpsMaxAgeMs, () => collect(collectVps), force)
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
    vpsHistory: history,
  };
}
