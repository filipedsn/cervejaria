import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from './prisma.js';
import { isSerie } from './evento-utils.js';
import { cancelarComandaVazia } from './comanda-cancelar.js';
import { emitPortalSessionExpired } from './cliente-session.js';
import { registrarTransacao } from './transacao-log.js';

export type EventoRevertivel = {
  id: string;
  status: string;
  recorrencia: string;
  serieId: string | null;
  nome: string;
  data: Date | null;
};

/**
 * Colunas `@db.Date` chegam do Prisma como meia-noite UTC. Ler com getters
 * locais joga a chave para o dia anterior em qualquer fuso negativo, que e o
 * caso do Brasil — daí a leitura em UTC.
 */
export function dateOnlyToKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function assertPodeReverterEvento(
  evento: EventoRevertivel,
): { ok: true } | { ok: false; motivo: string } {
  if (isSerie(evento)) {
    return {
      ok: false,
      motivo: 'Agendas recorrentes não podem ser revertidas — reverta a sessão do dia.',
    };
  }
  if (evento.status !== 'ABERTO') {
    return { ok: false, motivo: 'Só é possível reverter eventos ao vivo.' };
  }
  return { ok: true };
}

export async function getEventoMovimentacaoFinanceira(eventoId: string) {
  const fechadas = await prisma.comanda.count({
    where: { eventoId, status: 'FECHADA' },
  });
  if (fechadas > 0) {
    return {
      bloqueado: true,
      motivo: 'Não é possível reverter: já existem vendas registradas.',
      comandasAbertasVazias: [] as string[],
    };
  }

  const abertasComItens = await prisma.comanda.count({
    where: {
      eventoId,
      status: 'ABERTA',
      itens: { some: {} },
    },
  });
  if (abertasComItens > 0) {
    return {
      bloqueado: true,
      motivo: 'Não é possível reverter: existem comandas com consumo em andamento.',
      comandasAbertasVazias: [] as string[],
    };
  }

  const pedidosConfirmados = await prisma.pedidoCliente.count({
    where: { eventoId, status: 'CONFIRMADO' },
  });
  if (pedidosConfirmados > 0) {
    return {
      bloqueado: true,
      motivo: 'Não é possível reverter: existem pedidos confirmados no portal.',
      comandasAbertasVazias: [] as string[],
    };
  }

  const comandasAbertasVazias = await prisma.comanda.findMany({
    where: {
      eventoId,
      status: 'ABERTA',
      itens: { none: {} },
    },
    select: { id: true },
  });

  return {
    bloqueado: false,
    motivo: undefined as string | undefined,
    comandasAbertasVazias: comandasAbertasVazias.map((c) => c.id),
  };
}

export async function reverterEventoParaAgendado(params: {
  eventoId: string;
  cervejariaId: string;
  usuarioId: string;
  io?: SocketIOServer;
}) {
  const evento = await prisma.evento.findFirst({
    where: { id: params.eventoId, cervejariaId: params.cervejariaId },
  });

  if (!evento) {
    return { error: 'Evento não encontrado', status: 404 as const };
  }

  const pode = assertPodeReverterEvento(evento);
  if (!pode.ok) {
    return { error: pode.motivo, status: 400 as const };
  }

  const mov = await getEventoMovimentacaoFinanceira(evento.id);
  if (mov.bloqueado) {
    return { error: mov.motivo!, status: 409 as const };
  }

  for (const comandaId of mov.comandasAbertasVazias) {
    const cancel = await cancelarComandaVazia({
      comandaId,
      cervejariaId: params.cervejariaId,
      fechadoPorId: params.usuarioId,
      motivo: 'manual',
    });
    if ('error' in cancel) {
      return { error: cancel.error, status: 409 as const };
    }
  }

  const modo = evento.serieId ? ('serie' as const) : ('avulso' as const);
  const dataKey = evento.data ? dateOnlyToKey(evento.data) : null;

  emitPortalSessionExpired(params.io, evento.id, 'evento_revertido');

  await registrarTransacao({
    cervejariaId: params.cervejariaId,
    tipo: 'EVENTO_EXCLUIDO',
    usuarioId: params.usuarioId,
    eventoId: evento.id,
    metadata: {
      acao: 'reverter_para_agendado',
      nome: evento.nome,
      serieId: evento.serieId,
      data: dataKey,
      modo,
    },
    payload: evento,
  });

  await prisma.evento.delete({ where: { id: evento.id } });

  return {
    ok: true as const,
    evento,
    modo,
    serieId: evento.serieId,
    dataKey,
    mensagem:
      modo === 'serie'
        ? 'Sessão revertida. O compromisso voltou ao estado agendado.'
        : 'Abertura desfeita. O evento foi removido da agenda.',
  };
}
