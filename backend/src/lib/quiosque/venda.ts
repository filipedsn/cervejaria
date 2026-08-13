import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getZonedParts } from '../event-datetime.js';
import { toNumber } from '../utils.js';
import { pedidoContaNaComanda, registrarHistoricoStatusPedido } from './cozinha.js';

/**
 * Erro de regra de venda. O statusCode faz o Fastify responder 400 com a
 * mensagem pronta para o operador, em vez de registrar falha do servidor.
 */
import { mapPrecosCardapioQuiosque } from '../cardapio-preco.js';
import { quiosqueUsaCardapio } from '../cardapio-toggle.js';
import { assertProdutoNoCardapioTurno } from './sessao-cardapio.js';

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
  controlaEstoque: boolean;
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
  opts?: { sessaoCaixaId?: string },
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

  if (opts?.sessaoCaixaId) {
    const usaCardapio = await quiosqueUsaCardapio(cervejariaId);
    if (usaCardapio) {
      const sessao = await tx.sessaoCaixaQuiosque.findUnique({
        where: { id: opts.sessaoCaixaId },
        select: { cardapioQuiosqueId: true },
      });
      const precosTemplate = sessao?.cardapioQuiosqueId
        ? await mapPrecosCardapioQuiosque(sessao.cardapioQuiosqueId)
        : null;

      for (const produto of produtos) {
        const noCardapio = await assertProdutoNoCardapioTurno(opts.sessaoCaixaId, produto.id);
        if (!noCardapio) {
          throw new VendaInvalidaError('Este item não está no cardápio deste turno');
        }
      }

      return produtos.map((produto) => {
        const precoTemplate = precosTemplate?.get(produto.id);
        return {
          produtoId: produto.id,
          nome: produto.nome,
          precoUnit: precoTemplate ?? toNumber(produto.precoUnit),
          quantidade: quantidadePorProduto.get(produto.id)!,
          exigePreparo: produto.exigePreparo,
          controlaEstoque: produto.controlaEstoque,
        };
      });
    }
  }

  return produtos.map((produto) => ({
    produtoId: produto.id,
    nome: produto.nome,
    precoUnit: toNumber(produto.precoUnit),
    quantidade: quantidadePorProduto.get(produto.id)!,
    exigePreparo: produto.exigePreparo,
    controlaEstoque: produto.controlaEstoque,
  }));
}

export function totalEmCentavos(itens: Array<{ precoUnit: unknown; quantidade: number }>): number {
  return itens.reduce(
    (soma, item) => soma + centavos(item.precoUnit as number) * item.quantidade,
    0,
  );
}

/**
 * Chave de 64 bits estavel para o advisory lock. Derivada do par empresa+dia,
 * que e exatamente o escopo em que a senha precisa ser unica.
 */
function lockKeyDaSenha(cervejariaId: string, dia: Date): bigint {
  const digest = createHash('sha256')
    .update(`pedido-quiosque:${cervejariaId}:${dia.toISOString().slice(0, 10)}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

/**
 * Cria o pedido com a senha do dia. A senha e sequencial por empresa e reinicia
 * a cada dia de operacao. Um advisory lock de transacao serializa a alocacao do
 * numero: sem ele, duas vendas simultaneas leem o mesmo maximo e a segunda viola
 * a unique — e no Postgres esse erro aborta a transacao inteira, entao nao ha
 * como tentar de novo por dentro dela.
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
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKeyDaSenha(params.cervejariaId, params.dia)})`;

  const ultimo = await tx.pedidoQuiosque.findFirst({
    where: { cervejariaId: params.cervejariaId, diaOperacional: params.dia },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });

  const pedido = await tx.pedidoQuiosque.create({
    data: {
      cervejariaId: params.cervejariaId,
      comandaId: params.comandaId,
      pontoVendaId: params.pontoVendaId,
      numero: (ultimo?.numero ?? 0) + 1,
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

  await registrarHistoricoStatusPedido(tx, pedido.id, 'RECEBIDO', pedido.createdAt);

  return pedido;
}

type ComandaCompleta = Prisma.ComandaQuiosqueGetPayload<{
  include: { pedidos: { include: { itens: true } }; pagamentos: true };
}>;

export function subtotalComandaEmCentavos(comanda: ComandaCompleta): number {
  return comanda.pedidos
    .filter((pedido) => pedidoContaNaComanda(pedido, comanda))
    .reduce((soma, pedido) => soma + totalEmCentavos(pedido.itens), 0);
}

/**
 * Monta a conta como o operador ve: total, quanto ja entrou e quanto falta.
 * Pedido cancelado nao entra no total. Pedido da cozinha so conta apos ENTREGUE.
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

  const subtotalEmCents = subtotalComandaEmCentavos(comanda);

  const descontoEmCents = centavos(toNumber(comanda.desconto ?? 0));
  const totalEmCents = Math.max(0, subtotalEmCents - descontoEmCents);

  const pagoEmCents = comanda.pagamentos.reduce(
    (soma, pagamento) => soma + centavos(pagamento.valor),
    0,
  );

  return {
    id: comanda.id,
    tipo: comanda.tipo,
    identificador: comanda.identificador,
    numero: comanda.numero,
    status: comanda.status,
    pontoVendaId: comanda.pontoVendaId,
    createdAt: comanda.createdAt,
    fechadaEm: comanda.fechadaEm,
    subtotal: reais(subtotalEmCents),
    desconto: reais(descontoEmCents),
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
