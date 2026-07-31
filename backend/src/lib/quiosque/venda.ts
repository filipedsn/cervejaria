import type { Prisma } from '@prisma/client';
import { getZonedParts } from '../event-datetime.js';
import { toNumber } from '../utils.js';

/**
 * Erro de regra de venda. O statusCode faz o Fastify responder 400 com a
 * mensagem pronta para o operador, em vez de registrar falha do servidor.
 */
export class VendaInvalidaError extends Error {
  statusCode = 400;
}

/**
 * Dia da operacao no fuso de Brasilia. O quiosque costuma virar a meia-noite,
 * entao a data do instante UTC colocaria a mesma noite em dois caixas.
 */
export function diaOperacional(referencia = new Date()): Date {
  const { year, month, day } = getZonedParts(referencia);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Dinheiro em centavos: soma de float erra centavo em venda com muitos itens. */
export function centavos(valor: number | { toString(): string }): number {
  return Math.round(toNumber(valor) * 100);
}

export function reais(valorEmCentavos: number): number {
  return valorEmCentavos / 100;
}

export interface ItemVendaInput {
  produtoId: string;
  quantidade: number;
}

export interface ItemResolvido {
  produtoId: string;
  nome: string;
  precoUnit: number;
  quantidade: number;
  exigePreparo: boolean;
}

type TxClient = Prisma.TransactionClient;

/**
 * Confere que os produtos sao da empresa e estao ativos, e copia nome e preco
 * para o item. Quantidades repetidas do mesmo produto viram uma linha so.
 */
export async function resolverItens(
  tx: TxClient,
  cervejariaId: string,
  itens: ItemVendaInput[],
): Promise<ItemResolvido[]> {
  if (itens.length === 0) throw new VendaInvalidaError('Inclua ao menos um item na venda');

  const quantidadePorProduto = new Map<string, number>();
  for (const item of itens) {
    quantidadePorProduto.set(
      item.produtoId,
      (quantidadePorProduto.get(item.produtoId) ?? 0) + item.quantidade,
    );
  }

  const ids = [...quantidadePorProduto.keys()];
  const produtos = await tx.produtoQuiosque.findMany({
    where: { id: { in: ids }, cervejariaId, ativo: true },
  });

  if (produtos.length !== ids.length) {
    throw new VendaInvalidaError('Produto indisponível no catálogo do quiosque');
  }

  return produtos.map((produto) => ({
    produtoId: produto.id,
    nome: produto.nome,
    precoUnit: toNumber(produto.precoUnit),
    quantidade: quantidadePorProduto.get(produto.id)!,
    exigePreparo: produto.exigePreparo,
  }));
}

export function totalEmCentavos(itens: Array<{ precoUnit: unknown; quantidade: number }>): number {
  return itens.reduce(
    (soma, item) => soma + centavos(item.precoUnit as number) * item.quantidade,
    0,
  );
}

/**
 * Cria o pedido com a senha do dia. A senha e sequencial por empresa e reinicia
 * a cada dia de operacao; duas vendas simultaneas podem pedir a mesma, entao a
 * colisao da unique e reprocessada em vez de estourar para o operador.
 */
export async function criarPedido(
  tx: TxClient,
  params: {
    cervejariaId: string;
    comandaId: string;
    pontoVendaId: string;
    dia: Date;
    criadoPorId: string;
    observacao?: string;
    itens: ItemResolvido[];
  },
) {
  const ultimo = await tx.pedidoQuiosque.findFirst({
    where: { cervejariaId: params.cervejariaId, diaOperacional: params.dia },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });

  let numero = (ultimo?.numero ?? 0) + 1;

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      return await tx.pedidoQuiosque.create({
        data: {
          cervejariaId: params.cervejariaId,
          comandaId: params.comandaId,
          pontoVendaId: params.pontoVendaId,
          numero,
          diaOperacional: params.dia,
          criadoPorId: params.criadoPorId,
          observacao: params.observacao,
          itens: {
            create: params.itens.map((item) => ({
              produtoId: item.produtoId,
              nome: item.nome,
              precoUnit: item.precoUnit,
              quantidade: item.quantidade,
              exigePreparo: item.exigePreparo,
            })),
          },
        },
        include: { itens: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      numero += 1;
    }
  }

  throw new VendaInvalidaError('Não foi possível gerar a senha do pedido, tente de novo');
}

type ComandaCompleta = Prisma.ComandaQuiosqueGetPayload<{
  include: { pedidos: { include: { itens: true } }; pagamentos: true };
}>;

/**
 * Monta a conta como o operador ve: total, quanto ja entrou e quanto falta.
 * Pedido cancelado nao entra no total.
 */
export function resumoComanda(comanda: ComandaCompleta) {
  const pedidos = comanda.pedidos.map((pedido) => ({
    id: pedido.id,
    numero: pedido.numero,
    status: pedido.status,
    observacao: pedido.observacao,
    createdAt: pedido.createdAt,
    itens: pedido.itens.map((item) => ({
      id: item.id,
      produtoId: item.produtoId,
      nome: item.nome,
      precoUnit: toNumber(item.precoUnit),
      quantidade: item.quantidade,
      subtotal: reais(centavos(item.precoUnit) * item.quantidade),
      exigePreparo: item.exigePreparo,
    })),
  }));

  const totalEmCents = comanda.pedidos
    .filter((pedido) => pedido.status !== 'CANCELADO')
    .reduce((soma, pedido) => soma + totalEmCentavos(pedido.itens), 0);

  const pagoEmCents = comanda.pagamentos.reduce(
    (soma, pagamento) => soma + centavos(pagamento.valor),
    0,
  );

  return {
    id: comanda.id,
    tipo: comanda.tipo,
    identificador: comanda.identificador,
    status: comanda.status,
    pontoVendaId: comanda.pontoVendaId,
    createdAt: comanda.createdAt,
    fechadaEm: comanda.fechadaEm,
    total: reais(totalEmCents),
    pago: reais(pagoEmCents),
    saldo: reais(totalEmCents - pagoEmCents),
    pedidos,
    pagamentos: comanda.pagamentos.map((pagamento) => ({
      id: pagamento.id,
      forma: pagamento.forma,
      valor: toNumber(pagamento.valor),
      valorRecebido: pagamento.valorRecebido === null ? null : toNumber(pagamento.valorRecebido),
      troco: pagamento.troco === null ? null : toNumber(pagamento.troco),
      pagoEm: pagamento.pagoEm,
    })),
  };
}

export interface PagamentoInput {
  forma: 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO';
  valor: number;
  /** Quanto o cliente entregou em especie. So faz sentido no dinheiro. */
  valorRecebido?: number;
}

export interface PagamentoResolvido extends PagamentoInput {
  troco: number | null;
}

/**
 * Confere que os pagamentos quitam exatamente o valor devido e calcula o troco
 * do dinheiro. Pagar a mais so e valido em especie, onde a diferenca volta como
 * troco; no Pix ou cartao seria dinheiro cobrado a maior.
 */
export function resolverPagamentos(
  pagamentos: PagamentoInput[],
  devidoEmCentavos: number,
): PagamentoResolvido[] {
  if (pagamentos.length === 0) throw new VendaInvalidaError('Informe como o cliente pagou');

  const somaEmCentavos = pagamentos.reduce((soma, pagamento) => soma + centavos(pagamento.valor), 0);

  if (somaEmCentavos !== devidoEmCentavos) {
    throw new VendaInvalidaError(
      `Os pagamentos somam ${reais(somaEmCentavos).toFixed(2)} e a conta é ${reais(devidoEmCentavos).toFixed(2)}`,
    );
  }

  return pagamentos.map((pagamento) => {
    if (pagamento.valorRecebido === undefined) return { ...pagamento, troco: null };

    if (pagamento.forma !== 'DINHEIRO') {
      throw new VendaInvalidaError('Troco só existe em pagamento com dinheiro');
    }

    const trocoEmCentavos = centavos(pagamento.valorRecebido) - centavos(pagamento.valor);
    if (trocoEmCentavos < 0) {
      throw new VendaInvalidaError('O valor recebido é menor que o valor a pagar');
    }

    return { ...pagamento, troco: reais(trocoEmCentavos) };
  });
}
