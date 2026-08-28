import type { FastifyCorsOptions } from '@fastify/cors';
import type { CorsOptions } from 'cors';

const isProd = process.env.NODE_ENV === 'production';

type FastifyCorsOrigin = NonNullable<FastifyCorsOptions['origin']>;
type SocketCorsOrigin = NonNullable<CorsOptions['origin']>;

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

function getConfiguredCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;

  return raw?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
}

function isAllowedDevCorsOrigin(origin: string | undefined, explicit: string[]): boolean {
  if (!origin) return true;
  if (explicit.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  if (
    /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
      origin,
    )
  ) {
    return true;
  }
  return /^https?:\/\/([a-z0-9-]+\.)*quivercloud\.com\.br(:\d+)?$/i.test(origin);
}

export function getCorsOrigin(): FastifyCorsOrigin {
  const raw = process.env.CORS_ORIGIN;

  if (isProd) {
    if (!raw) {
      throw new Error('CORS_ORIGIN é obrigatório em produção');
    }
    return getConfiguredCorsOrigins();
  }

  const explicit = getConfiguredCorsOrigins();

  // Dev: localhost + IPs da rede local (teste no celular via Wi-Fi)
  return (origin, callback) => {
    callback(null, isAllowedDevCorsOrigin(origin, explicit));
  };
}

export function getSocketCorsOrigin(): SocketCorsOrigin {
  const raw = process.env.CORS_ORIGIN;

  if (isProd) {
    if (!raw) {
      throw new Error('CORS_ORIGIN é obrigatório em produção');
    }
    return getConfiguredCorsOrigins();
  }

  const explicit = getConfiguredCorsOrigins();
  return (origin, callback) => {
    callback(null, isAllowedDevCorsOrigin(origin, explicit));
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

/**
 * A suíte de QA autentica dezenas de vezes por minuto a partir de um único IP,
 * o que estouraria o limite real. Mesma válvula já usada nas rotas públicas.
 */
export const RATE_LIMIT_LOGIN_MAX =
  process.env.QA_MODE === '1'
    ? Number(process.env.QA_RATE_LIMIT_LOGIN_MAX ?? 500)
    : Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10);
export const RATE_LIMIT_FORGOT_MAX = Number(process.env.RATE_LIMIT_FORGOT_MAX ?? 5);
export const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW ?? '1 minute';
