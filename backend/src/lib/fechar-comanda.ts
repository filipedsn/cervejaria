import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeChopeMlFromItens, incrementClienteStatsOnComandaFechada } from './cliente-stats.js';
import { registrarTransacao } from './transacao-log.js';
import { recordComandaFechada } from './business-metrics.js';
import { toNumber } from './utils.js';

export type PagamentoInput = {
  forma: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';
  valor: number;
};

type ComandaTotal = { id: string; total: number };

type ItemWithProduto = {
  volumeMl: number;
  quantidade: number;
  produto: { tipo: string; formato: string | null };
};

export type ComandaParaFechar = {
  id: string;
  eventoId: string;
  clienteId: string;
  tipo?: 'COMANDA' | 'AVULSA';
  total: unknown;
  itens: ItemWithProduto[];
};

export const comandaFechadaInclude = {
  cliente: true,
  itens: {
    include: { produto: true },
    orderBy: { createdAt: 'desc' as const },
  },
  pagamentos: true,
};

/** Distribui linhas de pagamento entre comandas (ordem determinística por id). */
export function allocatePagamentosToComandas(
  comandas: ComandaTotal[],
  pagamentos: PagamentoInput[],
): Map<string, PagamentoInput[]> {
  const sorted = [...comandas].sort((a, b) => a.id.localeCompare(b.id));
  const pool = pagamentos.map((p) => ({ forma: p.forma, remaining: p.valor }));
  const result = new Map<string, PagamentoInput[]>();

  for (const comanda of sorted) {
    let needed = comanda.total;
    const allocated: PagamentoInput[] = [];

    for (const line of pool) {
      if (needed <= 0.001) break;
      if (line.remaining <= 0.001) continue;

      const take = Math.min(needed, line.remaining);
      const existing = allocated.find((a) => a.forma === line.forma);
      if (existing) {
        existing.valor += take;
      } else {
        allocated.push({ forma: line.forma, valor: take });
      }
      line.remaining -= take;
      needed -= take;
    }

    if (needed > 0.01) {
      throw new Error(`Alocação incompleta para comanda ${comanda.id}`);
    }
    result.set(comanda.id, allocated);
  }

  for (const line of pool) {
    if (line.remaining > 0.01) {
      throw new Error('Sobra no pool de pagamentos após alocação');
    }
  }

  return result;
}

type TxClient = Prisma.TransactionClient;

export async function fecharComandaComPagamentos(
  tx: TxClient,
  params: {
    comanda: ComandaParaFechar;
    pagamentos: PagamentoInput[];
    cervejariaId: string;
    usuarioId: string;
    fechadaEm: Date;
    grupoPagamentoId?: string;
    comandaIdsGrupo?: string[];
  },
) {
  const { comanda, pagamentos, cervejariaId, usuarioId, fechadaEm } = params;
  const total = toNumber(comanda.total as number);

  const fechou = await tx.comanda.updateMany({
    where: { id: comanda.id, status: 'ABERTA' },
    data: { status: 'FECHADA', fechadoPorId: usuarioId, fechadaEm },
  });
  if (fechou.count === 0) {
    throw Object.assign(new Error('Comanda não encontrada ou já fechada'), { statusCode: 404 });
  }

  await tx.pagamento.createMany({
    data: pagamentos.map((p) => ({
      comandaId: comanda.id,
      forma: p.forma,
      valor: p.valor,
    })),
  });

  const metadata: Record<string, unknown> = { total, pagamentos };
  if (params.grupoPagamentoId) {
    metadata.grupoPagamentoId = params.grupoPagamentoId;
    metadata.comandaIdsGrupo = params.comandaIdsGrupo;
  }

  const fechada = await tx.comanda.findUniqueOrThrow({
    where: { id: comanda.id },
    include: comandaFechadaInclude,
  });

  await registrarTransacao(
    {
      cervejariaId,
      tipo: 'COMANDA_FECHADA',
      usuarioId,
      eventoId: comanda.eventoId,
      comandaId: comanda.id,
      metadata,
      payload: { comanda: fechada, pagamentos },
    },
    tx,
  );

  recordComandaFechada(Math.round(total * 100), 'cervejaria');

  const totalMlChope = computeChopeMlFromItens(comanda.itens);
  if (comanda.tipo !== 'AVULSA') {
    await incrementClienteStatsOnComandaFechada(tx, {
      clienteId: comanda.clienteId,
      totalGasto: total,
      totalMlChope,
      fechadoEm: fechadaEm,
    });
  }

  return fechada;
}

export async function cancelarComandaVaziaInTx(
  tx: TxClient,
  params: {
    comandaId: string;
    cervejariaId: string;
    fechadoPorId: string;
    motivo?: 'manual' | 'empty_on_close' | 'empty_on_group_close';
  },
) {
  const comanda = await tx.comanda.findFirst({
    where: {
      id: params.comandaId,
      status: 'ABERTA',
      evento: { cervejariaId: params.cervejariaId },
    },
    include: { itens: true },
  });

  if (!comanda) {
    throw Object.assign(new Error('Comanda não encontrada ou já encerrada'), { statusCode: 404 });
  }
  if (comanda.itens.length > 0) {
    throw Object.assign(new Error('Comanda com consumação deve ser fechada com pagamento'), {
      statusCode: 400,
    });
  }

  await tx.comanda.update({
    where: { id: params.comandaId },
    data: { status: 'CANCELADA', fechadoPorId: params.fechadoPorId },
  });

  const updated = await tx.comanda.findUniqueOrThrow({
    where: { id: params.comandaId },
    include: comandaFechadaInclude,
  });

  await registrarTransacao(
    {
      cervejariaId: params.cervejariaId,
      tipo: 'COMANDA_CANCELADA',
      usuarioId: params.fechadoPorId,
      eventoId: comanda.eventoId,
      comandaId: comanda.id,
      metadata: {
        clienteNome: updated.cliente.nome,
        motivo: params.motivo ?? 'manual',
      },
      payload: updated,
    },
    tx,
  );

  return { comanda: updated, eventoId: comanda.eventoId };
}

export function newGrupoPagamentoId(): string {
  return randomUUID();
}
