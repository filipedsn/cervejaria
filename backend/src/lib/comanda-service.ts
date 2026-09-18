import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { toNumber } from './utils.js';
import { isBebidaChope, isVendaUnitaria } from './produto-utils.js';
import { assertChopeAtivoNoTap, listTapsComChopeAtual } from './tap-montagem.js';
import { assertProdutoNoCardapioEvento, listCatalogoCardapio, listProdutosDoEvento } from './evento-cardapio.js';
import { resolvePrecoCardapioCervejaria, mapPrecosCardapioCervejaria } from './cardapio-preco.js';
import { cervejariaUsaCardapio } from './cardapio-toggle.js';

export const comandaDetailInclude = {
  cliente: true,
  itens: {
    include: { produto: true, tap: { select: { id: true, numero: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  pagamentos: true,
} satisfies Prisma.ComandaInclude;

export async function recalcComandaTotal(comandaId: string) {
  const itens = await prisma.itemComanda.findMany({ where: { comandaId } });
  const comanda = await prisma.comanda.findUnique({
    where: { id: comandaId },
    select: { desconto: true },
  });
  const subtotal = itens.reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
  const total = Math.max(0, subtotal - toNumber(comanda?.desconto ?? 0));
  return prisma.comanda.update({
    where: { id: comandaId },
    data: { total },
    include: comandaDetailInclude,
  });
}

export async function recalcComandaTotalInTx(tx: Prisma.TransactionClient, comandaId: string) {
  const comanda = await tx.comanda.findUnique({
    where: { id: comandaId },
    select: { desconto: true },
  });
  const itens = await tx.itemComanda.findMany({ where: { comandaId } });
  const subtotal = itens.reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
  const total = Math.max(0, subtotal - toNumber(comanda?.desconto ?? 0));
  await tx.comanda.update({
    where: { id: comandaId },
    data: { total },
  });
  return total;
}

function comandaItemsLockKey(comandaId: string) {
  return `comanda-items:${comandaId}`;
}

export async function lockComandaItemsInTx(tx: Prisma.TransactionClient, comandaId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${comandaItemsLockKey(comandaId)})))`;
}

/**
 * Locks are taken in a deterministic order for operations involving more than
 * one comanda (such as group closing), avoiding lock-order inversions.
 */
export async function lockComandasInTx(tx: Prisma.TransactionClient, comandaIds: readonly string[]) {
  for (const comandaId of [...new Set(comandaIds)].sort()) {
    await lockComandaItemsInTx(tx, comandaId);
  }
}

export async function addItemToComandaInTx(
  tx: Prisma.TransactionClient,
  params: {
    comandaId: string;
    cervejariaId: string;
    eventoId: string;
    item: AddItemInput;
  },
) {
  const { comandaId, cervejariaId, eventoId, item } = params;

  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, status: 'ABERTA', eventoId },
  });
  if (!comanda) return { error: 'Comanda não encontrada ou fechada' as const };

  const evento = await tx.evento.findFirst({
    where: { id: eventoId, cervejariaId },
    select: { cardapioId: true },
  });

  const usaCardapio = await cervejariaUsaCardapio(cervejariaId, tx);

  const produto = await tx.produto.findFirst({
    where: { id: item.produtoId, cervejariaId, ativo: true },
    include: { precos: true },
  });
  if (!produto) return { error: 'Produto inválido' as const };

  const isChope = isBebidaChope(produto.tipo, produto.formato);
  let tapId = item.tapId ?? null;

  if (isChope) {
    if (!tapId) {
      const montagens = await tx.tapMontagem.findMany({
        where: { eventoId, produtoId: item.produtoId, encerradoEm: null },
        select: { tapId: true },
      });
      if (montagens.length === 1) {
        tapId = montagens[0].tapId;
      } else if (montagens.length === 0) {
        return { error: 'Chope não disponível no momento' as const };
      } else {
        return { error: 'Informe o tap para confirmar este chope' as const, needsTap: true as const };
      }
    }
    const chopeNoTap = await assertChopeAtivoNoTap(eventoId, tapId, item.produtoId, tx);
    if (!chopeNoTap) {
      return { error: 'Este chope não está posicionado no tap selecionado' as const };
    }
  } else if (isVendaUnitaria(produto.tipo, produto.formato) && usaCardapio) {
    const noCardapio = await assertProdutoNoCardapioEvento(eventoId, item.produtoId);
    if (!noCardapio) {
      return { error: 'Este item não está no cardápio deste evento' as const };
    }
  }

  const preco = produto.precos.find((p) => p.volumeMl === item.volumeMl);
  if (!preco) return { error: 'Preço não encontrado para este volume' as const };

  let precoUnit = toNumber(preco.preco);
  if (usaCardapio && evento?.cardapioId && isVendaUnitaria(produto.tipo, produto.formato) && !isChope) {
    const templatePreco = await resolvePrecoCardapioCervejaria(evento.cardapioId, item.produtoId);
    if (templatePreco !== null) precoUnit = templatePreco;
  }

  await tx.itemComanda.create({
    data: {
      comandaId,
      produtoId: item.produtoId,
      tapId: isChope ? tapId : null,
      volumeMl: item.volumeMl,
      quantidade: item.quantidade,
      precoUnit,
    },
  });

  const total = await recalcComandaTotalInTx(tx, comandaId);
  return {
    ok: true as const,
    total,
    produto,
    isChope,
    precoUnit,
  };
}

export type AddItemInput = {
  produtoId: string;
  volumeMl: number;
  quantidade: number;
  tapId?: string;
};

const COMANDA_ITEM_TX = { maxWait: 15_000, timeout: 20_000 } as const;

export async function addItemToComanda(params: {
  comandaId: string;
  cervejariaId: string;
  eventoId: string;
  item: AddItemInput;
}) {
  return prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, params.comandaId);
    const inner = await addItemToComandaInTx(tx, params);
    if ('error' in inner) return inner;

    const updated = await tx.comanda.findUniqueOrThrow({
      where: { id: params.comandaId },
      include: comandaDetailInclude,
    });
    return {
      ok: true as const,
      comanda: updated,
      produto: inner.produto,
      isChope: inner.isChope,
      precoUnit: inner.precoUnit,
    };
  }, COMANDA_ITEM_TX);
}

export async function removeItemFromComandaInTx(
  tx: Prisma.TransactionClient,
  params: {
    comandaId: string;
    itemId: string;
    cervejariaId: string;
    eventoId: string;
  },
) {
  const { comandaId, itemId, cervejariaId, eventoId } = params;

  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, status: 'ABERTA', eventoId, evento: { cervejariaId } },
  });
  if (!comanda) return { error: 'Comanda não encontrada ou fechada' as const };

  const item = await tx.itemComanda.findFirst({
    where: { id: itemId, comandaId },
    include: { produto: true },
  });
  if (!item) return { error: 'Item não encontrado' as const };

  await tx.itemComanda.delete({ where: { id: itemId } });
  await recalcComandaTotalInTx(tx, comandaId);

  const updated = await tx.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: comandaDetailInclude,
  });
  return { ok: true as const, comanda: updated, item };
}

export async function removeItemFromComanda(params: {
  comandaId: string;
  itemId: string;
  cervejariaId: string;
  eventoId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${comandaItemsLockKey(params.comandaId)})))`;
    return removeItemFromComandaInTx(tx, params);
  }, COMANDA_ITEM_TX);
}

