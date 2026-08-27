import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeChopeMlFromItens, incrementClienteStatsOnComandaFechada } from './cliente-stats.js';
import { registrarTransacao } from './transacao-log.js';
import { recordComandaFechada } from './business-metrics.js';
import { toNumber } from './utils.js';
import { lockComandaItemsInTx } from './comanda-service.js';

export type PagamentoInput = {
  forma: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';
  valor: number;
  valorRecebido?: number;
  troco?: number | null;
};

type ComandaTotal = { id: string; total: number };

type ItemWithProduto = {
  volumeMl: number;
  quantidade: number;
  produto?: { tipo: string; formato: string | null } | null;
};

export type ComandaParaFechar = {
  id: string;
  eventoId?: string | null;
  clienteId?: string | null;
  tipo?: 'COMANDA' | 'AVULSA' | 'MESA' | 'FICHA' | 'APELIDO';
  total: unknown;
  desconto?: unknown;
  itens: ItemWithProduto[];
  origem?: 'EVENTO' | 'QUIOSQUE';
};

/**
 * Total positivo exige ao menos um pagamento; total zero (cortesia) exige lista vazia.
 * Não confunde comanda vazia (sem itens) — isso fica nas rotas de cancelamento.
 */
export function assertPagamentosParaTotal(
  total: number,
  pagamentos: ReadonlyArray<{ valor: number }>,
): void {
  const devidoCents = Math.round(toNumber(total) * 100);
  if (devidoCents > 0) {
    if (pagamentos.length === 0) {
      throw Object.assign(new Error('Informe como o cliente pagou'), { statusCode: 400 });
    }
  } else if (pagamentos.length > 0) {
    throw Object.assign(new Error('Conta zerada não exige pagamento'), { statusCode: 400 });
  }
}

export function assertValorPagamentosParaTotal(
  total: number,
  pagamentos: ReadonlyArray<{ valor: number }>,
): void {
  const totalPagamentos = pagamentos.reduce((sum, pagamento) => sum + pagamento.valor, 0);
  if (Math.abs(totalPagamentos - toNumber(total)) > 0.01) {
    throw Object.assign(
      new Error(
        `Total dos pagamentos (R$ ${totalPagamentos.toFixed(2)}) difere do total da comanda (R$ ${toNumber(total).toFixed(2)})`,
      ),
      { statusCode: 400 },
    );
  }
}

export const comandaFechadaInclude = {
  cliente: true,
  itens: {
    include: { produto: true, produtoQuiosque: true },
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
    origem?: 'EVENTO' | 'QUIOSQUE';
    pagamentosDetalhados?: PagamentoInput[];
  },
) {
  const { comanda, pagamentos, cervejariaId, usuarioId, fechadaEm } = params;

  await lockComandaItemsInTx(tx, comanda.id);
  const comandaAtual = await tx.comanda.findUnique({
    where: { id: comanda.id },
    include: comandaFechadaInclude,
  });
  if (!comandaAtual || comandaAtual.status !== 'ABERTA') {
    throw Object.assign(new Error('Comanda não encontrada ou já fechada'), { statusCode: 404 });
  }

  const total = toNumber(comandaAtual.total);
  const desconto = toNumber(comandaAtual.desconto ?? 0);
  const origem = params.origem ?? comandaAtual.origem;
  const linhasPagamento = params.pagamentosDetalhados ?? pagamentos;

  assertPagamentosParaTotal(total, linhasPagamento);
  assertValorPagamentosParaTotal(total, linhasPagamento);

  const fechou = await tx.comanda.updateMany({
    where: { id: comandaAtual.id, status: 'ABERTA' },
    data: { status: 'FECHADA', fechadoPorId: usuarioId, fechadaEm },
  });
  if (fechou.count === 0) {
    throw Object.assign(new Error('Comanda não encontrada ou já fechada'), { statusCode: 404 });
  }

  if (linhasPagamento.length > 0) {
    await tx.pagamento.createMany({
      data: linhasPagamento.map((p) => ({
        comandaId: comandaAtual.id,
        forma: p.forma,
        valor: p.valor,
        valorRecebido: p.valorRecebido ?? null,
        troco: p.troco ?? null,
        registradoPorId: params.usuarioId,
      })),
    });
  }

  const metadata: Record<string, unknown> = { total, pagamentos: linhasPagamento };
  if (desconto > 0) metadata.desconto = desconto;
  if (params.grupoPagamentoId) {
    metadata.grupoPagamentoId = params.grupoPagamentoId;
    metadata.comandaIdsGrupo = params.comandaIdsGrupo;
  }

  const fechada = await tx.comanda.findUniqueOrThrow({
    where: { id: comandaAtual.id },
    include: comandaFechadaInclude,
  });

  const tipoTransacao = origem === 'QUIOSQUE' ? 'QUIOSQUE_COMANDA_FECHADA' : 'COMANDA_FECHADA';

  await registrarTransacao(
    {
      cervejariaId,
      tipo: tipoTransacao,
      usuarioId,
      eventoId: comandaAtual.eventoId ?? undefined,
      comandaId: comandaAtual.id,
      metadata,
      payload: { comanda: fechada, pagamentos: linhasPagamento },
    },
    tx,
  );

  recordComandaFechada(Math.round(total * 100), origem === 'QUIOSQUE' ? 'quiosque' : 'cervejaria');

  const totalMlChope = computeChopeMlFromItens(
    comandaAtual.itens.filter((item) => item.produto) as Array<{
      volumeMl: number;
      quantidade: number;
      produto: { tipo: string; formato: string | null };
    }>,
  );
  if (origem === 'EVENTO' && comandaAtual.tipo !== 'AVULSA' && comandaAtual.clienteId) {
    await incrementClienteStatsOnComandaFechada(tx, {
      clienteId: comandaAtual.clienteId,
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
  await lockComandaItemsInTx(tx, params.comandaId);
  const comanda = await tx.comanda.findFirst({
    where: {
      id: params.comandaId,
      status: 'ABERTA',
      OR: [
        { evento: { cervejariaId: params.cervejariaId } },
        { origem: 'QUIOSQUE', pontoVenda: { cervejariaId: params.cervejariaId } },
      ],
    },
    include: { itens: true, cliente: true },
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
      eventoId: comanda.eventoId ?? undefined,
      comandaId: comanda.id,
      metadata: {
        clienteNome: updated.cliente?.nome ?? updated.identificador,
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
