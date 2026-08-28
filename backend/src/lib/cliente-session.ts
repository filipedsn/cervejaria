import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from './prisma.js';
import { findOpenEventoForTrailer } from './portal-cliente.js';
import {
  CLIENTE_COOKIE_NAME,
  isClienteSessionPayload,
  type ClienteSessionPayload,
} from '../types/cliente-session.js';

const CLIENTE_SESSION_MAX_AGE = 12 * 60 * 60; // 12h

export type ClienteSessionFailureReason =
  | 'evento_invalido'
  | 'evento_fechado'
  | 'portal_generation_invalida'
  | 'contexto_portal_invalido'
  | 'comanda_invalida';

/** Erro de sessão categorizado para logs internos; a resposta externa continua genérica. */
export class ClienteSessionValidationError extends Error {
  constructor(
    readonly reason: ClienteSessionFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ClienteSessionValidationError';
  }
}

export function signClienteSession(app: FastifyInstance, payload: Omit<ClienteSessionPayload, 'type'>) {
  return app.jwt.sign({ type: 'cliente', ...payload }, { expiresIn: '12h' });
}

export function setClienteSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(CLIENTE_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: CLIENTE_SESSION_MAX_AGE,
  });
}

export function clearClienteSessionCookie(reply: FastifyReply) {
  reply.clearCookie(CLIENTE_COOKIE_NAME, { path: '/' });
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

  try {
    return await validateClienteSession(decoded);
  } catch (error) {
    if (error instanceof ClienteSessionValidationError) {
      throw app.httpErrors.unauthorized(error.message);
    }
    throw error;
  }
}

/**
 * Fonte única de verdade da sessão do portal para HTTP e Socket.IO.
 * Os campos do JWT são apenas uma alegação assinada: o estado atual vem do banco.
 */
export async function validateClienteSession(
  session: ClienteSessionPayload,
): Promise<ClienteSessionPayload> {

  const evento = await prisma.evento.findFirst({
    where: { id: session.eventoId, cervejariaId: session.cervejariaId },
    select: {
      id: true,
      status: true,
      trailerId: true,
      portalGeneration: true,
    },
  });

  if (!evento) {
    throw new ClienteSessionValidationError(
      'evento_invalido',
      'Sessão encerrada. Escaneie o QR Code novamente.',
    );
  }

  if (evento.status !== 'ABERTO') {
    throw new ClienteSessionValidationError(
      'evento_fechado',
      'Sessão encerrada. Escaneie o QR Code novamente.',
    );
  }

  if (evento.portalGeneration !== session.portalGeneration) {
    throw new ClienteSessionValidationError(
      'portal_generation_invalida',
      'Sessão encerrada. Escaneie o QR Code novamente.',
    );
  }

  const openEvento = await findOpenEventoForTrailer(session.cervejariaId, session.trailerId);
  if (!openEvento || openEvento.id !== session.eventoId) {
    throw new ClienteSessionValidationError(
      'contexto_portal_invalido',
      'Sessão encerrada. Escaneie o QR Code novamente.',
    );
  }

  const comanda = await prisma.comanda.findFirst({
    where: {
      id: session.comandaId,
      eventoId: session.eventoId,
      clienteId: session.clienteId,
      status: 'ABERTA',
    },
    select: { id: true },
  });

  if (!comanda) {
    throw new ClienteSessionValidationError(
      'comanda_invalida',
      'Sessão encerrada. Escaneie o QR Code novamente.',
    );
  }

  return session;
}

export function emitPortalSessionExpired(
  io: SocketIOServer | undefined,
  eventoId: string,
  reason: 'evento_fechado' | 'evento_reaberto' | 'evento_revertido',
) {
  io?.to(`portal:evento:${eventoId}`).emit('portal:session-expired', { eventoId, reason });
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
