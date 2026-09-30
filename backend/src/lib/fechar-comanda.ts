import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { recalculateClienteStats } from './cliente-stats.js';
import { registrarTransacao } from './transacao-log.js';
import { recordComandaFechada } from './business-metrics.js';
import { toNumber } from './utils.js';
import { lockComandaItemsInTx } from './comanda-service.js';
import { normalizePhone } from './phone.js';

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
  origem?: 'EVENTO' | 'CAIXA' | 'QUIOSQUE';
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

export function podeDeixarContaPendente(origem: string): boolean {
  return origem === 'CAIXA' || origem === 'EVENTO';
}

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
  const toCents = (value: number) => Math.round(toNumber(value) * 100);
  const totalDueCents = sorted.reduce((sum, comanda) => sum + toCents(comanda.total), 0);
  const totalPaidCents = pagamentos.reduce((sum, pagamento) => sum + toCents(pagamento.valor), 0);
  // Compare the pool globally in cents; per-comanda float tolerances can hide
  // a one-cent shortfall on several separate comandas.
  if (Math.abs(totalDueCents - totalPaidCents) > 1) {
    throw new Error(totalPaidCents < totalDueCents
      ? 'Alocação incompleta: total dos pagamentos insuficiente'
      : 'Sobra no pool de pagamentos após alocação');
  }

  const pool = pagamentos.map((p) => ({ forma: p.forma, remainingCents: toCents(p.valor) }));
  const result = new Map<string, PagamentoInput[]>();

  for (const comanda of sorted) {
    let neededCents = toCents(comanda.total);
    const allocated = new Map<PagamentoInput['forma'], number>();

    for (const line of pool) {
      if (neededCents <= 0) break;
      if (line.remainingCents <= 0) continue;

      const takeCents = Math.min(neededCents, line.remainingCents);
      allocated.set(line.forma, (allocated.get(line.forma) ?? 0) + takeCents);
      line.remainingCents -= takeCents;
      neededCents -= takeCents;
    }

    if (neededCents > 1) {
      throw new Error(`Alocação incompleta para comanda ${comanda.id}`);
    }
    result.set(comanda.id, [...allocated].map(([forma, cents]) => ({ forma, valor: cents / 100 })));
  }

  for (const line of pool) {
    if (line.remainingCents > 1) {
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
    origem?: 'EVENTO' | 'CAIXA' | 'QUIOSQUE';
    pagamentosDetalhados?: PagamentoInput[];
    sessaoCaixaId?: string;
    sessaoCaixaEventoId?: string;
    deixarPendente?: boolean;
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

  if (params.deixarPendente) {
    const cliente = comandaAtual.clienteId
      ? await tx.cliente.findFirst({
          where: {
            id: comandaAtual.clienteId,
            cervejariaId,
            ativo: true,
            isSistema: false,
          },
          select: { telefone: true },
        })
      : null;
    if (!podeDeixarContaPendente(origem) || linhasPagamento.length > 0 || !cliente || !normalizePhone(cliente.telefone)) {
      throw Object.assign(new Error('Conta pendente exige cliente cadastrado com telefone vÃ¡lido e nenhum pagamento no fechamento'), { statusCode: 400 });
    }
  } else {
    assertPagamentosParaTotal(total, linhasPagamento);
    assertValorPagamentosParaTotal(total, linhasPagamento);
  }

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
        ...(params.sessaoCaixaId ? { sessaoCaixaId: params.sessaoCaixaId } : {}),
        ...(params.sessaoCaixaEventoId ? { sessaoCaixaEventoId: params.sessaoCaixaEventoId } : {}),
      })),
    });
  }

  if (params.deixarPendente) {
    await tx.contaReceber.create({
      data: {
        comandaId: comandaAtual.id,
        clienteId: comandaAtual.clienteId!,
        valorOriginal: total,
        criadoPorId: params.usuarioId,
      },
    });
  }

  const metadata: Record<string, unknown> = {
    total,
    pagamentos: linhasPagamento,
    ...(params.deixarPendente ? { contaPendente: true } : {}),
  };
  if (desconto > 0) metadata.desconto = desconto;
  if (params.grupoPagamentoId) {
    metadata.grupoPagamentoId = params.grupoPagamentoId;
    metadata.comandaIdsGrupo = params.comandaIdsGrupo;
  }

  const fechada = await tx.comanda.findUniqueOrThrow({
    where: { id: comandaAtual.id },
    include: comandaFechadaInclude,
  });

  const tipoTransacao = origem === 'CAIXA' ? 'COMANDA_FECHADA' : 'COMANDA_FECHADA';

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

  recordComandaFechada(Math.round(total * 100), origem === 'EVENTO' ? 'cervejaria' : 'operacao');

  if (comandaAtual.tipo !== 'AVULSA' && comandaAtual.clienteId) {
    await recalculateClienteStats(tx, comandaAtual.clienteId);
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
        { origem: 'CAIXA', pontoVenda: { cervejariaId: params.cervejariaId } },
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
