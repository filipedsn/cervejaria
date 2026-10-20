import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { PDV_CLIENTE_COOKIE_NAME, isPdvClienteSessionPayload, type PdvClienteSessionPayload } from '../types/cliente-session.js';

export type PdvSessionValidationDependencies = {
  findOpenComanda(where: Prisma.ComandaWhereInput): Promise<{ id: string } | null>;
};

const defaultValidationDependencies: PdvSessionValidationDependencies = {
  findOpenComanda: (where) => prisma.comanda.findFirst({ where, select: { id: true } }),
};

export async function readPdvClienteSession(app: FastifyInstance, request: FastifyRequest): Promise<PdvClienteSessionPayload | undefined> {
  const token = request.cookies?.[PDV_CLIENTE_COOKIE_NAME];
  if (!token) return undefined;

  try {
    const decoded = await app.jwt.verify(token);
    return isPdvClienteSessionPayload(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Validates the signed PDV customer cookie before accepting customer UI audit events. */
export async function verifyPdvClienteSession(
  app: FastifyInstance,
  request: FastifyRequest,
  dependencies: PdvSessionValidationDependencies = defaultValidationDependencies,
): Promise<PdvClienteSessionPayload> {
  const session = await readPdvClienteSession(app, request);
  if (!session) throw app.httpErrors.unauthorized('Sessão inválida.');

  const comanda = await dependencies.findOpenComanda({
      id: session.comandaId,
      origem: 'CAIXA',
      pontoVenda: { cervejariaId: session.cervejariaId },
      pontoVendaId: session.pontoVendaId,
      clienteId: session.clienteId,
      status: 'ABERTA',
  });
  if (!comanda) throw app.httpErrors.unauthorized('Comanda encerrada. Identifique-se novamente.');
  return session;
}
