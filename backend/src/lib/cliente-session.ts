import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CLIENTE_COOKIE_NAME, isClienteSessionPayload, type ClienteSessionPayload } from '../types/cliente-session.js';

const CLIENTE_SESSION_MAX_AGE = 12 * 60 * 60; // 12h

export function signClienteSession(app: FastifyInstance, payload: Omit<ClienteSessionPayload, 'type'>) {
  return app.jwt.sign({ type: 'cliente', ...payload }, { expiresIn: '12h' });
}

export function setClienteSessionCookie(reply: import('fastify').FastifyReply, token: string) {
  reply.setCookie(CLIENTE_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: CLIENTE_SESSION_MAX_AGE,
  });
}

export async function verifyClienteSession(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<ClienteSessionPayload> {
  const token = request.cookies[CLIENTE_COOKIE_NAME];
  if (!token) {
    throw app.httpErrors.unauthorized('Sessão expirada. Identifique-se novamente.');
  }

  let decoded: unknown;
  try {
    decoded = await app.jwt.verify(token);
  } catch {
    throw app.httpErrors.unauthorized('Sessão inválida. Identifique-se novamente.');
  }

  if (!isClienteSessionPayload(decoded)) {
    throw app.httpErrors.unauthorized('Sessão inválida.');
  }

  return decoded;
}

export function registerClienteSessionAuth(app: FastifyInstance) {
  app.decorate('authenticateCliente', async (request: FastifyRequest) => {
    request.clienteSession = await verifyClienteSession(app, request);
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    clienteSession?: ClienteSessionPayload;
  }
  interface FastifyInstance {
    authenticateCliente: (request: FastifyRequest) => Promise<void>;
  }
}

export function getClienteSession(request: FastifyRequest): ClienteSessionPayload {
  if (!request.clienteSession) {
    throw new Error('Cliente session not authenticated');
  }
  return request.clienteSession;
}
