import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Serializes mutations of the active cash session for one point of sale. */
function chaveLockCaixa(cervejariaId: string, pontoVendaId: string): bigint {
  const digest = createHash('sha256')
    .update(`caixa-operacao:${cervejariaId}:${pontoVendaId}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

export async function lockCaixaEmTx(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  cervejariaId: string,
  pontoVendaId: string,
  _dia?: Date,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chaveLockCaixa(cervejariaId, pontoVendaId)})`;
}
