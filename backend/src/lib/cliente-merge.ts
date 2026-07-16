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

export async function mergeClientes(params: MergeClientesParams): Promise<MergeClientesResult> {
  const { cervejariaId, destinoId, fonteId } = params;

  if (destinoId === fonteId) {
    throw new ClienteMergeError('Selecione outro cliente para unir', 400);
  }

  const [destino, fonte] = await Promise.all([
    prisma.cliente.findFirst({
      where: { id: destinoId, cervejariaId },
    }),
    prisma.cliente.findFirst({
      where: { id: fonteId, cervejariaId },
    }),
  ]);

  if (!destino || !fonte) {
    throw new ClienteMergeError('Cliente não encontrado', 404);
  }

  if (destino.isSistema || fonte.isSistema) {
    throw new ClienteMergeError('Cliente de sistema não pode ser unido', 409);
  }

  if (destino.telefone && fonte.telefone && destino.telefone !== fonte.telefone) {
    throw new ClienteMergeError(
      'Os clientes têm telefones diferentes. Abra a ficha do cliente com o telefone correto e tente unir novamente.',
      409,
    );
  }

  return prisma.$transaction(async (tx) => {
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
