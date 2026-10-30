import type { FastifyInstance } from 'fastify';
import type { Prisma, StatusPedidoOperacao, ComandaTipo } from '@prisma/client';
import { prisma } from '../prisma.js';
import { emitToCervejaria } from '../realtime.js';
import { categoriaParaAlertaBalcao } from '../produto-utils.js';
import { toNumber } from '../utils.js';

type TxClient = Prisma.TransactionClient;

/** Pedidos que ainda ocupam a fila da cozinha. */
export const STATUS_NA_FILA: StatusPedidoOperacao[] = ['RECEBIDO', 'EM_PREPARO', 'PRONTO'];
export const STATUS_CANCELAMENTO_PENDENTE: StatusPedidoOperacao = 'CANCELAMENTO_PENDENTE';

/**
 * A fila operacional não pode abandonar um pedido pendente na troca de dia.
 * Já os entregues são histórico de turno e ficam limitados ao dia atual.
 */
export function filtroListaPedidosCozinha(
  incluirEntregues: boolean,
  diaAtual: Date,
): Prisma.PedidoOperacaoWhereInput {
  const pendente = {
    status: { in: STATUS_NA_FILA },
  };
  const cancelamentoPendente = { status: STATUS_CANCELAMENTO_PENDENTE };
  if (!incluirEntregues) return { OR: [pendente, cancelamentoPendente] };

  return {
    OR: [
      pendente,
      cancelamentoPendente,
      { status: 'ENTREGUE', diaOperacional: diaAtual },
    ],
  };
}

/**
 * Para onde cada status pode ir. O caminho de volta existe porque na correria a
 * cozinha erra o toque, e obrigar a cancelar o pedido para corrigir seria pior.
 */
export const TRANSICOES: Record<StatusPedidoOperacao, StatusPedidoOperacao[]> = {
  RECEBIDO: ['EM_PREPARO', 'CANCELAMENTO_PENDENTE'],
  EM_PREPARO: ['PRONTO', 'RECEBIDO', 'CANCELAMENTO_PENDENTE'],
  PRONTO: ['ENTREGUE', 'EM_PREPARO'],
  ENTREGUE: ['PRONTO'],
  CANCELAMENTO_PENDENTE: ['CANCELADO'],
  CANCELADO: [],
};

export const INCLUDE_PEDIDO_COZINHA = {
  itensComanda: { include: { opcionais: true } },
  comanda: { select: { id: true, tipo: true, identificador: true, numero: true } },
} as const;

export const INCLUDE_PEDIDO_COZINHA_COM_CLIENTE = {
  ...INCLUDE_PEDIDO_COZINHA,
  comanda: {
    select: {
      id: true,
      tipo: true,
      identificador: true,
      numero: true,
      cliente: { select: { id: true, nome: true, telefone: true } },
    },
  },
} as const;

type PedidoCozinha = Prisma.PedidoOperacaoGetPayload<{
  include: typeof INCLUDE_PEDIDO_COZINHA;
}>;
type PedidoCozinhaComCliente = Prisma.PedidoOperacaoGetPayload<{
  include: typeof INCLUDE_PEDIDO_COZINHA_COM_CLIENTE;
}>;

/**
 * O que a cozinha precisa ver. Itens sem preparo (bebida, gelo) ficam de fora
 * para nao poluir a tela com o que ja saiu direto do balcao.
 */
