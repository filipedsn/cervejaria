/**
 * O painel só escuta em 127.0.0.1 e só atende o navegador desta máquina.
 * Ações (POST) exigem o header x-ops-panel: um formulário de outra origem não consegue enviá-lo
 * sem preflight CORS, que o painel não libera.
 */

export const ACTION_HEADER = 'x-ops-panel';

export function normalizeIp(ip) {
  return String(ip || '')
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '');
}

export function isLoopbackIp(ip) {
  const value = normalizeIp(ip);
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

export function originOf(headers = {}) {
  if (headers.origin) return String(headers.origin);
  const referer = headers.referer;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function allowedOrigins(port) {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

export function isAllowedOrigin(origin, port) {
  if (!origin) return true;
  return allowedOrigins(port).includes(origin);
}

export function isTrustedLocalOperator(request, { port } = {}) {
  const ip = request.ip || request.socket?.remoteAddress;
  if (!isLoopbackIp(ip)) return false;
  return isAllowedOrigin(originOf(request.headers || {}), port);
}

export function isAllowedAction(request, options) {
  return isTrustedLocalOperator(request, options) && request.headers?.[ACTION_HEADER] === '1';
}
