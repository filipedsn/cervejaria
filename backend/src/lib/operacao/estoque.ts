import { createHash } from 'node:crypto';
import type { Prisma, TipoMovimentoEstoqueOperacao } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isBebidaChopeOperacao } from '../produto-utils.js';
import type { ItemResolvido } from './venda.js';

export class EstoqueInvalidoError extends Error {
  statusCode = 400;
}

type TxClient = Prisma.TransactionClient;

const SAIDA_MANUAL: TipoMovimentoEstoqueOperacao[] = ['PERDA', 'CORTESIA', 'CONSUMO_INTERNO'];
function validarQuantidadePorUnidade(produto: { tipo: string; formato: string | null; categoria: string | null; precos?: Array<{ volumeMl: number }> }, quantidade: number) {
  if (isBebidaChopeOperacao(produto)) {
    if (Math.abs(Math.round(quantidade * 1000) / 1000 - quantidade) > 1e-9) {
      throw new EstoqueInvalidoError('Informe litros com no m\u00e1ximo tr\u00eas casas decimais');
    }
  } else if (!Number.isInteger(quantidade)) {
    throw new EstoqueInvalidoError('Produtos vendidos por unidade exigem quantidade inteira');
  }
}

function quantidadeVendidaEstoque(item: Pick<ItemResolvido, 'tapId' | 'volumeMl' | 'quantidade'>) {
  return item.tapId ? (item.volumeMl * item.quantidade) / 1000 : item.quantidade;
}

export type StatusEstoque = 'NORMAL' | 'LOW' | 'OUT_OF_STOCK';

export function classificarEstoque(quantidade: number, estoqueMinimo: number | null): StatusEstoque {
  if (quantidade <= 0) return 'OUT_OF_STOCK';
  if (estoqueMinimo !== null && quantidade <= estoqueMinimo) return 'LOW';
  return 'NORMAL';
}

