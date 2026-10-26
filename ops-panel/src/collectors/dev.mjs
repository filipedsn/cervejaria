import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { firstLine, httpProbe, parseReleaseSha, run } from '../exec.mjs';

function pidFileAlive(file) {
  if (!existsSync(file)) return false;
  const pid = Number.parseInt(readFileSync(file, 'utf8'), 10);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Gravado por scripts/dev/copy-prd-to-dev.ps1 quando o banco do site é copiado para o DEV. */
const PRD_COPY_FILE = join(process.env.LOCALAPPDATA ?? '', 'QuiverTap', 'dev-backups', 'last-prd-copy.json');

function lastPrdCopy() {
  try {
    const data = JSON.parse(readFileSync(PRD_COPY_FILE, 'utf8').replace(/^\uFEFF/, ''));
    return typeof data?.at === 'string' ? data : null;
  } catch {
    return null;
  }
}

export async function collectDev() {
  const [docker, ready, health, web] = await Promise.all([
    run('docker', ['ps', '--format', '{{.Names}}|{{.Status}}'], { timeoutMs: 8_000 }),
    httpProbe(`${config.devApiUrl}/api/ready`),
    httpProbe(`${config.devApiUrl}/api/health`),
    httpProbe(`${config.devWebUrl}/`),
  ]);

  const dockerOk = docker.code === 0;
  const running = new Map(
    docker.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, ...status] = line.split('|');
        return [name, status.join('|')];
      }),
  );
  const containers = config.devContainers.map((name) => {
    const status = running.get(name) ?? null;
    const ok = Boolean(status) && /^Up\b/.test(status) && !/unhealthy|starting/.test(status);
    return { name, status, ok };
  });

  return {
    dockerOk,
    dockerError: dockerOk ? null : firstLine(docker.stderr),
    containers,
    apiReady: ready.ok,
    webOk: web.ok,
    releaseSha: parseReleaseSha(health.body),
    supervisorAlive: pidFileAlive(join(config.runtimeDir, 'dev-supervisor.pid')),
    prdCopy: lastPrdCopy(),
  };
}
