import { prisma } from './prisma.js';
import { registrarTransacao } from './transacao-log.js';
import { lockComandaItemsInTx } from './comanda-service.js';
import type { Prisma } from '@prisma/client';

const comandaInclude = {
  cliente: true,
  itens: {
    include: { produto: true, tap: { select: { id: true, numero: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  pagamentos: true,
};

export async function cancelarComandaVazia(params: {
  comandaId: string;
  cervejariaId: string;
  fechadoPorId: string;
  motivo?: 'manual' | 'empty_on_close';
}, existingTx?: Prisma.TransactionClient) {
  const run = async (tx: Prisma.TransactionClient) => {
    await lockComandaItemsInTx(tx, params.comandaId);
    const comanda = await tx.comanda.findFirst({
      where: {
        id: params.comandaId,
        status: 'ABERTA',
        evento: { cervejariaId: params.cervejariaId },
      },
      include: { itens: true },
    });

    if (!comanda) return { error: 'Comanda não encontrada ou já encerrada' as const };
    if (comanda.itens.length > 0) {
      return { error: 'Comanda com consumação deve ser fechada com pagamento' as const };
    }

    if (!comanda.eventoId) {
      return { error: 'Comanda sem evento associado' as const };
    }

    const updated = await tx.comanda.update({
      where: { id: params.comandaId },
      data: { status: 'CANCELADA', fechadoPorId: params.fechadoPorId },
      include: { ...comandaInclude, cliente: true },
    });

    await registrarTransacao({
      cervejariaId: params.cervejariaId,
      tipo: 'COMANDA_CANCELADA',
      usuarioId: params.fechadoPorId,
      eventoId: comanda.eventoId,
      comandaId: comanda.id,
      metadata: {
        clienteNome: updated.cliente?.nome ?? '',
        motivo: params.motivo ?? 'manual',
      },
      payload: updated,
    }, tx);

    return { ok: true as const, comanda: updated, eventoId: comanda.eventoId };
  };
  return existingTx ? run(existingTx) : prisma.$transaction(run);
}