/** Serializa mutações do saldo materializado de um produto em um ponto de venda. */
function chaveLockEstoque(cervejariaId: string, pontoVendaId: string, produtoId: string): bigint {
  const digest = createHash('sha256')
    .update(`estoque-operacao:${cervejariaId}:${pontoVendaId}:${produtoId}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

async function lockEstoqueEmTx(
  tx: Pick<TxClient, '$executeRaw'>,
  params: { cervejariaId: string; pontoVendaId: string; produtoId: string },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chaveLockEstoque(
    params.cervejariaId,
    params.pontoVendaId,
    params.produtoId,
  )})`;
}

function deveControlar(moduloControlaEstoque: boolean, produtoControlaEstoque: boolean): boolean {
  return moduloControlaEstoque && produtoControlaEstoque;
}

async function garantirSaldo(
  tx: TxClient,
  params: { cervejariaId: string; pontoVendaId: string; produtoId: string },
) {
  return tx.inventoryBalance.upsert({
    where: {
      pontoVendaId_produtoId: {
        pontoVendaId: params.pontoVendaId,
        produtoId: params.produtoId,
      },
    },
    create: {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      quantidade: 0,
    },
    update: {},
  });
}

async function registrarMovimento(
  tx: TxClient,
  params: {
    cervejariaId: string;
    pontoVendaId: string;
    produtoId: string;
    tipo: TipoMovimentoEstoqueOperacao;
    quantidade: number;
    observacao?: string;
    registradoPorId: string;
    pedidoId?: string;
  },
) {
  await tx.inventoryMovement.create({
    data: {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      tipo: params.tipo,
      quantidade: params.quantidade,
      observacao: params.observacao,
      registradoPorId: params.registradoPorId,
      pedidoId: params.pedidoId,
    },
  });
}

async function baixarQuantidade(
  tx: TxClient,
  params: {
    cervejariaId: string;
    pontoVendaId: string;
    produtoId: string;
    quantidade: number;
    nomeProduto: string;
    tipo: 'SAIDA_VENDA' | 'PERDA' | 'CORTESIA' | 'CONSUMO_INTERNO' | 'AJUSTE';
    observacao?: string;
    registradoPorId: string;
    pedidoId?: string;
  },
) {
  await lockEstoqueEmTx(tx, params);
  await garantirSaldo(tx, params);

  const atualizado = await tx.inventoryBalance.updateMany({
    where: {
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      quantidade: { gte: params.quantidade },
    },
    data: { quantidade: { decrement: params.quantidade } },
  });

  if (atualizado.count === 0) {
    throw new EstoqueInvalidoError(`Estoque insuficiente de ${params.nomeProduto}`);
  }

  await registrarMovimento(tx, {
    cervejariaId: params.cervejariaId,
    pontoVendaId: params.pontoVendaId,
    produtoId: params.produtoId,
    tipo: params.tipo,
    quantidade: params.quantidade,
    observacao: params.observacao,
    registradoPorId: params.registradoPorId,
    pedidoId: params.pedidoId,
  });
}

async function entrarQuantidade(
  tx: TxClient,
  params: {
    cervejariaId: string;
    pontoVendaId: string;
    produtoId: string;
    quantidade: number;
    tipo: 'ENTRADA' | 'ESTORNO_VENDA' | 'AJUSTE';
    observacao?: string;
    registradoPorId: string;
    pedidoId?: string;
  },
) {
  await lockEstoqueEmTx(tx, params);
  await garantirSaldo(tx, params);

  await tx.inventoryBalance.update({
    where: {
      pontoVendaId_produtoId: {
        pontoVendaId: params.pontoVendaId,
        produtoId: params.produtoId,
      },
    },
    data: { quantidade: { increment: params.quantidade } },
  });

  await registrarMovimento(tx, params);
}

/** Baixa o estoque dos itens lancados no pedido, na mesma transacao da venda. */
export async function baixarEstoqueDoPedido(
  tx: TxClient,
  params: {
    moduloControlaEstoque: boolean;
    cervejariaId: string;
    pontoVendaId: string;
    pedidoId?: string;
    registradoPorId: string;
    itens: ItemResolvido[];
  },
) {
  if (!params.moduloControlaEstoque) return;

  for (const item of params.itens) {
    if (!item.controlaEstoque) continue;

    await baixarQuantidade(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: item.produtoId,
      quantidade: quantidadeVendidaEstoque(item),
      nomeProduto: item.nome,
      tipo: 'SAIDA_VENDA',
      registradoPorId: params.registradoPorId,
      pedidoId: params.pedidoId,
    });
    for (const opcional of item.opcionais ?? []) {
      if (!opcional.produtoEstoqueId) continue;
      const produtoOpcional = await tx.produto.findFirst({ where: { id: opcional.produtoEstoqueId, cervejariaId: params.cervejariaId, ativo: true }, select: { nome: true, controlaEstoque: true } });
      if (!produtoOpcional?.controlaEstoque) continue;
      await baixarQuantidade(tx, { cervejariaId: params.cervejariaId, pontoVendaId: params.pontoVendaId, produtoId: opcional.produtoEstoqueId, quantidade: item.quantidade * opcional.quantidade, nomeProduto: produtoOpcional.nome, tipo: 'SAIDA_VENDA', registradoPorId: params.registradoPorId, pedidoId: params.pedidoId });
    }
  }
}

/** Devolve ao estoque a quantidade removida ou reduzida de um item na comanda. */
export async function estornarEstoqueItemPedido(
  tx: TxClient,
  params: {
    moduloControlaEstoque: boolean;
    cervejariaId: string;
    pontoVendaId: string;
    pedidoId?: string;
    produtoId: string;
    nome: string;
    quantidade: number;
    controlaEstoque: boolean;
    tapId?: string | null;
    volumeMl?: number;
    registradoPorId: string;
    opcionais?: Array<{ produtoEstoqueId: string | null; quantidade: number }>;
  },
) {
  if (!params.moduloControlaEstoque || params.quantidade <= 0) return;

  if (params.controlaEstoque) {
    await entrarQuantidade(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      quantidade: params.tapId ? ((params.volumeMl ?? 0) * params.quantidade) / 1000 : params.quantidade,
      tipo: 'ESTORNO_VENDA',
      observacao: 'Estorno item da comanda',
      registradoPorId: params.registradoPorId,
      pedidoId: params.pedidoId,
    });
  }
  for (const opcional of params.opcionais ?? []) {
    if (!opcional.produtoEstoqueId) continue;
    const produto = await tx.produto.findFirst({ where: { id: opcional.produtoEstoqueId, cervejariaId: params.cervejariaId }, select: { nome: true, controlaEstoque: true } });
    if (produto?.controlaEstoque) await entrarQuantidade(tx, { cervejariaId: params.cervejariaId, pontoVendaId: params.pontoVendaId, produtoId: opcional.produtoEstoqueId, quantidade: params.quantidade * opcional.quantidade, tipo: 'ESTORNO_VENDA', observacao: 'Estorno opcional da comanda', registradoPorId: params.registradoPorId, pedidoId: params.pedidoId });
  }
}

