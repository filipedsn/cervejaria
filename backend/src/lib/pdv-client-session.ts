import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { PDV_CLIENTE_COOKIE_NAME, isPdvClienteSessionPayload, type PdvClienteSessionPayload } from '../types/cliente-session.js';

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
export async function verifyPdvClienteSession(app: FastifyInstance, request: FastifyRequest): Promise<PdvClienteSessionPayload> {
  const session = await readPdvClienteSession(app, request);
  if (!session) throw app.httpErrors.unauthorized('Sessão inválida.');

  const comanda = await prisma.comanda.findFirst({
    where: {
      id: session.comandaId,
      origem: 'CAIXA',
      pontoVenda: { cervejariaId: session.cervejariaId },
      pontoVendaId: session.pontoVendaId,
      clienteId: session.clienteId,
      status: 'ABERTA',
    },
    select: { id: true },
  });
  if (!comanda) throw app.httpErrors.unauthorized('Comanda encerrada. Identifique-se novamente.');
  return session;
}