export async function buildPublicEventCardapio(eventoId: string, trailerId: string, cervejariaId: string) {
  const [evento, usaCardapio] = await Promise.all([
    prisma.evento.findFirst({
      where: { id: eventoId, cervejariaId },
      select: { cardapioId: true },
    }),
    cervejariaUsaCardapio(cervejariaId),
  ]);

  const precosTemplate =
    usaCardapio && evento?.cardapioId
      ? await mapPrecosCardapioCervejaria(evento.cardapioId)
      : null;

  const [tapsComChope, produtosEvento] = await Promise.all([
    listTapsComChopeAtual(eventoId, trailerId),
    usaCardapio ? listProdutosDoEvento(eventoId) : listCatalogoCardapio(cervejariaId),
  ]);

  const chopes = tapsComChope
    .filter((t) => t.ativo && t.chopeAtual)
    .map((t) => ({
      tapId: t.id,
      tapNumero: t.numero,
      tapNome: t.nome,
      produto: {
        id: t.chopeAtual!.id,
        nome: t.chopeAtual!.nome,
        cor: t.chopeAtual!.cor,
        estilo: t.chopeAtual!.estilo,
        precos: t.chopeAtual!.precos.map((p) => ({
          volumeMl: p.volumeMl,
          preco: toNumber(p.preco),
        })),
      },
    }));

  const bebidas = produtosEvento.filter(
    (p) => isVendaUnitaria(p.tipo, p.formato) && !isBebidaChope(p.tipo, p.formato),
  );
  const comidas = produtosEvento.filter((p) => p.tipo === 'COMIDA');

  return {
    chopes,
    bebidas: bebidas.map((p) => serializeProduto(p, precosTemplate)),
    comidas: comidas.map((p) => serializeProduto(p, precosTemplate)),
  };
}

