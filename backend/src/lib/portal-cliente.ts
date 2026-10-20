import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { registerOrUpdateCliente } from './cliente-resolver.js';
import { normalizePhone } from './phone.js';
import { proximoNumeroComandaEvento } from './comanda-numero.js';

export type PortalClienteLookupResult =
  | { encontrado: true; nome: string }
  | { encontrado: false };

export const CLIENTE_PORTAL_INATIVO_MESSAGE = 'Não foi possível abrir ou enviar pedidos por este portal. Procure a equipe do ponto de venda.';

export class ClientePortalInativoError extends Error {
  constructor() {
    super(CLIENTE_PORTAL_INATIVO_MESSAGE);
    this.name = 'ClientePortalInativoError';
  }
}

/** Canonical PDV registration runs inside the opening transaction and never reactivates an existing client. */
export async function registerClientePortalPdv(
  tx: Prisma.TransactionClient,
  params: { cervejariaId: string; nome: string; telefone: string },
) {
  const lockKey = `${params.cervejariaId}:${params.telefone}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const locked = await tx.$queryRaw<Array<{ id: string; ativo: boolean }>>`
    SELECT "id", "ativo" FROM "Cliente"
    WHERE "cervejariaId" = ${params.cervejariaId} AND "telefone" = ${params.telefone}
    FOR UPDATE
  `;
  const existing = locked[0];
  if (existing && !existing.ativo) throw new ClientePortalInativoError();

  if (existing) {
    return tx.cliente.update({
      where: { id: existing.id },
      data: { nome: params.nome.trim(), optInMarketing: false },
    });
  }

  return tx.cliente.create({
    data: {
      nome: params.nome.trim(),
      telefone: params.telefone,
      optInMarketing: false,
      cadastradoVia: 'AUTO_ATENDIMENTO',
      cervejariaId: params.cervejariaId,
    },
  });
}

export async function lookupClientePortalPorTelefone(
  cervejariaId: string,
  telefone: string,
): Promise<PortalClienteLookupResult> {
  const normalized = normalizePhone(telefone);
  if (!normalized) return { encontrado: false };

  const cliente = await prisma.cliente.findFirst({
    where: {
      cervejariaId,
      telefone: normalized,
      ativo: true,
      isSistema: false,
    },
    select: { nome: true },
  });

  if (!cliente) return { encontrado: false };
  return { encontrado: true, nome: cliente.nome };
}

function comandaLockKey(eventoId: string, clienteId: string) {
  return `${eventoId}:${clienteId}`;
}

export async function findOpenEventoForTrailer(cervejariaId: string, trailerId: string) {
  return prisma.evento.findFirst({
    where: {
      cervejariaId,
      trailerId,
      status: 'ABERTO',
      data: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      nome: true,
      local: true,
      data: true,
      horaInicio: true,
      horaFim: true,
      trailerId: true,
      cervejariaId: true,
      portalGeneration: true,
    },
  });
}

export async function resolveTrailerPortalContext(slug: string, trailerId: string) {
  const cervejaria = await prisma.cervejaria.findFirst({
    where: { slug, ativo: true },
    select: {
      id: true,
      nome: true,
      slug: true,
      logoUrl: true,
      updatedAt: true,
      portalBackgroundUrl: true,
      corPrimaria: true,
      corPaleta: true,
    },
  });
  if (!cervejaria) return null;

  const trailer = await prisma.trailer.findFirst({
    where: { id: trailerId, cervejariaId: cervejaria.id, ativo: true },
    select: { id: true, nome: true, identificador: true },
  });
  if (!trailer) return null;

  const evento = await findOpenEventoForTrailer(cervejaria.id, trailer.id);

  return { cervejaria, trailer, evento };
}

export async function findOrCreateComandaAberta(params: {
  eventoId: string;
  clienteId: string;
  contadorDesde: Date;
}) {
  const where = {
    eventoId: params.eventoId,
    clienteId: params.clienteId,
    status: 'ABERTA' as const,
  };

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${comandaLockKey(params.eventoId, params.clienteId)})))`;

    const existing = await tx.comanda.findFirst({ where });
    if (existing) return existing;

    const numero = await proximoNumeroComandaEvento(tx, params.eventoId, params.contadorDesde);
    return tx.comanda.create({
      data: {
        eventoId: params.eventoId,
        clienteId: params.clienteId,
        numero,
      },
    });
  });
}

export async function startClientePortalSession(params: {
  cervejariaId: string;
  eventoId: string;
  trailerId: string;
  nome: string;
  telefone: string;
}) {
  const evento = await prisma.evento.findFirst({
    where: {
      id: params.eventoId,
      cervejariaId: params.cervejariaId,
      trailerId: params.trailerId,
      status: 'ABERTO',
    },
    select: { id: true, portalGeneration: true, comandasContadorDesde: true },
  });
  if (!evento) {
    throw new Error('Evento não está mais aberto');
  }

  const cliente = await registerOrUpdateCliente({
    cervejariaId: params.cervejariaId,
    nome: params.nome,
    telefone: params.telefone,
    optInMarketing: false,
    cadastradoVia: 'AUTO_ATENDIMENTO',
  });

  const comanda = await findOrCreateComandaAberta({
    eventoId: params.eventoId,
    clienteId: cliente.id,
    contadorDesde: evento.comandasContadorDesde,
  });

  return { cliente, comanda, portalGeneration: evento.portalGeneration };
}
