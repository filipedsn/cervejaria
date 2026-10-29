import os from 'node:os';

const VIRTUAL_INTERFACE_RE =
  /vethernet|virtual|wsl|hyper-v|vmware|virtualbox|default switch|bluetooth|loopback/i;

const PREFERRED_INTERFACE_RE = /^(ethernet|wi-fi|wlan)/i;

function isPrivateIPv4(ip: string) {
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match) {
    const second = Number.parseInt(match[1], 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isIPv4Entry(family: string | number) {
  return family === 'IPv4' || family === 4;
}

function scoreLanCandidate(name: string, address: string) {
  if (VIRTUAL_INTERFACE_RE.test(name)) return -1000;

  let score = 0;
  const trimmed = name.trim();
  if (PREFERRED_INTERFACE_RE.test(trimmed)) score += 100;
  if (address.startsWith('192.168.')) score += 20;
  return score;
}

/** Hostnames legados (tunnel/DNS externo de DEV) — não usar em QR/links locais. */
const LEGACY_DEV_PUBLIC_HOST_RE = /(^|\.)tapdev\.quivercloud\.com\.br$/i;

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function resolveLanFrontendOrigin(port: string): string | null {
  const nets = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string; score: number }> = [];

  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (!isIPv4Entry(net.family) || net.internal) continue;
      if (!isPrivateIPv4(net.address)) continue;

      const score = scoreLanCandidate(name, net.address);
      if (score < 0) continue;

      candidates.push({ name, address: net.address, score });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return `http://${candidates[0].address}:${port}`;
}

/**
 * URL do frontend DEV acessível na LAN (celular na mesma Wi-Fi).
 * Prefere IP privado:5202. Ignora APP_URL apontando para tapdev/tunnel legado.
 */
export function getDevFrontendOrigin(): string | null {
  const port = process.env.DEV_FRONTEND_PORT ?? '5202';
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      const hostname = new URL(appUrl).hostname;
      if (
        !isLoopbackHostname(hostname) &&
        !LEGACY_DEV_PUBLIC_HOST_RE.test(hostname)
      ) {
        return appUrl.replace(/\/$/, '');
      }
    } catch {
      // ignore URL inválida
    }
  }

  return resolveLanFrontendOrigin(port);
}