/** Baixa estoque ao aumentar a quantidade de um item ja lancado na comanda. */
export async function baixarEstoqueItemPedido(
  tx: TxClient,
  params: {
    moduloControlaEstoque: boolean;
    cervejariaId: string;
    pontoVendaId: string;
    pedidoId: string;
    produtoId: string;
    nome: string;
    quantidade: number;
    controlaEstoque: boolean;
    tapId?: string | null;
    volumeMl?: number;
    registradoPorId: string;
    opcionais?: Array<{ produtoEstoqueId: string | null; quantidade: number }>;
  },
) {
  if (!params.moduloControlaEstoque || !params.controlaEstoque || params.quantidade <= 0) return;

  await baixarQuantidade(tx, {
    cervejariaId: params.cervejariaId,
    pontoVendaId: params.pontoVendaId,
    produtoId: params.produtoId,
    quantidade: params.tapId ? ((params.volumeMl ?? 0) * params.quantidade) / 1000 : params.quantidade,
    nomeProduto: params.nome,
    tipo: 'SAIDA_VENDA',
    registradoPorId: params.registradoPorId,
    pedidoId: params.pedidoId,
  });
  for (const opcional of params.opcionais ?? []) {
    if (!opcional.produtoEstoqueId) continue;
    const produto = await tx.produto.findFirst({ where: { id: opcional.produtoEstoqueId, cervejariaId: params.cervejariaId, ativo: true }, select: { nome: true, controlaEstoque: true } });
    if (produto?.controlaEstoque) await baixarQuantidade(tx, { cervejariaId: params.cervejariaId, pontoVendaId: params.pontoVendaId, produtoId: opcional.produtoEstoqueId, quantidade: params.quantidade * opcional.quantidade, nomeProduto: produto.nome, tipo: 'SAIDA_VENDA', registradoPorId: params.registradoPorId, pedidoId: params.pedidoId });
  }
}

/** Devolve ao estoque os itens dos pedidos de uma comanda cancelada. */
export async function estornarEstoqueDaComanda(
  tx: TxClient,
  params: {
    moduloControlaEstoque: boolean;
    cervejariaId: string;
    comandaId: string;
    registradoPorId: string;
  },
) {
  if (!params.moduloControlaEstoque) return;

  const itens = await tx.itemComanda.findMany({
    where: {
      comandaId: params.comandaId,
      produtoId: { not: null },
    },
    include: {
      produto: true,
      opcionais: true,
      pedidoCozinha: { select: { id: true, pontoVendaId: true } },
    },
  });

  for (const item of itens) {
    if (!item.produto?.controlaEstoque || !item.pedidoCozinha || !item.pedidoCozinha.pontoVendaId) continue;

    await entrarQuantidade(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: item.pedidoCozinha.pontoVendaId,
      produtoId: item.produto.id,
      quantidade: item.tapId ? (item.volumeMl * item.quantidade) / 1000 : item.quantidade,
      tipo: 'ESTORNO_VENDA',
      observacao: `Estorno comanda cancelada`,
      registradoPorId: params.registradoPorId,
      pedidoId: item.pedidoCozinha.id,
    });
    for (const opcional of (item as typeof item & { opcionais: Array<{ produtoEstoqueId: string | null; quantidade: number }> }).opcionais ?? []) {
      if (!opcional.produtoEstoqueId) continue;
      const produtoOpcional = await tx.produto.findFirst({ where: { id: opcional.produtoEstoqueId, cervejariaId: params.cervejariaId, ativo: true }, select: { controlaEstoque: true } });
      if (!produtoOpcional?.controlaEstoque) continue;
      await entrarQuantidade(tx, { cervejariaId: params.cervejariaId, pontoVendaId: item.pedidoCozinha.pontoVendaId, produtoId: opcional.produtoEstoqueId, quantidade: item.quantidade * opcional.quantidade, tipo: 'ESTORNO_VENDA', observacao: 'Estorno opcional comanda cancelada', registradoPorId: params.registradoPorId, pedidoId: item.pedidoCozinha.id });
    }
  }
}

