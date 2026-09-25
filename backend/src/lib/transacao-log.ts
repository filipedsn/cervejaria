import type { Prisma, TransacaoTipo } from '@prisma/client';
import { prisma } from './prisma.js';
import { csvRow } from './csv.js';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import { describeTransacao } from './audit/describe.js';
import { mergeTransacaoMetadata } from './transacao-payload.js';
import { recordTransacaoMetric } from './business-metrics.js';

export type RegistrarTransacaoInput = {
  cervejariaId: string;
  tipo: TransacaoTipo;
  usuarioId?: string | null;
  eventoId?: string | null;
  comandaId?: string | null;
  entidadeTipo?: string | null;
  entidadeId?: string | null;
  metadata?: Record<string, unknown>;
  /** Objeto transacionado (comanda, pedido, caixa…) — vai para metadata.payload no Elastic. */
  payload?: unknown;
};

import { getTelemetryContextOrDefault } from './telemetry-context.js';

async function auditSlugForTransacao(cervejariaId: string): Promise<string | undefined> {
  const ctx = getTelemetryContextOrDefault();
  if (ctx.slug && ctx.slug !== 'system' && ctx.slug !== 'unknown') return ctx.slug;
  const row = await prisma.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: { slug: true },
  });
  return row?.slug;
}

export async function registrarTransacao(
  input: RegistrarTransacaoInput,
  tx?: Prisma.TransactionClient,
) {
  try {
    const db = tx ?? prisma;
    const logClient = (db as { transacaoLog?: { create: typeof prisma.transacaoLog.create } }).transacaoLog;
    if (!logClient?.create) {
      console.warn('[transacao-log] Client Prisma desatualizado — execute prisma generate e reinicie o backend');
      return null;
    }

    const metadata = mergeTransacaoMetadata(input.metadata, input.payload) as Prisma.InputJsonValue;

    const row = await logClient.create({
      data: {
        cervejariaId: input.cervejariaId,
        tipo: input.tipo,
        usuarioId: input.usuarioId ?? null,
        eventoId: input.eventoId ?? null,
        comandaId: input.comandaId ?? null,
        entidadeTipo: input.entidadeTipo ?? null,
        entidadeId: input.entidadeId ?? null,
        metadata,
      },
    });

    const metaObj = metadata as Record<string, unknown>;
    const slug = await auditSlugForTransacao(input.cervejariaId);
    const action =
      metaObj.operacao === 'CAPABILITY_CHANGED'
        ? 'operacao.capacidade_alterada'
        : `transacao.${input.tipo.toLowerCase()}`;
    emitAuditEvent({
      action,
      message: describeTransacao(input.tipo, metaObj),
      outcome: 'success',
      entityType: input.entidadeTipo ?? undefined,
      entityId: input.entidadeId ?? undefined,
      slug,
      metadata: {
        tipo: input.tipo,
        eventoId: input.eventoId,
        comandaId: input.comandaId,
        ...metaObj,
      },
    });

    recordTransacaoMetric(input.tipo, 'success', slug);

    return row;
  } catch (err) {
    console.error('[transacao-log] Falha ao registrar transação:', err);
    const failMeta = mergeTransacaoMetadata(input.metadata, input.payload);
    const slug = await auditSlugForTransacao(input.cervejariaId);
    emitAuditEvent({
      action:
        failMeta.operacao === 'CAPABILITY_CHANGED'
          ? 'operacao.capacidade_alterada'
          : `transacao.${input.tipo.toLowerCase()}`,
      message: `${describeTransacao(input.tipo, failMeta)} — falha ao persistir`,
      outcome: 'failure',
      slug,
      metadata: {
        tipo: input.tipo,
        error: err instanceof Error ? err.message : String(err),
        ...failMeta,
      },
    });
    recordTransacaoMetric(input.tipo, 'failure', slug);
    return null;
  }
}

