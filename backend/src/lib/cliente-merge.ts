import { createHash } from 'node:crypto';
import { prisma } from './prisma.js';
import { recalculateClienteStats } from './cliente-stats.js';

export class ClienteMergeError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ClienteMergeError';
    this.statusCode = statusCode;
  }
}

type MergeClientesParams = {
  cervejariaId: string;
  destinoId: string;
  fonteId: string;
};

export type MergeClientesResult = {
  comandasMovidas: number;
  pedidosMovidos: number;
};

/** Chave de 64 bits estável para o advisory lock de um cliente. */
function lockKeyDoCliente(clienteId: string): bigint {
  const digest = createHash('sha256').update(`cliente-merge:${clienteId}`).digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

export async function mergeClientes(params: MergeClientesParams): Promise<MergeClientesResult> {
  const { cervejariaId, destinoId, fonteId } = params;

  if (destinoId === fonteId) {
    throw new ClienteMergeError('Selecione outro cliente para unir', 400);
  }

  return prisma.$transaction(async (tx) => {
    // Dois merges simultâneos sobre a mesma fonte deixariam o segundo apagar um
    // registro já removido (P2025 → 500). Os locks serializam o par; a ordem
    // fixa por id evita deadlock quando alguém tenta A→B e B→A ao mesmo tempo.
    for (const id of [destinoId, fonteId].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKeyDoCliente(id)})`;
    }

    const [destino, fonte] = await Promise.all([
      tx.cliente.findFirst({ where: { id: destinoId, cervejariaId } }),
      tx.cliente.findFirst({ where: { id: fonteId, cervejariaId } }),
    ]);

    if (!destino || !fonte) {
      throw new ClienteMergeError('Cliente não encontrado', 404);
    }

    if (destino.isSistema || fonte.isSistema) {
      throw new ClienteMergeError('Cliente de sistema não pode ser unido', 409);
    }

    const comandasMovidas = await tx.comanda.updateMany({
      where: { clienteId: fonteId },
      data: { clienteId: destinoId },
    });

    const pedidosMovidos = await tx.pedidoCliente.updateMany({
      where: { clienteId: fonteId },
      data: { clienteId: destinoId },
    });

    await tx.cliente.update({
      where: { id: destinoId },
      data: {
        telefone: destino.telefone ?? fonte.telefone,
        email: destino.email ?? fonte.email,
        dataNascimento: destino.dataNascimento ?? fonte.dataNascimento,
        observacoes: destino.observacoes ?? fonte.observacoes,
        optInMarketing: destino.optInMarketing || fonte.optInMarketing,
        optInEm:
          destino.optInMarketing || fonte.optInMarketing
            ? (destino.optInEm ?? fonte.optInEm ?? new Date())
            : destino.optInEm,
      },
    });

    await recalculateClienteStats(tx, destinoId);
    await tx.cliente.delete({ where: { id: fonteId } });

    return {
      comandasMovidas: comandasMovidas.count,
      pedidosMovidos: pedidosMovidos.count,
    };
  });
}