export async function listarSaldos(cervejariaId: string, pontoVendaId: string) {
  const produtos = await prisma.produto.findMany({
    where: { cervejariaId, ativo: true, controlaEstoque: true },
    include: { precos: { select: { volumeMl: true } } },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });

  const saldos = await prisma.inventoryBalance.findMany({
    where: { cervejariaId, pontoVendaId, produtoId: { in: produtos.map((p) => p.id) } },
  });

  const saldoPorProduto = new Map(saldos.map((saldo) => [saldo.produtoId, saldo]));

  return produtos.map((produto) => ({
    produtoId: produto.id,
    nome: produto.nome,
    categoria: produto.categoria,
    quantidade: Number(saldoPorProduto.get(produto.id)?.quantidade ?? 0),
    estoqueMinimo: saldoPorProduto.get(produto.id)?.estoqueMinimo == null ? null : Number(saldoPorProduto.get(produto.id)!.estoqueMinimo),
    unidadeEstoque: isBebidaChopeOperacao(produto) ? 'L' as const : 'un' as const,
    statusEstoque: classificarEstoque(
      Number(saldoPorProduto.get(produto.id)?.quantidade ?? 0),
      saldoPorProduto.get(produto.id)?.estoqueMinimo == null ? null : Number(saldoPorProduto.get(produto.id)!.estoqueMinimo),
    ),
  }));
}

export async function atualizarEstoqueMinimo(params: {
  cervejariaId: string;
  pontoVendaId: string;
  produtoId: string;
  estoqueMinimo: number | null;
}) {
  const produto = await prisma.produto.findFirst({
    where: { id: params.produtoId, cervejariaId: params.cervejariaId, ativo: true, controlaEstoque: true },
    include: { precos: { select: { volumeMl: true } } },
  });
  if (produto && params.estoqueMinimo !== null) validarQuantidadePorUnidade(produto, params.estoqueMinimo);
  if (!produto) throw new EstoqueInvalidoError('Produto não encontrado ou sem controle de estoque');

  const pontoVenda = await prisma.pontoVenda.findFirst({
    where: { id: params.pontoVendaId, cervejariaId: params.cervejariaId, ativo: true },
    select: { id: true },
  });
  if (!pontoVenda) throw new EstoqueInvalidoError('Ponto de venda não encontrado');

  await prisma.$transaction(async (tx) => {
    await lockEstoqueEmTx(tx, params);
    await garantirSaldo(tx, params);
    await tx.inventoryBalance.update({
      where: { pontoVendaId_produtoId: { pontoVendaId: params.pontoVendaId, produtoId: params.produtoId } },
      data: { estoqueMinimo: params.estoqueMinimo },
    });
  });

  return listarSaldos(params.cervejariaId, params.pontoVendaId);
}

export async function registrarEntrada(params: {
  cervejariaId: string;
  pontoVendaId: string;
  produtoId: string;
  quantidade: number;
  observacao?: string;
  registradoPorId: string;
}) {
  if (params.quantidade <= 0) throw new EstoqueInvalidoError('Informe uma quantidade maior que zero');

  const produto = await prisma.produto.findFirst({
    where: { id: params.produtoId, cervejariaId: params.cervejariaId, ativo: true },
    include: { precos: { select: { volumeMl: true } } },
  });
  if (produto) validarQuantidadePorUnidade(produto, params.quantidade);
  if (!produto) throw new EstoqueInvalidoError('Produto não encontrado');
  if (!produto.controlaEstoque) {
    throw new EstoqueInvalidoError('Este produto não controla estoque');
  }

  const pontoVenda = await prisma.pontoVenda.findFirst({
    where: { id: params.pontoVendaId, cervejariaId: params.cervejariaId, ativo: true },
  });
  if (!pontoVenda) throw new EstoqueInvalidoError('Ponto de venda não encontrado');

  await prisma.$transaction(async (tx) => {
    await entrarQuantidade(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      quantidade: params.quantidade,
      tipo: 'ENTRADA',
      observacao: params.observacao,
      registradoPorId: params.registradoPorId,
    });
  });

  return listarSaldos(params.cervejariaId, params.pontoVendaId);
}

