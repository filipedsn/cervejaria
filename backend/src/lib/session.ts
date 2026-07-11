import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from './prisma.js';
import { assertCervejariaAtiva } from './cervejaria.js';
import {
  AUTH_COOKIE_NAME,
  jwtExpiresInSeconds,
} from './security-config.js';
import type { JwtPayload } from '../types/auth.js';

type UsuarioForToken = {
  id: string;
  email: string;
  nome: string;
  papel: string;
  cervejariaId: string | null;
  passwordChangedAt: Date;
};

export function signUserToken(app: FastifyInstance, usuario: UsuarioForToken): string {
  return app.jwt.sign({
    sub: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    papel: usuario.papel as JwtPayload['papel'],
    cervejariaId: usuario.cervejariaId,
    pwdAt: usuario.passwordChangedAt.getTime(),
  });
}

export function setAuthCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: jwtExpiresInSeconds(),
  });
}

export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

export async function verifySession(app: FastifyInstance, request: import('fastify').FastifyRequest) {
  await request.jwtVerify();
  const user = request.user as JwtPayload;

  const usuario = await prisma.usuario.findUnique({
    where: { id: user.sub },
    select: { id: true, passwordChangedAt: true },
  });
  if (!usuario) {
    throw app.httpErrors.unauthorized('Sessão inválida');
  }

  if (user.pwdAt === undefined || user.pwdAt !== usuario.passwordChangedAt.getTime()) {
    throw app.httpErrors.unauthorized('Sessão expirada. Faça login novamente.');
  }

  await assertCervejariaAtiva(app, user.cervejariaId, user.papel);
}

export async function verifyJwtPayload(app: FastifyInstance, payload: JwtPayload): Promise<JwtPayload> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, passwordChangedAt: true },
  });
  if (!usuario) {
    throw app.httpErrors.unauthorized('Sessão inválida');
  }
  if (payload.pwdAt === undefined || payload.pwdAt !== usuario.passwordChangedAt.getTime()) {
    throw app.httpErrors.unauthorized('Sessão expirada');
  }
  await assertCervejariaAtiva(app, payload.cervejariaId, payload.papel);
  return payload;
}
