import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { toNumber } from './utils.js';
import { isBebidaChope, isVendaUnitaria } from './produto-utils.js';
import { assertChopeAtivoNoTap, listTapsComChopeAtual } from './tap-montagem.js';
import { assertProdutoNoCardapioEvento, listProdutosDoEvento } from './evento-cardapio.js';

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
  const total = itens.reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
  return prisma.comanda.update({
    where: { id: comandaId },
    data: { total },
    include: comandaDetailInclude,
  });
}

export type AddItemInput = {
  produtoId: string;
  volumeMl: number;
  quantidade: number;
  tapId?: string;
};

export async function addItemToComanda(params: {
  comandaId: string;
  cervejariaId: string;
  eventoId: string;
  item: AddItemInput;
}) {
  const { comandaId, cervejariaId, eventoId, item } = params;

  const comanda = await prisma.comanda.findFirst({
    where: { id: comandaId, status: 'ABERTA', eventoId },
  });
  if (!comanda) return { error: 'Comanda não encontrada ou fechada' as const };

  const produto = await prisma.produto.findFirst({
    where: { id: item.produtoId, cervejariaId, ativo: true },
    include: { precos: true },
  });
  if (!produto) return { error: 'Produto inválido' as const };

  const isChope = isBebidaChope(produto.tipo, produto.formato);
  let tapId = item.tapId ?? null;

  if (isChope) {
    if (!tapId) {
      const montagens = await prisma.tapMontagem.findMany({
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
    const chopeNoTap = await assertChopeAtivoNoTap(eventoId, tapId, item.produtoId);
    if (!chopeNoTap) {
      return { error: 'Este chope não está posicionado no tap selecionado' as const };
    }
  } else if (isVendaUnitaria(produto.tipo, produto.formato)) {
    const noCardapio = await assertProdutoNoCardapioEvento(eventoId, item.produtoId);
    if (!noCardapio) {
      return { error: 'Este item não está no cardápio deste evento' as const };
    }
  }

  const preco = produto.precos.find((p) => p.volumeMl === item.volumeMl);
  if (!preco) return { error: 'Preço não encontrado para este volume' as const };

  await prisma.itemComanda.create({
    data: {
      comandaId,
      produtoId: item.produtoId,
      tapId: isChope ? tapId : null,
      volumeMl: item.volumeMl,
      quantidade: item.quantidade,
      precoUnit: preco.preco,
    },
  });

  const updated = await recalcComandaTotal(comandaId);
  return {
    ok: true as const,
    comanda: updated,
    produto,
    isChope,
    precoUnit: toNumber(preco.preco),
  };
}

export async function buildPublicEventCardapio(eventoId: string, trailerId: string, cervejariaId: string) {
  const [tapsComChope, produtosEvento] = await Promise.all([
    listTapsComChopeAtual(eventoId, trailerId),
    listProdutosDoEvento(eventoId),
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
    bebidas: bebidas.map(serializeProduto),
    comidas: comidas.map(serializeProduto),
  };
}

function serializeProduto(p: Awaited<ReturnType<typeof listProdutosDoEvento>>[number]) {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    tipo: p.tipo,
    formato: p.formato,
    precos: p.precos.map((pr) => ({
      volumeMl: pr.volumeMl,
      preco: toNumber(pr.preco),
    })),
  };
}

export const pedidoInclude = {
  itens: { include: { produto: true } },
  cliente: { select: { id: true, nome: true, telefone: true } },
  comanda: { select: { id: true, total: true, status: true } },
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
      produto: i.produto.nome,
      volumeMl: i.volumeMl,
      quantidade: i.quantidade,
      precoUnit: toNumber(i.precoUnit),
      subtotal: toNumber(i.precoUnit) * i.quantidade,
    })),
    pedidos: pedidos.map(serializePedido),
  };
}
