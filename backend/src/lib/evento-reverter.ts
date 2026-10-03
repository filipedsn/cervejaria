import type { Server as SocketIOServer } from 'socket.io';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { isSerie } from './evento-utils.js';
import { cancelarComandaVazia } from './comanda-cancelar.js';
import { emitPortalSessionExpired } from './cliente-session.js';
import { bloquearCaixaEvento } from './evento-caixa.js';
import { emitirAuditoriaAposCommit, registrarEventoRemovido } from './evento-auditoria.js';

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

export async function getEventoMovimentacaoFinanceira(eventoId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const sessoesCaixa = await db.sessaoCaixaEvento.count({ where: { eventoId } });
  if (sessoesCaixa > 0) {
    return {
      bloqueado: true,
      motivo: 'Não é possível reverter: existe histórico de caixa neste evento.',
      comandasAbertasVazias: [] as string[],
    };
  }

  const fechadas = await db.comanda.count({
    where: { eventoId, status: 'FECHADA' },
  });
  if (fechadas > 0) {
    return {
      bloqueado: true,
      motivo: 'Não é possível reverter: já existem vendas registradas.',
      comandasAbertasVazias: [] as string[],
    };
  }

  const abertasComItens = await db.comanda.count({
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

  const pedidosConfirmados = await db.pedidoCliente.count({
    where: { eventoId, status: 'CONFIRMADO' },
  });
  if (pedidosConfirmados > 0) {
    return {
      bloqueado: true,
      motivo: 'Não é possível reverter: existem pedidos confirmados no portal.',
      comandasAbertasVazias: [] as string[],
    };
  }

  const comandasAbertasVazias = await db.comanda.findMany({
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
  const result = await prisma.$transaction(async (tx) => {
    await bloquearCaixaEvento(tx, params.eventoId);
    const evento = await tx.evento.findFirst({
      where: { id: params.eventoId, cervejariaId: params.cervejariaId },
    });

    if (!evento) {
      return { error: 'Evento não encontrado', status: 404 as const };
    }

    const pode = assertPodeReverterEvento(evento);
    if (!pode.ok) {
      return { error: pode.motivo, status: 400 as const };
    }

    const mov = await getEventoMovimentacaoFinanceira(evento.id, tx);
    if (mov.bloqueado) {
      return { error: mov.motivo!, status: 409 as const };
    }

    for (const comandaId of mov.comandasAbertasVazias) {
      const cancel = await cancelarComandaVazia({
        comandaId,
        cervejariaId: params.cervejariaId,
        fechadoPorId: params.usuarioId,
        motivo: 'manual',
        preservarAuditoriaAposRemocaoEvento: true,
      }, tx);
      if ('error' in cancel) {
        throw Object.assign(new Error(cancel.error), { status: 409 as const });
      }
    }

    const modo = evento.serieId ? ('serie' as const) : ('avulso' as const);
    const dataKey = evento.data ? dateOnlyToKey(evento.data) : null;

    await registrarEventoRemovido(tx, {
      cervejariaId: params.cervejariaId,
      usuarioId: params.usuarioId,
      eventoId: evento.id,
      metadata: { acao: 'reverter_para_agendado', nome: evento.nome, serieId: evento.serieId, data: dataKey, modo },
    });
    await tx.evento.delete({ where: { id: evento.id } });
    return {
      ok: true as const,
      evento,
      modo,
      serieId: evento.serieId,
      dataKey,
      canceladas: mov.comandasAbertasVazias,
      mensagem:
        modo === 'serie'
          ? 'Sessão revertida. O compromisso voltou ao estado agendado.'
          : 'Abertura desfeita. O evento foi removido da agenda.',
    };
  }).catch((error: unknown) => {
    if ((error as { status?: number }).status === 409) {
      return { error: (error as Error).message, status: 409 as const };
    }
    throw error;
  });

  if (!('ok' in result) || !result.ok) return result;
  emitPortalSessionExpired(params.io, result.evento.id, 'evento_revertido');
  await emitirAuditoriaAposCommit({
    cervejariaId: params.cervejariaId, tipo: 'EVENTO_EXCLUIDO', entidadeTipo: 'Evento', entidadeId: result.evento.id,
    metadata: { acao: 'reverter_para_agendado', eventoIdOriginal: result.evento.id, nome: result.evento.nome, serieId: result.serieId, data: result.dataKey, modo: result.modo },
  });
  for (const comandaId of result.canceladas) {
    await emitirAuditoriaAposCommit({
      cervejariaId: params.cervejariaId, tipo: 'COMANDA_CANCELADA', entidadeTipo: 'Comanda', entidadeId: comandaId,
      metadata: { eventoIdOriginal: result.evento.id, comandaIdOriginal: comandaId, motivo: 'manual' },
    });
  }
  return result;
}
