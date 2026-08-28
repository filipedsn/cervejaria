import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ClienteSessionPayload } from './cliente-session.js';

export interface JwtPayload {
  sub: string;
  email: string;
  nome: string;
  papel: 'ADMIN' | 'DONO' | 'ATENDENTE';
  cervejariaId: string | null;
  pwdAt: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload | ClienteSessionPayload;
    user: JwtPayload;
  }
}

export type TenantJwtPayload = JwtPayload & { cervejariaId: string };

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireTenant: (request: FastifyRequest) => Promise<void>;
    requireDono: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export function getAuthUser(request: FastifyRequest): JwtPayload {
  return request.user;
}

export function getTenantUser(app: FastifyInstance, request: FastifyRequest): TenantJwtPayload {
  const user = getAuthUser(request);
  const { cervejariaId } = user;
  if (!cervejariaId) {
    throw app.httpErrors.forbidden('Rota exclusiva de cervejaria');
  }
  return { ...user, cervejariaId };
}