export async function registrarSaidaManual(params: {
  cervejariaId: string;
  pontoVendaId: string;
  produtoId: string;
  tipo: 'PERDA' | 'CORTESIA' | 'CONSUMO_INTERNO';
  quantidade: number;
  observacao?: string;
  registradoPorId: string;
}) {
  if (!SAIDA_MANUAL.includes(params.tipo)) {
    throw new EstoqueInvalidoError('Tipo de movimento inválido');
  }
  if (params.quantidade <= 0) throw new EstoqueInvalidoError('Informe uma quantidade maior que zero');

  const produto = await prisma.produto.findFirst({
    where: { id: params.produtoId, cervejariaId: params.cervejariaId, ativo: true },
    include: { precos: { select: { volumeMl: true } } },
  });
  if (produto) validarQuantidadePorUnidade(produto, params.quantidade);
  if (!produto) throw new EstoqueInvalidoError('Produto não encontrado');
  if (!produto.controlaEstoque) {
    throw new EstoqueInvalidoError('Este produto não controla estoque');
  }

  const pontoVenda = await prisma.pontoVenda.findFirst({
    where: { id: params.pontoVendaId, cervejariaId: params.cervejariaId, ativo: true },
  });
  if (!pontoVenda) throw new EstoqueInvalidoError('Ponto de venda não encontrado');

  await prisma.$transaction(async (tx) => {
    await baixarQuantidade(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      quantidade: params.quantidade,
      nomeProduto: produto.nome,
      tipo: params.tipo,
      observacao: params.observacao,
      registradoPorId: params.registradoPorId,
    });
  });

  return listarSaldos(params.cervejariaId, params.pontoVendaId);
}

export async function ajustarSaldo(params: {
  cervejariaId: string;
  pontoVendaId: string;
  produtoId: string;
  quantidadeNova: number;
  observacao?: string;
  registradoPorId: string;
}) {
  if (params.quantidadeNova < 0) {
    throw new EstoqueInvalidoError('A quantidade contada não pode ser negativa');
  }

  const produto = await prisma.produto.findFirst({
    where: { id: params.produtoId, cervejariaId: params.cervejariaId, ativo: true },
    include: { precos: { select: { volumeMl: true } } },
  });
  if (produto) validarQuantidadePorUnidade(produto, params.quantidadeNova);
  if (!produto) throw new EstoqueInvalidoError('Produto não encontrado');
  if (!produto.controlaEstoque) {
    throw new EstoqueInvalidoError('Este produto não controla estoque');
  }

  const pontoVenda = await prisma.pontoVenda.findFirst({
    where: { id: params.pontoVendaId, cervejariaId: params.cervejariaId, ativo: true },
  });
  if (!pontoVenda) throw new EstoqueInvalidoError('Ponto de venda não encontrado');

  await prisma.$transaction(async (tx) => {
    await lockEstoqueEmTx(tx, params);
    const saldo = await garantirSaldo(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
    });

    const delta = params.quantidadeNova - Number(saldo.quantidade);
    if (delta === 0) return;

    if (delta > 0) {
      await entrarQuantidade(tx, {
        cervejariaId: params.cervejariaId,
        pontoVendaId: params.pontoVendaId,
        produtoId: params.produtoId,
        quantidade: delta,
        tipo: 'AJUSTE',
        observacao: params.observacao,
        registradoPorId: params.registradoPorId,
      });
      return;
    }

    await baixarQuantidade(tx, {
      cervejariaId: params.cervejariaId,
      pontoVendaId: params.pontoVendaId,
      produtoId: params.produtoId,
      quantidade: -delta,
      nomeProduto: produto.nome,
      tipo: 'AJUSTE',
      observacao: params.observacao,
      registradoPorId: params.registradoPorId,
    });
  });

  return listarSaldos(params.cervejariaId, params.pontoVendaId);
}
