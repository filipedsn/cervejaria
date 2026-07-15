import { prisma } from './prisma.js';
import { registerOrUpdateCliente } from './cliente-resolver.js';

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

    return tx.comanda.create({
      data: {
        eventoId: params.eventoId,
        clienteId: params.clienteId,
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
    select: { id: true },
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
  });

  return { cliente, comanda };
}
