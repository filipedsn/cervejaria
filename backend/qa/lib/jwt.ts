import crypto from 'node:crypto';

// Mirrors app.ts: `secret: process.env.JWT_SECRET ?? 'dev-secret'`.
// Importing prisma elsewhere triggers .env loading, so JWT_SECRET matches the server.
export function jwtSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-secret';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

function hmac(data: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}

export interface SignOptions {
  secret?: string;
  alg?: 'HS256' | 'none';
  expiresInSec?: number;
  noExp?: boolean;
}

/** Sign an HS256 JWT (or alg=none) exactly like @fastify/jwt would consume. */
export function signToken(payload: Record<string, unknown>, opts: SignOptions = {}): string {
  const alg = opts.alg ?? 'HS256';
  const secret = opts.secret ?? jwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: Record<string, unknown> = { iat: now, ...payload };
  if (!opts.noExp && opts.expiresInSec !== undefined) {
    fullPayload.exp = now + opts.expiresInSec;
  }

  const header = { alg, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(fullPayload)}`;

  if (alg === 'none') {
    return `${signingInput}.`;
  }
  return `${signingInput}.${hmac(signingInput, secret)}`;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

export function decodeToken(token: string): DecodedJwt | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf-8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    return { header, payload, signature: parts[2] ?? '' };
  } catch {
    return null;
  }
}

/** Build JWT payload matching signUserToken (includes pwdAt). */
export function userJwtPayload(usuario: {
  id: string;
  email: string;
  nome: string;
  papel: string;
  cervejariaId: string | null;
  passwordChangedAt: Date;
}): Record<string, unknown> {
  return {
    sub: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    papel: usuario.papel,
    cervejariaId: usuario.cervejariaId,
    pwdAt: usuario.passwordChangedAt.getTime(),
  };
}

/** Corrupt signature and payload so verification always fails. */
export function tamperSignature(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) return `${token}invalid`;
  const payload = parts[1].slice(0, -1) + (parts[1].slice(-1) === 'A' ? 'B' : 'A');
  return `${parts[0]}.${payload}.TAMPERED_SIGNATURE`;
}