export function resumoPedidoCozinha(pedido: PedidoCozinha | PedidoCozinhaComCliente, incluirCliente = false) {
  const itens = pedido.itensComanda.filter((item) => item.exigePreparo && !item.canceladoEm);
  const cliente = 'cliente' in pedido.comanda ? pedido.comanda.cliente : null;

  return {
    id: pedido.id,
    numero: pedido.numero,
    status: pedido.status,
    // Itens de comandas/eventos anteriores podem ter sido marcados para
    // viagem antes de o campo do pedido operacional ser preenchido.
    paraViagem: pedido.paraViagem || itens.some((item) => item.paraViagem),
    observacao: pedido.observacao,
    createdAt: pedido.createdAt,
    statusDesde: pedido.statusDesde,
    entregueEm: pedido.entregueEm,
    comanda: {
      id: pedido.comanda.id,
      tipo: pedido.comanda.tipo,
      identificador: pedido.comanda.identificador,
      numero: pedido.comanda.numero,
      cliente: incluirCliente ? cliente : null,
    },
    itens: itens.map((item) => ({
        id: item.id,
        nome: item.nome ?? '',
        quantidade: item.quantidade,
        cancelamentoPendente: Boolean(item.cancelamentoPendenteEm),
        precoUnit: toNumber(item.precoUnit),
        // A flag do pedido é apenas um resumo para o cartão; aplicar esse
        // agregado a cada linha marca incorretamente todos os itens irmãos.
        paraViagem: item.paraViagem,
        observacao: item.observacao,
        opcionais: (item.opcionais ?? []).map((opcional) => ({
          id: opcional.id,
          nome: opcional.nome,
          precoAdicional: toNumber(opcional.precoAdicional),
          quantidade: opcional.quantidade,
        })),
      })),
  };
}

/** Registra a transicao e reinicia statusDesde; entregueEm congela o cronometro total. */
export async function registrarHistoricoStatusPedido(
  tx: TxClient,
  pedidoId: string,
  status: StatusPedidoOperacao,
  registradoEm = new Date(),
) {
  await tx.pedidoOperacaoStatusHistorico.create({
    data: { pedidoId, status, registradoEm },
  });
}

/** A linha foi alterada por outra transição depois da leitura que a originou. */
export class StatusPedidoCozinhaDesatualizadoError extends Error {
  statusCode = 409;

  constructor() {
    super('O status do pedido foi alterado por outra operação. Atualize a fila e tente novamente.');
    this.name = 'StatusPedidoCozinhaDesatualizadoError';
  }
}

export class StatusPedidoCozinhaTransicaoInvalidaError extends Error {
  code = 'KITCHEN_ORDER_TRANSITION_INVALID';

  constructor(statusAtual: StatusPedidoOperacao, statusSolicitado: StatusPedidoOperacao) {
    super(`Pedido atualizado de ${statusAtual} para ${statusSolicitado}; a fila foi sincronizada.`);
    this.name = 'StatusPedidoCozinhaTransicaoInvalidaError';
  }
}

export async function aplicarStatusPedidoCozinha(
  tx: TxClient,
  pedido: { id: string; status: StatusPedidoOperacao },
  novoStatus: StatusPedidoOperacao,
  agora = new Date(),
) {
  // A comparação no WHERE é o controle otimista: uma leitura anterior não
  // autoriza sobrescrever a transição que já venceu a corrida.
  const resultado = await tx.pedidoOperacao.updateMany({
    where: { id: pedido.id, status: pedido.status },
    data: {
      status: novoStatus,
      statusDesde: agora,
      clienteAvisadoEm:
        pedido.status !== novoStatus && (pedido.status === 'PRONTO' || novoStatus === 'PRONTO')
          ? null
          : undefined,
      entregueEm:
        novoStatus === 'ENTREGUE'
          ? agora
          : pedido.status === 'ENTREGUE'
            ? null
            : undefined,
    },
  });

  if (resultado.count !== 1) throw new StatusPedidoCozinhaDesatualizadoError();

  await registrarHistoricoStatusPedido(tx, pedido.id, novoStatus, agora);

  return tx.pedidoOperacao.findUniqueOrThrow({
    where: { id: pedido.id },
    include: INCLUDE_PEDIDO_COZINHA,
  });
}

export function pedidoVaiParaCozinha(itens: Array<{ exigePreparo: boolean }>): boolean {
  return itens.some((item) => item.exigePreparo);
}

/** O status da cozinha pode ser CANCELADO após cancelar apenas o último item de preparo.
 * CANCELAMENTO_PENDENTE ou uma solicitação antiga ainda marcada em item de preparo
 * identificam o cancelamento integral do pedido. */