const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO: 'Cartão',
  CARTAO_DEBITO: 'Débito',
  CARTAO_CREDITO: 'Crédito',
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export function formatTransacaoDescricao(tipo: TransacaoTipo, metadata: unknown): string {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;

  if (m.operacao === 'CAPABILITY_CHANGED') {
    return `Recurso do operacao ${str(m.campo) ?? ''}: ${String(m.valorAnterior)} → ${String(m.valorNovo)}`;
  }

  switch (tipo) {
    case 'COMANDA_CRIADA':
      return `Comanda aberta — ${str(m.clienteNome) ?? 'cliente'}`;
    case 'COMANDA_ITEM_ADICIONADO': {
      const q = num(m.quantidade) ?? 1;
      const vol = num(m.volumeMl);
      const prod = str(m.produtoNome) ?? 'item';
      return `+ ${q}x ${prod}${vol ? ` (${vol} ml)` : ''}`;
    }
    case 'COMANDA_ITEM_REMOVIDO': {
      const q = num(m.quantidade) ?? 1;
      const prod = str(m.produtoNome) ?? 'item';
      return `− ${q}x ${prod} removido`;
    }
    case 'COMANDA_DESCONTO_APLICADO':
      return `Desconto de R$ ${(num(m.desconto) ?? 0).toFixed(2)} na comanda`;
    case 'COMANDA_FECHADA': {
      const total = num(m.total);
      const pagamentos = Array.isArray(m.pagamentos) ? m.pagamentos : [];
      const formas = pagamentos
        .map((p) => {
          const row = p as Record<string, unknown>;
          const forma = PAYMENT_LABELS[String(row.forma)] ?? String(row.forma);
          const valor = num(row.valor);
          return valor != null ? `${forma} R$ ${valor.toFixed(2)}` : forma;
        })
        .join(', ');
      return `Comanda fechada${total != null ? ` — R$ ${total.toFixed(2)}` : ''}${formas ? ` (${formas})` : ''}`;
    }
    case 'COMANDA_CANCELADA':
      return `Comanda cancelada${str(m.clienteNome) ? ` — ${m.clienteNome}` : ''}`;
    case 'EVENTO_CRIADO':
      return `Evento criado — ${str(m.nome) ?? 'sem nome'}`;
    case 'EVENTO_SESSAO_INICIADA':
      return `Sessão iniciada — ${str(m.nome) ?? 'evento'}`;
    case 'EVENTO_ATUALIZADO':
      return `Evento atualizado — ${str(m.nome) ?? 'evento'}`;
    case 'EVENTO_FECHADO':
      return `Evento encerrado — ${str(m.nome) ?? 'evento'}`;
    case 'EVENTO_REABERTO':
      return `Evento reaberto — ${str(m.nome) ?? 'evento'}`;
    case 'EVENTO_EXCLUIDO':
      return `Evento excluído — ${str(m.nome) ?? 'evento'}`;
    case 'EVENTO_CARDAPIO_ATUALIZADO':
      return `Cardápio do evento atualizado`;
    case 'TAP_CHOPE_POSICIONADO': {
      const tap = num(m.tapNumero);
      const novo = str(m.chopeNovo) ?? 'chope';
      const ant = str(m.chopeAnterior);
      return ant
        ? `Tap ${tap ?? '?'}: ${ant} → ${novo}`
        : `Tap ${tap ?? '?'}: ${novo} posicionado`;
    }
    case 'TAP_CHOPE_REMOVIDO':
      return `Tap ${num(m.tapNumero) ?? '?'}: chope removido`;
    case 'TAP_ATIVO_ALTERADO':
      return `Tap ${num(m.tapNumero) ?? '?'} ${m.ativo === false ? 'inativado' : 'reativado'}`;
    case 'CASH_REGISTER_OPENED':
      return `Caixa aberto — troco R$ ${(num(m.trocoInicial) ?? 0).toFixed(2)}`;
    case 'CASH_MOVEMENT_RECORDED':
      return `${str(m.tipo) ?? 'Movimento'} R$ ${(num(m.valor) ?? 0).toFixed(2)}`;
    case 'CASH_MOVEMENT_CORRECTED':
      return `Movimento de caixa corrigido â€” R$ ${(num(m.valorOriginal) ?? 0).toFixed(2)} → R$ ${(num(m.valorCorrigido) ?? 0).toFixed(2)}`;
    case 'CASH_REGISTER_CLOSED':
      return `Caixa fechado${num(m.divergenciaCentavos) != null ? ` — divergência R$ ${((num(m.divergenciaCentavos) ?? 0) / 100).toFixed(2)}` : ''}`;
    case 'COMANDA_CRIADA':
      return `Comanda operacao ${str(m.identificador) ?? ''}`.trim();
    case 'COMANDA_FECHADA':
      return `Comanda operacao fechada — R$ ${(num(m.total) ?? 0).toFixed(2)}`;
    case 'COMANDA_CANCELADA':
      return `Comanda operacao cancelada — ${str(m.identificador) ?? ''}`;
    case 'KITCHEN_ORDER_CREATED': {
      const itens = Array.isArray(m.itens) ? m.itens.length : num(m.qtdItens);
      return `Pedido operacao #${num(m.pedidoNumero) ?? '?'} — ${itens ?? 0} item(ns)`;
    }
    case 'SALE_PAYMENT_RECORDED': {
      const pagamentos = Array.isArray(m.pagamentos) ? m.pagamentos : [];
      const formas = pagamentos
        .map((p) => {
          const row = p as Record<string, unknown>;
          const forma = PAYMENT_LABELS[String(row.forma)] ?? String(row.forma);
          const valor = num(row.valor);
          return valor != null ? `${forma} R$ ${valor.toFixed(2)}` : forma;
        })
        .join(', ');
      return `Pagamento operacao${formas ? ` (${formas})` : ''}`;
    }
    case 'COMANDA_GRUPO_FECHADO':
      return `Grupo de comandas fechado — ${num(m.qtdComandas) ?? '?'} conta(s), R$ ${(num(m.totalGrupo) ?? 0).toFixed(2)}`;
    case 'KITCHEN_ORDER_STATUS_CHANGED':
      return `Pedido cozinha ${str(m.statusAnterior) ?? '?'} → ${str(m.status) ?? '?'}`;
    case 'INVENTORY_MOVEMENT':
      return `Estoque ${str(m.operacao) ?? 'movimento'} — ${str(m.produtoNome) ?? 'produto'}`;
    case 'COMANDA_DESCONTO_APLICADO':
      return `Desconto ${num(m.desconto) ?? 0}% na comanda`;
    case 'SALE_COMPLETED':
      return `Venda avulsa — R$ ${(num(m.total) ?? 0).toFixed(2)}`;
    case 'PORTAL_PEDIDO_CRIADO':
      return `Pedido portal criado — comanda ${str(m.comandaId) ?? ''}`;
    case 'PORTAL_PEDIDO_RECUSADO':
      return `Pedido portal recusado — ${str(m.motivo) ?? 'sem motivo'}`;
    default:
      return tipo;
  }
}

export async function listTransacoesEvento(params: {
  eventoId: string;
  cervejariaId: string;
  limit?: number;
}) {
  const limit = Math.min(params.limit ?? 200, 500);
  const rows = await prisma.transacaoLog.findMany({
    where: { eventoId: params.eventoId, cervejariaId: params.cervejariaId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      usuario: { select: { id: true, nome: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    tipo: row.tipo,
    descricao: formatTransacaoDescricao(row.tipo, row.metadata),
    createdAt: row.createdAt.toISOString(),
    usuario: row.usuario,
    comandaId: row.comandaId,
    metadata: row.metadata,
  }));
}

export function transacoesToCsv(
  rows: Awaited<ReturnType<typeof listTransacoesEvento>>,
): string {
  const header = 'data_hora,tipo,descricao,usuario,comanda_id';
  const lines = rows.map((r) =>
    csvRow([r.createdAt, r.tipo, r.descricao, r.usuario?.nome ?? '', r.comandaId ?? '']),
  );
  return [header, ...lines].join('\n');
}
