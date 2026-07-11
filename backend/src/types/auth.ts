import type { FastifyRequest } from 'fastify';

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
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireDono: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export function getAuthUser(request: FastifyRequest): JwtPayload {
  return request.user;
}