export function pedidoCanceladoIntegralmente(pedido: {
  status: StatusPedidoOperacao;
  itens?: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }>;
  itensComanda?: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }>;
}): boolean {
  if (pedido.status === 'CANCELAMENTO_PENDENTE') return true;
  const itens = pedido.itensComanda ?? pedido.itens ?? [];
  if (pedido.status !== 'CANCELADO') return false;
  if (itens.some((item) => item.exigePreparo && item.cancelamentoPendenteEm && !item.canceladoEm)) return true;
  const cancelouPreparoIndividualmente = itens.some((item) => item.exigePreparo && item.canceladoEm && !item.cancelamentoPendenteEm);
  const aindaHaItemAtivo = itens.some((item) => !item.cancelamentoPendenteEm && !item.canceladoEm);
  return !cancelouPreparoIndividualmente || !aindaHaItemAtivo;
}

export function itemBloqueadoPorCancelamentoIntegral(pedido: {
  status: StatusPedidoOperacao;
  itens?: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }>;
  itensComanda?: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }>;
}, item: { exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }): boolean {
  return pedidoCanceladoIntegralmente(pedido) || Boolean(item.cancelamentoPendenteEm || item.canceladoEm) ||
    (item.exigePreparo && pedido.status === 'CANCELADO');
}

/** Itens cancelados não entram no total; demais contam ao ser lançados. */
export function pedidoContaNaComanda(
  pedido: {
    status: StatusPedidoOperacao;
    itens: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }>;
  },
  _comanda?: { tipo: ComandaTipo },
): boolean {
  if (pedidoCanceladoIntegralmente(pedido)) return false;
  return pedido.itens.some((item) => !item.cancelamentoPendenteEm && !item.canceladoEm);
}

export function temPedidoCozinhaPendente(
  pedidos: Array<{ status: StatusPedidoOperacao; itens?: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }>; itensComanda?: Array<{ exigePreparo: boolean; cancelamentoPendenteEm?: Date | null; canceladoEm?: Date | null }> }>,
): boolean {
  return pedidos.some((pedido) => {
    const itens = pedido.itensComanda ?? pedido.itens ?? [];
    return itens.some((item) => item.exigePreparo && !item.cancelamentoPendenteEm && !item.canceladoEm) &&
      STATUS_NA_FILA.includes(pedido.status);
  });
}

export function notificarComandaOperacaoAtualizada(
  app: FastifyInstance,
  cervejariaId: string,
  comandaId: string,
) {
  emitToCervejaria(app.io, cervejariaId, {
    type: 'operacao:comanda-atualizada',
    data: { comandaId },
  });
}

export type AtendimentoBalcaoPayload = {
  comandaId: string;
  pedidoIds: string[];
  clienteNome: string | null;
  comandaNumero: number | null;
  comandaIdentificador: string | null;
  itens: Array<{
    nome: string;
    quantidade: number;
    volumeMl: number | null;
  }>;
};

/**
 * Itens de balcão: sem preparo, não cancelados e cuja categoria está na lista
 * configurada. `categoriasAlerta` null/vazia = feature desligada (não alerta).
 * Chope sem categoria cadastrada resolve para "Chope" via tipo/formato.
 */
export function filtrarItensAtendimentoBalcao(
  itens: Array<{
    nome: string | null;
    quantidade: number;
    volumeMl: number | null;
    exigePreparo: boolean;
    canceladoEm: Date | null;
    categoria?: string | null;
    tipo?: string | null;
    formato?: string | null;
  }>,
  categoriasAlerta: string[] | null,
): AtendimentoBalcaoPayload['itens'] {
  if (!Array.isArray(categoriasAlerta) || categoriasAlerta.length === 0) return [];
  const allowed = new Set(categoriasAlerta.map((name) => name.trim()).filter(Boolean));
  if (allowed.size === 0) return [];

  return itens
    .filter((item) => !item.exigePreparo && !item.canceladoEm && allowed.has(categoriaParaAlertaBalcao(item)))
    .map((item) => ({
      nome: item.nome ?? 'Item',
      quantidade: item.quantidade,
      volumeMl: item.volumeMl,
    }));
}

