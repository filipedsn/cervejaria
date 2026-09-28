import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { toNumber } from './utils.js';
import { isBebidaChope, isVendaUnitaria } from './produto-utils.js';
import { assertChopeAtivoNoTap, listTapsComChopeAtual } from './tap-montagem.js';
import { assertProdutoNoCardapioEvento, listCatalogoCardapio, listProdutosDoEvento } from './evento-cardapio.js';
import { resolvePrecoCardapioCervejaria, mapPrecosCardapioCervejaria } from './cardapio-preco.js';
import { cervejariaUsaCardapio } from './cardapio-toggle.js';
import { kitchenService } from '../services/kitchen-service.js';
import { inventoryService } from '../services/inventory-service.js';
import { resolverOpcionais } from './produto-opcionais.js';
import { diaOperacional, proximoNumeroPedidoOperacao } from './operacao/venda.js';
import { estornarEstoqueItemPedido } from './operacao/estoque.js';

export const comandaDetailInclude = {
  cliente: true,
  itens: {
    include: {
      produto: true,
      tap: { select: { id: true, numero: true } },
      pedidoCozinha: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  pagamentos: true,
} satisfies Prisma.ComandaInclude;

export async function recalcComandaTotal(comandaId: string) {
  const itens = await prisma.itemComanda.findMany({ where: { comandaId }, include: { pedidoCozinha: { select: { status: true } } } });
  const comanda = await prisma.comanda.findUnique({
    where: { id: comandaId },
    select: { desconto: true },
  });
  const subtotal = itens
    .filter((item) => !item.cancelamentoPendenteEm && !item.canceladoEm && (!item.exigePreparo || item.pedidoCozinha?.status === 'ENTREGUE' || !item.pedidoCozinha))
    .reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
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
  const itens = await tx.itemComanda.findMany({ where: { comandaId }, include: { pedidoCozinha: { select: { status: true } } } });
  const subtotal = itens
    .filter((item) => !item.cancelamentoPendenteEm && !item.canceladoEm && (!item.exigePreparo || item.pedidoCozinha?.status === 'ENTREGUE' || !item.pedidoCozinha))
    .reduce((sum, item) => sum + toNumber(item.precoUnit) * item.quantidade, 0);
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

async function estoqueOperacionalHabilitado(tx: Prisma.TransactionClient, cervejariaId: string) {
  const empresa = await tx.cervejaria.findUnique({
    where: { id: cervejariaId },
    select: {
      configuracaoOperacional: { select: { inventoryEnabled: true } },
      configuracaoOperacao: { select: { ativo: true, controlaEstoque: true } },
    },
  });
  return empresa?.configuracaoOperacional?.inventoryEnabled
    ?? Boolean(empresa?.configuracaoOperacao?.ativo && empresa.configuracaoOperacao.controlaEstoque);
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
    criadoPorId: string;
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
    include: { precos: true, opcionaisVinculados: { include: { opcional: true }, orderBy: { ordem: 'asc' } } },
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
  let opcionais;
  try {
    opcionais = await resolverOpcionais(tx, produto.id, item.opcionais);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Opcionais inválidos' as const };
  }
  if (!preco) return { error: 'Preço não encontrado para este volume' as const };

  // EVENTO uses the same canonical capability boundaries and stock ledger as CAIXA.
  const participaDaCozinha = !isChope && kitchenService.participates(produto, 'EVENTO');
  const controlaEstoque = Boolean(await estoqueOperacionalHabilitado(tx, cervejariaId)
    && inventoryService.participates(produto, 'EVENTO'));
  let pontoVendaId = comanda.pontoVendaId;
  if (controlaEstoque && !pontoVendaId) {
    const pontos = await tx.pontoVenda.findMany({
      where: { cervejariaId, ativo: true },
      select: { id: true },
      take: 2,
    });
    if (pontos.length !== 1) {
      return { error: 'Vincule esta comanda a um ponto de venda para controlar o estoque do evento' as const };
    }
    pontoVendaId = pontos[0]!.id;
    await tx.comanda.update({ where: { id: comandaId }, data: { pontoVendaId } });
  }

  const dia = diaOperacional();
  const pedidoCozinha = participaDaCozinha
    ? await tx.pedidoOperacao.create({
        data: {
          cervejariaId,
          comandaId,
            pontoVendaId,
            numero: await proximoNumeroPedidoOperacao(tx, cervejariaId, dia),
            diaOperacional: dia,
            criadoPorId: params.criadoPorId,
            paraViagem: item.paraViagem ?? false,
          },
        })
    : null;

  let precoUnit = toNumber(preco.preco);
  if (usaCardapio && evento?.cardapioId && isVendaUnitaria(produto.tipo, produto.formato) && !isChope) {
    const templatePreco = await resolvePrecoCardapioCervejaria(evento.cardapioId, item.produtoId);
    if (templatePreco !== null) precoUnit = templatePreco;
  }
  // O preço do cardápio substitui apenas o preço-base do produto; opcionais
  // continuam sendo adicionais em qualquer modo de operação.
  precoUnit += opcionais.reduce((sum, opcional) => sum + opcional.precoAdicional * opcional.quantidade, 0);

  await tx.itemComanda.create({
    data: {
      comandaId,
      produtoId: item.produtoId,
      tapId: isChope ? tapId : null,
      volumeMl: item.volumeMl,
      quantidade: item.quantidade,
      precoUnit,
      nome: produto.nome,
      observacao: item.observacao?.trim() || null,
      exigePreparo: participaDaCozinha,
      paraViagem: item.paraViagem ?? false,
      pedidoCozinhaId: pedidoCozinha?.id ?? null,
    },
  });

  const itemCriado = await tx.itemComanda.findFirstOrThrow({
    where: { comandaId, pedidoCozinhaId: pedidoCozinha?.id ?? undefined, produtoId: item.produtoId },
    orderBy: { createdAt: 'desc' },
  });
  if (opcionais.length > 0) {
    await tx.itemComandaOpcional.createMany({
      data: opcionais.map((opcional) => ({
        itemComandaId: itemCriado.id,
        opcionalId: null,
        opcionalCatalogoId: opcional.opcionalCatalogoId ?? opcional.opcionalId,
        nome: opcional.nome,
        precoAdicional: opcional.precoAdicional,
        quantidade: opcional.quantidade,
      })),
    });
  }

  if (controlaEstoque && pontoVendaId) {
    await inventoryService.consumeSale(tx, {
      context: 'EVENTO',
      moduleEnabled: true,
      cervejariaId,
      pontoVendaId,
      ...(pedidoCozinha ? { pedidoId: pedidoCozinha.id } : {}),
      registradoPorId: params.criadoPorId,
      items: [{
        produtoId: produto.id,
        tapId: isChope ? tapId : null,
        volumeMl: item.volumeMl,
        nome: produto.nome,
        precoUnit,
        quantidade: item.quantidade,
        exigePreparo: participaDaCozinha,
        controlaEstoque: produto.controlaEstoque,
        paraViagem: item.paraViagem ?? false,
        observacao: item.observacao?.trim() || null,
        opcionais,
      }],
    });
  }

  const total = await recalcComandaTotalInTx(tx, comandaId);
  return {
    ok: true as const,
    total,
    produto,
    isChope,
    precoUnit,
    pedidoCozinha,
  };
}

export type AddItemInput = {
  produtoId: string;
  volumeMl: number;
  quantidade: number;
  tapId?: string;
  paraViagem?: boolean;
  observacao?: string;
  opcionais?: Array<{ opcionalId: string; quantidade?: number }>;
};

const COMANDA_ITEM_TX = { maxWait: 15_000, timeout: 20_000 } as const;

export async function addItemToComanda(params: {
  comandaId: string;
  cervejariaId: string;
  eventoId: string;
  item: AddItemInput;
  criadoPorId: string;
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
      pedidoCozinha: inner.pedidoCozinha,
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
    registradoPorId: string;
  },
) {
  const { comandaId, itemId, cervejariaId, eventoId, registradoPorId } = params;

  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, status: 'ABERTA', eventoId, evento: { cervejariaId } },
  });
  if (!comanda) return { error: 'Comanda não encontrada ou fechada' as const };

  const item = await tx.itemComanda.findFirst({
    where: { id: itemId, comandaId },
    include: { produto: true },
  });
  if (!item) return { error: 'Item não encontrado' as const };

  const cancelamentoPendente = Boolean(item.pedidoCozinhaId && item.exigePreparo);
  if (cancelamentoPendente) {
    await tx.itemComanda.update({
      where: { id: itemId },
      data: { cancelamentoPendenteEm: new Date() },
    });
  } else {
    if (await estoqueOperacionalHabilitado(tx, cervejariaId) && item.produto?.controlaEstoque && comanda.pontoVendaId) {
      await estornarEstoqueItemPedido(tx, {
        moduloControlaEstoque: true,
        cervejariaId,
        pontoVendaId: comanda.pontoVendaId,
        ...(item.pedidoCozinhaId ? { pedidoId: item.pedidoCozinhaId } : {}),
        produtoId: item.produto.id,
        nome: item.nome ?? item.produto.nome,
        quantidade: item.quantidade,
        controlaEstoque: item.produto.controlaEstoque,
        tapId: item.tapId,
        volumeMl: item.volumeMl,
        registradoPorId,
      });
    }
    await tx.itemComanda.delete({ where: { id: itemId } });
  }
  await recalcComandaTotalInTx(tx, comandaId);

  const updated = await tx.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: comandaDetailInclude,
  });
  return { ok: true as const, comanda: updated, item, cancelamentoPendente };
}

export async function removeItemFromComanda(params: {
  comandaId: string;
  itemId: string;
  cervejariaId: string;
  eventoId: string;
  registradoPorId: string;
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
        ? p.precos.map((pr: { volumeMl: number; preco: unknown }, idx: number) =>
            idx === 0 ? { volumeMl: pr.volumeMl, preco: templatePreco } : { volumeMl: pr.volumeMl, preco: toNumber(pr.preco) },
          )
        : [{ volumeMl: 0, preco: templatePreco }]
      : p.precos.map((pr: { volumeMl: number; preco: unknown }) => ({
          volumeMl: pr.volumeMl,
          preco: toNumber(pr.preco),
        }));

  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    tipo: p.tipo,
    formato: p.formato,
    gruposOpcionais: (p.opcionaisVinculados ?? []).length ? [{ id: 'opcionais', nome: 'Opcionais', obrigatorio: false, maximo: 99, opcoes: p.opcionaisVinculados.map(({ opcional }) => ({ id: opcional.id, nome: opcional.nome, precoAdicional: toNumber(opcional.preco) })) }] : [],
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
      (sum, item) => sum + (!item.cancelamentoPendenteEm && !item.canceladoEm
        ? toNumber(item.precoUnit) * item.quantidade
        : 0),
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