function serializeProduto(
  p: Awaited<ReturnType<typeof listProdutosDoEvento>>[number],
  precosTemplate: Map<string, number> | null,
) {
  const templatePreco = precosTemplate?.get(p.id);
  const precos =
    templatePreco !== undefined
      ? p.precos.length
        ? p.precos.map((pr, idx) =>
            idx === 0 ? { volumeMl: pr.volumeMl, preco: templatePreco } : { volumeMl: pr.volumeMl, preco: toNumber(pr.preco) },
          )
        : [{ volumeMl: 0, preco: templatePreco }]
      : p.precos.map((pr) => ({
          volumeMl: pr.volumeMl,
          preco: toNumber(pr.preco),
        }));

  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    tipo: p.tipo,
    formato: p.formato,
    precos,
    precoEfetivo: templatePreco ?? (precos[0]?.preco ?? 0),
  };
}

export async function aplicarDescontoComanda(params: {
  comandaId: string;
  cervejariaId: string;
  desconto: number;
}) {
  return prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, params.comandaId);
    const comanda = await tx.comanda.findFirst({
      where: {
        id: params.comandaId,
        status: 'ABERTA',
        evento: { cervejariaId: params.cervejariaId },
      },
      include: { itens: true },
    });
    if (!comanda) return { error: 'Comanda não encontrada ou fechada' as const };
    if (comanda.tipo === 'AVULSA') {
      return { error: 'Venda avulsa não permite desconto' as const };
    }

    const subtotal = comanda.itens.reduce(
      (sum, item) => sum + toNumber(item.precoUnit) * item.quantidade,
      0,
    );
    if (params.desconto > subtotal + 0.001) {
      return { error: 'O desconto não pode ser maior que o subtotal da comanda' as const };
    }

    await tx.comanda.update({
      where: { id: params.comandaId },
      data: { desconto: params.desconto },
    });
    await recalcComandaTotalInTx(tx, params.comandaId);
    const updated = await tx.comanda.findUniqueOrThrow({
      where: { id: params.comandaId },
      include: comandaDetailInclude,
    });
    return { ok: true as const, comanda: updated, subtotal };
  }, COMANDA_ITEM_TX);
}

export const pedidoInclude = {
  itens: { include: { produto: true } },
  cliente: { select: { id: true, nome: true, telefone: true } },
  comanda: { select: { id: true, numero: true, total: true, status: true } },
} satisfies Prisma.PedidoClienteInclude;

export function serializePedido(
  pedido: Prisma.PedidoClienteGetPayload<{ include: typeof pedidoInclude }>,
) {
  const totalEstimado = pedido.itens.reduce(
    (sum, i) => sum + toNumber(i.precoUnit) * i.quantidade,
    0,
  );
  return {
    ...pedido,
    totalEstimado,
    itens: pedido.itens.map((i) => ({
      ...i,
      precoUnit: toNumber(i.precoUnit),
      produto: i.produto,
    })),
    comanda: pedido.comanda
      ? { ...pedido.comanda, total: toNumber(pedido.comanda.total) }
      : pedido.comanda,
  };
}

export async function serializeComandaForCliente(comandaId: string) {
  const comanda = await prisma.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: comandaDetailInclude,
  });

  const pedidos = await prisma.pedidoCliente.findMany({
    where: { comandaId },
    include: pedidoInclude,
    orderBy: { createdAt: 'desc' },
  });

  return {
    id: comanda.id,
    status: comanda.status,
    total: toNumber(comanda.total),
    itens: comanda.itens.map((i) => ({
      id: i.id,
      produto: i.produto?.nome ?? i.nome,
      volumeMl: i.volumeMl,
      quantidade: i.quantidade,
      precoUnit: toNumber(i.precoUnit),
      subtotal: toNumber(i.precoUnit) * i.quantidade,
    })),
    pedidos: pedidos.map(serializePedido),
  };
}
