import { prisma } from './prisma.js';
import { registrarTransacao } from './transacao-log.js';

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
}) {
  const comanda = await prisma.comanda.findFirst({
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

  const updated = await prisma.comanda.update({
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
      clienteNome: updated.cliente.nome,
      motivo: params.motivo ?? 'manual',
    },
  });

  return { ok: true as const, comanda: updated, eventoId: comanda.eventoId };
}
