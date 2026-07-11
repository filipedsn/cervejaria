import type { Prisma, TransacaoTipo } from '@prisma/client';
import { prisma } from './prisma.js';

export type RegistrarTransacaoInput = {
  cervejariaId: string;
  tipo: TransacaoTipo;
  usuarioId?: string | null;
  eventoId?: string | null;
  comandaId?: string | null;
  entidadeTipo?: string | null;
  entidadeId?: string | null;
  metadata?: Record<string, unknown>;
};

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

    return await logClient.create({
      data: {
        cervejariaId: input.cervejariaId,
        tipo: input.tipo,
        usuarioId: input.usuarioId ?? null,
        eventoId: input.eventoId ?? null,
        comandaId: input.comandaId ?? null,
        entidadeTipo: input.entidadeTipo ?? null,
        entidadeId: input.entidadeId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('[transacao-log] Falha ao registrar transação:', err);
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
  const lines = rows.map((r) => {
    const cols = [
      r.createdAt,
      r.tipo,
      r.descricao.replace(/"/g, '""'),
      r.usuario?.nome?.replace(/"/g, '""') ?? '',
      r.comandaId ?? '',
    ];
    return cols.map((c) => `"${c}"`).join(',');
  });
  return [header, ...lines].join('\n');
}
