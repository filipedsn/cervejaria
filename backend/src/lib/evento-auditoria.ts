import type { Prisma, TransacaoTipo } from '@prisma/client';
import { prisma } from './prisma.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import { describeTransacao } from './audit/describe.js';
import { recordTransacaoMetric } from './business-metrics.js';

export async function registrarEventoRemovido(tx: Prisma.TransactionClient, input: {
  cervejariaId: string;
  usuarioId: string;
  eventoId: string;
  metadata: Record<string, unknown>;
}) {
  return tx.transacaoLog.create({
    data: {
      cervejariaId: input.cervejariaId,
      tipo: 'EVENTO_EXCLUIDO',
      usuarioId: input.usuarioId,
      eventoId: null,
      comandaId: null,
      entidadeTipo: 'Evento',
      entidadeId: input.eventoId,
      metadata: { ...input.metadata, eventoIdOriginal: input.eventoId } as Prisma.InputJsonValue,
    },
  });
}

export async function registrarComandaCanceladaNaReversao(tx: Prisma.TransactionClient, input: {
  cervejariaId: string;
  usuarioId: string;
  comandaId: string;
  eventoId: string;
  metadata: Record<string, unknown>;
}) {
  const tipo: TransacaoTipo = 'COMANDA_CANCELADA';
  return tx.transacaoLog.create({
    data: {
      cervejariaId: input.cervejariaId,
      tipo,
      usuarioId: input.usuarioId,
      eventoId: null,
      comandaId: null,
      entidadeTipo: 'Comanda',
      entidadeId: input.comandaId,
      metadata: {
        ...input.metadata,
        eventoIdOriginal: input.eventoId,
        comandaIdOriginal: input.comandaId,
        motivo: 'manual',
      } as Prisma.InputJsonValue,
    },
  });
}

export async function emitirAuditoriaAposCommit(input: {
  cervejariaId: string;
  tipo: 'EVENTO_EXCLUIDO' | 'COMANDA_CANCELADA';
  entidadeTipo: 'Evento' | 'Comanda';
  entidadeId: string;
  metadata: Record<string, unknown>;
}) {
  try {
    const company = await prisma.cervejaria.findUnique({ where: { id: input.cervejariaId }, select: { slug: true } });
    emitAuditEvent({
      action: `transacao.${input.tipo.toLowerCase()}`,
      message: describeTransacao(input.tipo, input.metadata),
      outcome: 'success',
      entityType: input.entidadeTipo,
      entityId: input.entidadeId,
      slug: company?.slug,
      metadata: { tipo: input.tipo, ...input.metadata },
    });
    recordTransacaoMetric(input.tipo, 'success', company?.slug);
  } catch (error) {
    console.error('[evento-auditoria] Falha ao emitir auditoria pós-commit:', error);
  }
}
