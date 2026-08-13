/**
 * O painel so escuta em localhost. Quem abre http://127.0.0.1:3099 no browser
 * desta maquina ja e o operador — nao faz sentido colar de novo o token que
 * esta no .env. CSRF de outra origem continua bloqueado pelo Origin.
 */

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

export function   allowedOrigins(port, extra = []) {
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    'http://127.0.0.1:3099',
    'http://localhost:3099',
    'http://127.0.0.1:3100',
    'http://localhost:3100',
    ...extra,
  ];
}

export function isAllowedOrigin(origin, port, extra = []) {
  if (!origin) return true;
  return allowedOrigins(port, extra).includes(origin);
}

export function isTrustedLocalOperator(request, { port, extraOrigins = [] } = {}) {
  const ip = request.ip || request.socket?.remoteAddress;
  if (!isLoopbackIp(ip)) return false;
  return isAllowedOrigin(originOf(request.headers || {}), port, extraOrigins);
}
