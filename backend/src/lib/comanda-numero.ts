import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

function lockKeyComandaEvento(eventoId: string): bigint {
  const digest = createHash('sha256').update(`comanda-evento:${eventoId}`).digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

function lockKeyComandaQuiosqueTurno(cervejariaId: string, pontoVendaId: string, abertoEm: Date): bigint {
  const digest = createHash('sha256')
    .update(`comanda-quiosque:${cervejariaId}:${pontoVendaId}:${abertoEm.toISOString()}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

/** Numero sequencial da comanda na operacao atual do evento (nao inclui vendas avulsas). */
export async function proximoNumeroComandaEvento(
  tx: TxClient,
  eventoId: string,
  contadorDesde: Date,
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKeyComandaEvento(eventoId)})`;

  const ultimo = await tx.comanda.findFirst({
    where: {
      eventoId,
      tipo: 'COMANDA',
      createdAt: { gte: contadorDesde },
    },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });

  return (ultimo?.numero ?? 0) + 1;
}

/** Numero sequencial da comanda no turno de caixa aberto (nao inclui vendas avulsas). */
export async function proximoNumeroComandaQuiosqueTurno(
  tx: TxClient,
  cervejariaId: string,
  pontoVendaId: string,
  turnoAbertoEm: Date,
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKeyComandaQuiosqueTurno(cervejariaId, pontoVendaId, turnoAbertoEm)})`;

  const ultimo = await tx.comanda.findFirst({
    where: {
      origem: 'QUIOSQUE',
      pontoVenda: { cervejariaId },
      pontoVendaId,
      tipo: { not: 'AVULSA' },
      createdAt: { gte: turnoAbertoEm },
    },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });

  return (ultimo?.numero ?? 0) + 1;
}