/**
 * Avisa o balcão quando o portal lança itens sem preparo nas categorias
 * configuradas. Não substitui a fila da cozinha.
 */
export async function notificarAtendimentoBalcaoPortal(
  app: FastifyInstance,
  cervejariaId: string,
  comandaId: string,
  pedidoIds: string[],
): Promise<AtendimentoBalcaoPayload | null> {
  if (pedidoIds.length === 0) return null;

  const brewery = await prisma.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: { portalAlertaBalcaoCategorias: true },
  });
  const categoriasAlerta = Array.isArray(brewery?.portalAlertaBalcaoCategorias)
    ? brewery.portalAlertaBalcaoCategorias.filter((value): value is string => typeof value === 'string')
    : null;

  const pedidos = await prisma.pedidoOperacao.findMany({
    where: { id: { in: pedidoIds }, cervejariaId, comandaId },
    include: {
      itensComanda: {
        select: {
          nome: true,
          quantidade: true,
          volumeMl: true,
          exigePreparo: true,
          canceladoEm: true,
          produto: { select: { categoria: true, tipo: true, formato: true } },
        },
      },
      comanda: {
        select: {
          id: true,
          numero: true,
          identificador: true,
          cliente: { select: { nome: true } },
        },
      },
    },
  });

  const itens = filtrarItensAtendimentoBalcao(
    pedidos.flatMap((pedido) =>
      pedido.itensComanda.map((item) => ({
        ...item,
        categoria: item.produto?.categoria ?? null,
        tipo: item.produto?.tipo ?? null,
        formato: item.produto?.formato ?? null,
      })),
    ),
    categoriasAlerta,
  );
  if (itens.length === 0) return null;

  const comanda = pedidos[0]?.comanda;
  const payload: AtendimentoBalcaoPayload = {
    comandaId,
    pedidoIds: pedidos.map((pedido) => pedido.id),
    clienteNome: comanda?.cliente?.nome ?? null,
    comandaNumero: comanda?.numero ?? null,
    comandaIdentificador: comanda?.identificador ?? null,
    itens,
  };

  emitToCervejaria(app.io, cervejariaId, {
    type: 'operacao:atendimento-pedido',
    data: payload,
  });
  return payload;
}

/**
 * Avisa as telas de cozinha da empresa. Usa a sala da cervejaria porque o
 * operacao nao tem evento, que e o recorte de sala do modulo de cervejaria.
 */
export function notificarCozinha(
  app: FastifyInstance,
  cervejariaId: string,
  pedido: PedidoCozinha,
  novo: boolean,
) {
  if (pedido.status !== 'CANCELADO' && !pedidoVaiParaCozinha(pedido.itensComanda)) return;

  emitToCervejaria(app.io, cervejariaId, {
    type: novo ? 'operacao:pedido-novo' : 'operacao:pedido-atualizado',
    data: resumoPedidoCozinha(pedido),
  });
}

/**
 * Anuncia a rodada recem-criada. Chamada depois da transacao: a cozinha so pode
 * ser avisada de um pedido que ja esta gravado.
 */
export async function notificarPedidoNovo(
  app: FastifyInstance,
  cervejariaId: string,
  pedido: { id: string; itensComanda: Array<{ exigePreparo: boolean }> },
) {
  if (!pedidoVaiParaCozinha(pedido.itensComanda)) return;

  const completo = await prisma.pedidoOperacao.findUnique({
    where: { id: pedido.id },
    include: INCLUDE_PEDIDO_COZINHA,
  });
  if (completo) notificarCozinha(app, cervejariaId, completo, true);
}

/** Reflete na cozinha uma mudanca feita na comanda inteira, como o cancelamento. */
export async function notificarPedidosDaComanda(
  app: FastifyInstance,
  cervejariaId: string,
  comandaId: string,
) {
  const pedidos = await prisma.pedidoOperacao.findMany({
    where: { comandaId, cervejariaId },
    include: INCLUDE_PEDIDO_COZINHA,
  });
  for (const pedido of pedidos) notificarCozinha(app, cervejariaId, pedido, false);
}
