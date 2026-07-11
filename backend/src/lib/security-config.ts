const isProd = process.env.NODE_ENV === 'production';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && isProd) {
    throw new Error('JWT_SECRET é obrigatório em produção');
  }
  return secret ?? 'dev-secret';
}

export function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? '8h';
}

export function getCorsOrigin():
  | string[]
  | boolean
  | ((origin: string, callback: (err: Error | null, allow: boolean) => void) => void) {
  const raw = process.env.CORS_ORIGIN;

  if (isProd) {
    if (!raw) {
      throw new Error('CORS_ORIGIN é obrigatório em produção');
    }
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
  }

  const explicit = raw?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];

  // Dev: localhost + IPs da rede local (teste no celular via Wi-Fi)
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (explicit.includes(origin)) {
      callback(null, true);
      return;
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    if (
      /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
        origin,
      )
    ) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

/** Converts JWT expiresIn (e.g. "8h", "30m") to seconds for cookie maxAge. */
export function jwtExpiresInSeconds(): number {
  const raw = getJwtExpiresIn();
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 8 * 3600;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 3600;
  return n * mult;
}

export const AUTH_COOKIE_NAME = 'token';

export const RATE_LIMIT_LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10);
export const RATE_LIMIT_FORGOT_MAX = Number(process.env.RATE_LIMIT_FORGOT_MAX ?? 5);
export const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW ?? '1 minute';
