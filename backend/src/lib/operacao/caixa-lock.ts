import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Serializes mutations of one point of sale within an operational day. */
function chaveLockCaixa(cervejariaId: string, pontoVendaId: string, dia: Date): bigint {
  const digest = createHash('sha256')
    .update(`caixa-operacao:${cervejariaId}:${pontoVendaId}:${dia.toISOString().slice(0, 10)}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

export async function lockCaixaEmTx(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  cervejariaId: string,
  pontoVendaId: string,
  dia: Date,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chaveLockCaixa(cervejariaId, pontoVendaId, dia)})`;
}
