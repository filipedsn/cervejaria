import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { toNumber } from '../utils.js';
import {
  aplicarStatusPedidoCozinha,
  itemBloqueadoPorCancelamentoIntegral,
  notificarComandaOperacaoAtualizada,
  notificarCozinha,
  pedidoVaiParaCozinha,
} from './cozinha.js';
import { EstoqueInvalidoError, baixarEstoqueItemPedido, estornarEstoqueItemPedido } from './estoque.js';
import { centavos, reais, resumoComanda, subtotalComandaEmCentavos } from './venda.js';
import {
  INCLUDE_COMANDA_OPERACAO,
  recalcComandaTotalOperacao,
  whereComandaOperacao,
} from './comanda-adapter.js';
import { lockComandaItemsInTx } from '../comanda-service.js';
import type { JwtPayload } from '../../types/auth.js';
import { usuarioPode, usuarioPodeCancelarItemEntregue } from './permissoes.js';
import { readCanonicalPdvOperationalSettingsIfEnabled } from '../canonical-pdv-operational-config.js';
import { assertCaixaAberto, lockCaixaEmTx } from './caixa.js';
import { assertCommandOccurrenceMatchesSession, cashOccurrenceContextEnabled, CashOccurrenceContextError } from './contexto-ocorrencia.js';

type ComandaCompleta = Prisma.ComandaGetPayload<{ include: typeof INCLUDE_COMANDA_OPERACAO }>;

export function resolverQuantidadeCancelamento(quantidadeAtual: number, solicitada?: number): number | null {
  const quantidade = solicitada ?? quantidadeAtual;
  return Number.isInteger(quantidade) && quantidade >= 1 && quantidade <= quantidadeAtual
    ? quantidade
    : null;
}

async function ajustarDescontoSeNecessario(tx: Prisma.TransactionClient, comanda: ComandaCompleta, cervejariaId: string) {
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId, tx);
  const configuracao = canonical ? null : await tx.configuracaoOperacional.findUnique({
    where: { cervejariaId },
    select: { kitchenItemsChargeAtLaunch: true },
  });
  const subtotalEmCents = subtotalComandaEmCentavos(comanda, canonical?.kitchenItemsChargeAtLaunch ?? configuracao?.kitchenItemsChargeAtLaunch ?? false);
  const descontoEmCents = centavos(toNumber(comanda.desconto ?? 0));
  if (descontoEmCents <= subtotalEmCents) return;

  await tx.comanda.update({
    where: { id: comanda.id },
    data: { desconto: reais(subtotalEmCents) },
  });
}

async function kitchenItemsChargeAtLaunch(tx: typeof prisma | Prisma.TransactionClient, cervejariaId: string) {
  const canonical = await readCanonicalPdvOperationalSettingsIfEnabled(cervejariaId, tx);
  if (canonical) return canonical.kitchenItemsChargeAtLaunch;
  const configuracao = await tx.configuracaoOperacional.findUnique({
    where: { cervejariaId },
    select: { kitchenItemsChargeAtLaunch: true },
  });
  return configuracao?.kitchenItemsChargeAtLaunch ?? false;
}

async function cancelarPedidoSeVazio(tx: Prisma.TransactionClient, pedidoId: string) {
  const pedido = await tx.pedidoOperacao.findUnique({
    where: { id: pedidoId },
    include: { itensComanda: true },
  });
  if (!pedido || pedido.itensComanda.length > 0 || ['CANCELADO', 'CANCELAMENTO_PENDENTE'].includes(pedido.status)) return pedido;

  return aplicarStatusPedidoCozinha(tx, pedido, 'CANCELADO');
}

async function carregarItem(
  client: typeof prisma | Prisma.TransactionClient,
  comandaId: string,
  itemId: string,
  cervejariaId: string,
) {
  return client.itemComanda.findFirst({
    where: {
      id: itemId,
      comandaId,
      comanda: whereComandaOperacao(cervejariaId),
    },
    include: {
      produto: true,
      opcionais: { include: { opcional: true } },
      pedidoCozinha: {
        include: {
          comanda: { include: INCLUDE_COMANDA_OPERACAO },
          itensComanda: { select: { exigePreparo: true, cancelamentoPendenteEm: true, canceladoEm: true } },
        },
      },
    },
  });
}

async function notificarMudancaCozinha(
  app: FastifyInstance,
  cervejariaId: string,
  temCozinha: boolean,
  pedidoId: string,
) {
  if (!temCozinha) return;

  const pedido = await prisma.pedidoOperacao.findUnique({
    where: { id: pedidoId },
    include: {
      itensComanda: { include: { opcionais: true } },
      comanda: { select: { id: true, tipo: true, identificador: true, numero: true } },
    },
  });
  if (pedido && pedidoVaiParaCozinha(pedido.itensComanda)) {
    notificarCozinha(app, cervejariaId, pedido, false);
  }
}

export async function removeItemFromComandaOperacao(params: {
  app: FastifyInstance;
  cervejariaId: string;
  comandaId: string;
  itemId: string;
  quantidade?: number;
  registradoPorId: string;
  moduloControlaEstoque: boolean;
  user?: JwtPayload;
  motivo?: string;
  tratamentoEstoque?: 'ERRO_LANCAMENTO' | 'PREPARADO_ENTREGUE_OU_PERDIDO';
  idempotencyKey?: string;
  quantidadeEsperada?: number;
}) {
  const item = await carregarItem(prisma, params.comandaId, params.itemId, params.cervejariaId);
  if (!item || !item.pedidoCozinha) return { error: 'Item não encontrado' as const };

  const comanda = item.pedidoCozinha.comanda;
  if (comanda.status !== 'ABERTA') {
    return { error: 'Comanda não encontrada ou fechada' as const };
  }
  if (itemBloqueadoPorCancelamentoIntegral(item.pedidoCozinha, item)) {
    return { error: 'Este pedido já foi cancelado' as const };
  }
  if (item.cancelamentoPendenteEm || item.canceladoEm) {
    return { error: 'Este item já está em cancelamento' as const };
  }
  if (item.pedidoCozinha.status === 'ENTREGUE') {
    if (!params.user || !params.motivo || !params.tratamentoEstoque || !params.idempotencyKey || !params.quantidadeEsperada) {
      throw Object.assign(new Error('Informe motivo, tratamento de estoque e confirme a quantidade atual'), { statusCode: 400 });
    }
    if (params.user && params.motivo && params.tratamentoEstoque && params.idempotencyKey && params.quantidadeEsperada) {
      return cancelarItemEntregueOperacao({
        ...params, user: params.user, motivo: params.motivo,
        tratamentoEstoque: params.tratamentoEstoque, idempotencyKey: params.idempotencyKey,
        quantidadeEsperada: params.quantidadeEsperada,
      }, item);
    }
    return { error: 'Este item já foi entregue' as const };
  }

  const pedidoId = item.pedidoCozinhaId!;

  const atualizada = await prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, params.comandaId);
    const itemAtual = await carregarItem(tx, params.comandaId, params.itemId, params.cervejariaId);
    if (!itemAtual || !itemAtual.pedidoCozinha) {
      throw Object.assign(new Error('Item não encontrado'), { statusCode: 404 });
    }
    if (itemAtual.pedidoCozinha.comanda.status !== 'ABERTA') {
      throw Object.assign(new Error('Comanda não encontrada ou fechada'), { statusCode: 409 });
    }
    if (itemBloqueadoPorCancelamentoIntegral(itemAtual.pedidoCozinha, itemAtual)) {
      throw Object.assign(new Error('Este pedido já foi cancelado'), { statusCode: 409 });
    }
    if (itemAtual.cancelamentoPendenteEm || itemAtual.canceladoEm) {
      throw Object.assign(new Error('Este item já está em cancelamento'), { statusCode: 409 });
    }
    if (itemAtual.pedidoCozinha.status === 'ENTREGUE') {
      throw Object.assign(new Error('Este item já foi entregue'), { statusCode: 409 });
    }

    const quantidadeCancelada = resolverQuantidadeCancelamento(itemAtual.quantidade, params.quantidade);
    if (quantidadeCancelada == null) {
      throw Object.assign(new Error('Quantidade inválida para cancelamento'), { statusCode: 400 });
    }

    if (itemAtual.produto) {
      await estornarEstoqueItemPedido(tx, {
        moduloControlaEstoque: params.moduloControlaEstoque,
        cervejariaId: params.cervejariaId,
        pontoVendaId: itemAtual.pedidoCozinha.pontoVendaId!,
        pedidoId,
        produtoId: itemAtual.produto.id,
        nome: itemAtual.nome ?? itemAtual.produto.nome,
        quantidade: quantidadeCancelada,
        controlaEstoque: itemAtual.produto.controlaEstoque,
        tapId: itemAtual.tapId,
        volumeMl: itemAtual.volumeMl,
        registradoPorId: params.registradoPorId,
        opcionais: itemAtual.opcionais.map((o) => ({ produtoEstoqueId: o.opcional?.produtoEstoqueId ?? null, quantidade: o.quantidade })),
      });
    }

    // A linha já foi encaminhada à cozinha; o estado atual da configuração
    // não pode transformar o cancelamento em exclusão imediata.
    if (itemAtual.exigePreparo && itemAtual.pedidoCozinhaId) {
      const cancelamentoPendenteEm = new Date();
      if (quantidadeCancelada < itemAtual.quantidade) {
        await tx.itemComanda.update({
          where: { id: itemAtual.id },
          data: { quantidade: itemAtual.quantidade - quantidadeCancelada },
        });
        const itemCancelamento = await tx.itemComanda.create({
          data: {
            comandaId: itemAtual.comandaId,
            produtoId: itemAtual.produtoId,
            tapId: itemAtual.tapId,
            volumeMl: itemAtual.volumeMl,
            quantidade: quantidadeCancelada,
            precoUnit: itemAtual.precoUnit,
            nome: itemAtual.nome,
            observacao: itemAtual.observacao,
            exigePreparo: itemAtual.exigePreparo,
            paraViagem: itemAtual.paraViagem,
            cancelamentoPendenteEm,
            pedidoCozinhaId: itemAtual.pedidoCozinhaId,
          },
        });
        if (itemAtual.opcionais.length > 0) {
          await tx.itemComandaOpcional.createMany({
            data: itemAtual.opcionais.map((opcional) => ({
              itemComandaId: itemCancelamento.id,
              opcionalId: opcional.opcionalId,
              opcionalCatalogoId: opcional.opcionalCatalogoId,
              nome: opcional.nome,
              precoAdicional: opcional.precoAdicional,
              quantidade: opcional.quantidade,
            })),
          });
        }
      } else {
        await tx.itemComanda.update({
          where: { id: itemAtual.id },
          data: { cancelamentoPendenteEm },
        });
      }
    } else if (quantidadeCancelada < itemAtual.quantidade) {
      await tx.itemComanda.update({
        where: { id: itemAtual.id },
        data: { quantidade: itemAtual.quantidade - quantidadeCancelada },
      });
    } else {
      await tx.itemComanda.delete({ where: { id: itemAtual.id } });
      await cancelarPedidoSeVazio(tx, pedidoId);
    }

    const comandaFresh = await tx.comanda.findUniqueOrThrow({
      where: { id: params.comandaId },
      include: INCLUDE_COMANDA_OPERACAO,
    });
    await ajustarDescontoSeNecessario(tx, comandaFresh, params.cervejariaId);
    const chargeKitchenAtLaunch = await kitchenItemsChargeAtLaunch(tx, params.cervejariaId);
    await recalcComandaTotalOperacao(tx, params.comandaId, { kitchenItemsChargeAtLaunch: chargeKitchenAtLaunch });

    return { comanda: await tx.comanda.findUniqueOrThrow({
      where: { id: params.comandaId },
      include: INCLUDE_COMANDA_OPERACAO,
    }), chargeKitchenAtLaunch };
  });

  notificarComandaOperacaoAtualizada(params.app, params.cervejariaId, params.comandaId);
  await notificarMudancaCozinha(params.app, params.cervejariaId, item.exigePreparo, pedidoId);

  return {
    ok: true as const,
    cancelamentoPendente: Boolean(item.pedidoCozinhaId && item.exigePreparo),
    comanda: resumoComanda(atualizada.comanda, atualizada.chargeKitchenAtLaunch),
    item,
  };
}

async function cancelarItemEntregueOperacao(
  params: {
    app: FastifyInstance; cervejariaId: string; comandaId: string; itemId: string;
    quantidade?: number; registradoPorId: string; moduloControlaEstoque: boolean;
    user: JwtPayload; motivo: string;
    tratamentoEstoque: 'ERRO_LANCAMENTO' | 'PREPARADO_ENTREGUE_OU_PERDIDO';
    idempotencyKey: string; quantidadeEsperada: number;
  },
  itemInicial: NonNullable<Awaited<ReturnType<typeof carregarItem>>>,
) {
  if (!/^[0-9a-f-]{36}$/i.test(params.idempotencyKey)) return { error: 'Identificador invalido para confirmar cancelamento' as const };
  if (params.motivo.trim().length < 3 || params.motivo.trim().length > 500) return { error: 'Informe um motivo entre 3 e 500 caracteres' as const };

  const resultado = await prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, params.comandaId);
    const item = await carregarItem(tx, params.comandaId, params.itemId, params.cervejariaId);
    if (!item || !item.pedidoCozinha) throw Object.assign(new Error('Item nao encontrado'), { statusCode: 404 });
    if (!(await usuarioPodeCancelarItemEntregue(params.user, tx))) {
      throw Object.assign(new Error('Voce precisa das permissoes Cancelar itens e Cancelar item ja entregue.'), { statusCode: 403 });
    }
    const anterior = await tx.itemComandaCancelamentoEntregue.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (anterior) {
      if (anterior.itemComandaId !== params.itemId || anterior.cervejariaId !== params.cervejariaId || anterior.usuarioId !== params.user.sub) {
        throw Object.assign(new Error('Identificador ja utilizado em outra operacao'), { statusCode: 409 });
      }
      const comanda = await tx.comanda.findUniqueOrThrow({ where: { id: params.comandaId }, include: INCLUDE_COMANDA_OPERACAO });
      return { comanda, quantidade: anterior.quantidade, valor: toNumber(anterior.valorRetirado), repetido: true };
    }
    if (item.pedidoCozinha.comanda.status !== 'ABERTA') throw Object.assign(new Error('Comanda nao encontrada ou fechada'), { statusCode: 409 });
    if (item.pedidoCozinha.status !== 'ENTREGUE') throw Object.assign(new Error('O pedido nao esta mais marcado como entregue'), { statusCode: 409 });
    if (itemBloqueadoPorCancelamentoIntegral(item.pedidoCozinha, item) || item.cancelamentoPendenteEm || item.canceladoEm) {
      throw Object.assign(new Error('Este item ja foi cancelado ou esta em cancelamento'), { statusCode: 409 });
    }
    if (item.pedidoCozinha.comanda.pagamentos.length > 0 || await tx.pagamento.count({ where: { comandaId: params.comandaId } }) > 0) {
      throw Object.assign(new Error('Esta comanda possui pagamentos. Use o fluxo proprio de correcao ou estorno.'), { statusCode: 409 });
    }
    if (item.quantidade !== params.quantidadeEsperada) {
      throw Object.assign(new Error('A quantidade disponivel mudou em outra sessao. Atualize a comanda e tente novamente.'), { statusCode: 409 });
    }
    const quantidade = resolverQuantidadeCancelamento(item.quantidade, params.quantidade);
    if (quantidade == null) throw Object.assign(new Error('Quantidade invalida para cancelamento'), { statusCode: 400 });

    const pedidoId = item.pedidoCozinhaId!;
    let estoqueEstornado = false;
    if (params.tratamentoEstoque === 'ERRO_LANCAMENTO' && params.moduloControlaEstoque && item.produto) {
      let produtoPrincipalComBaixa = false;
      if (item.produto.controlaEstoque) {
        const quantidadeEstoque = item.tapId ? (item.volumeMl * quantidade) / 1000 : quantidade;
        const saidas = await tx.inventoryMovement.aggregate({ where: { pedidoId, produtoId: item.produto.id, tipo: 'SAIDA_VENDA' }, _sum: { quantidade: true } });
        const estornos = await tx.inventoryMovement.aggregate({ where: { pedidoId, produtoId: item.produto.id, tipo: 'ESTORNO_VENDA' }, _sum: { quantidade: true } });
        const baixaLiquida = Number(saidas._sum.quantidade ?? 0) - Number(estornos._sum.quantidade ?? 0);
        if (baixaLiquida > 0 && baixaLiquida + 1e-9 < quantidadeEstoque) {
          throw Object.assign(new Error('A baixa registrada para este produto e pedido nao cobre a quantidade. O estoque nao foi alterado.'), { statusCode: 409 });
        }
        produtoPrincipalComBaixa = baixaLiquida + 1e-9 >= quantidadeEstoque;
      }
      const opcionaisComBaixa: typeof item.opcionais = [];
      for (const opcional of item.opcionais) {
        const produtoEstoqueId = opcional.opcional?.produtoEstoqueId;
        if (!produtoEstoqueId) continue;
        const produtoOpcional = await tx.produto.findFirst({ where: { id: produtoEstoqueId, cervejariaId: params.cervejariaId }, select: { controlaEstoque: true } });
        if (!produtoOpcional?.controlaEstoque) continue;
        const quantidadeOpcional = quantidade * opcional.quantidade;
        const saidasOpcional = await tx.inventoryMovement.aggregate({ where: { pedidoId, produtoId: produtoEstoqueId, tipo: 'SAIDA_VENDA' }, _sum: { quantidade: true } });
        const estornosOpcional = await tx.inventoryMovement.aggregate({ where: { pedidoId, produtoId: produtoEstoqueId, tipo: 'ESTORNO_VENDA' }, _sum: { quantidade: true } });
        const baixaLiquidaOpcional = Number(saidasOpcional._sum.quantidade ?? 0) - Number(estornosOpcional._sum.quantidade ?? 0);
        if (baixaLiquidaOpcional > 0 && baixaLiquidaOpcional + 1e-9 < quantidadeOpcional) {
          throw Object.assign(new Error('A baixa registrada para um opcional nao cobre a quantidade. O estoque nao foi alterado.'), { statusCode: 409 });
        }
        if (baixaLiquidaOpcional + 1e-9 >= quantidadeOpcional) opcionaisComBaixa.push(opcional);
      }
      estoqueEstornado = produtoPrincipalComBaixa || opcionaisComBaixa.length > 0;
      if (estoqueEstornado) {
        await estornarEstoqueItemPedido(tx, {
          moduloControlaEstoque: true, cervejariaId: params.cervejariaId,
          pontoVendaId: item.pedidoCozinha.pontoVendaId!, pedidoId,
          produtoId: item.produto.id, nome: item.nome ?? item.produto.nome,
          quantidade, controlaEstoque: produtoPrincipalComBaixa, tapId: item.tapId, volumeMl: item.volumeMl,
          registradoPorId: params.registradoPorId,
          opcionais: opcionaisComBaixa.map((o) => ({ produtoEstoqueId: o.opcional?.produtoEstoqueId ?? null, quantidade: o.quantidade })),
        });
      }
    }

    const valorRetirado = reais(centavos(item.precoUnit) * quantidade);
    const canceladoEm = new Date();
    await tx.itemComandaCancelamentoEntregue.create({ data: {
      itemComandaId: item.id, idempotencyKey: params.idempotencyKey,
      cervejariaId: params.cervejariaId, usuarioId: params.user.sub,
      quantidade, valorRetirado, motivo: params.motivo.trim(),
      tratamentoEstoque: params.tratamentoEstoque === 'ERRO_LANCAMENTO'
        ? (estoqueEstornado ? 'REVERSAO_BAIXA_EXISTENTE' : 'SEM_BAIXA_ESTOQUE')
        : 'SEM_RETORNO_PRODUTO_PREPARADO_ENTREGUE_OU_PERDIDO',
    } });
    await tx.itemComanda.update({ where: { id: item.id }, data: quantidade === item.quantidade
      ? { canceladoEm } : { quantidade: item.quantidade - quantidade } });
    const comandaAtual = await tx.comanda.findUniqueOrThrow({ where: { id: params.comandaId }, include: INCLUDE_COMANDA_OPERACAO });
    await ajustarDescontoSeNecessario(tx, comandaAtual, params.cervejariaId);
    const chargeKitchenAtLaunch = await kitchenItemsChargeAtLaunch(tx, params.cervejariaId);
    await recalcComandaTotalOperacao(tx, params.comandaId, { kitchenItemsChargeAtLaunch: chargeKitchenAtLaunch });
    const comanda = await tx.comanda.findUniqueOrThrow({ where: { id: params.comandaId }, include: INCLUDE_COMANDA_OPERACAO });
    return { comanda, quantidade, valor: toNumber(valorRetirado), repetido: false };
  });

  if (!resultado.repetido) notificarComandaOperacaoAtualizada(params.app, params.cervejariaId, params.comandaId);
  const chargeKitchenAtLaunch = await kitchenItemsChargeAtLaunch(prisma, params.cervejariaId);
  return {
    ok: true as const,
    comanda: resumoComanda(resultado.comanda, chargeKitchenAtLaunch),
    cancelamentoEntregue: { quantidade: resultado.quantidade, valorRetirado: resultado.valor, repetido: resultado.repetido },
    item: itemInicial,
  };
}

export async function confirmarCancelamentoItemComandaOperacao(params: {
  app: FastifyInstance;
  cervejariaId: string;
  pedidoId: string;
  itemId: string;
}) {
  const item = await prisma.itemComanda.findFirst({
    where: {
      id: params.itemId,
      pedidoCozinhaId: params.pedidoId,
      exigePreparo: true,
      pedidoCozinha: { cervejariaId: params.cervejariaId },
    },
    include: { pedidoCozinha: true, comanda: { select: { eventoId: true } } },
  });
  if (!item?.pedidoCozinha) return { error: 'Item não encontrado' as const };
  if (!item.cancelamentoPendenteEm || item.canceladoEm) {
    return { error: 'Este item não possui cancelamento pendente' as const };
  }

  await prisma.$transaction(async (tx) => {
    await lockComandaItemsInTx(tx, item.comandaId);
    const atual = await tx.itemComanda.findFirst({
      where: {
        id: item.id,
        pedidoCozinhaId: params.pedidoId,
        pedidoCozinha: { cervejariaId: params.cervejariaId },
      },
      include: { pedidoCozinha: true },
    });
    if (!atual?.pedidoCozinha || !atual.cancelamentoPendenteEm || atual.canceladoEm) {
      throw Object.assign(new Error('Este item não possui cancelamento pendente'), { statusCode: 409 });
    }

    await tx.itemComanda.update({
      where: { id: atual.id },
      data: { cancelamentoPendenteEm: null, canceladoEm: new Date() },
    });

    const itensAtivosDoPedido = await tx.itemComanda.count({
      where: { pedidoCozinhaId: params.pedidoId, exigePreparo: true, canceladoEm: null },
    });
    if (itensAtivosDoPedido === 0 && atual.pedidoCozinha.status !== 'CANCELADO') {
      await aplicarStatusPedidoCozinha(tx, atual.pedidoCozinha, 'CANCELADO');
    }

    await recalcComandaTotalOperacao(tx, atual.comandaId);
  });

  notificarComandaOperacaoAtualizada(params.app, params.cervejariaId, item.comandaId);
  await notificarMudancaCozinha(params.app, params.cervejariaId, true, params.pedidoId);
  return { ok: true as const, eventoId: item.comanda.eventoId, comandaId: item.comandaId };
}

export async function updateItemQuantidadeComandaOperacao(params: {
  app: FastifyInstance;
  cervejariaId: string;
  comandaId: string;
  itemId: string;
  quantidade: number;
  user: JwtPayload;
  registradoPorId: string;
  moduloControlaEstoque: boolean;
  temCozinha: boolean;
}) {
  if (!Number.isInteger(params.quantidade) || params.quantidade < 1) {
    return { error: 'Informe uma quantidade válida' as const };
  }

  const item = await carregarItem(prisma, params.comandaId, params.itemId, params.cervejariaId);
  if (!item || !item.pedidoCozinha) return { error: 'Item não encontrado' as const };

  const comanda = item.pedidoCozinha.comanda;
  if (comanda.status !== 'ABERTA') {
    return { error: 'Comanda não encontrada ou fechada' as const };
  }
  if (itemBloqueadoPorCancelamentoIntegral(item.pedidoCozinha, item)) {
    return { error: 'Este pedido já foi cancelado' as const };
  }

  if (item.cancelamentoPendenteEm || item.canceladoEm) {
    return { error: 'Este item está em cancelamento' as const };
  }

  const delta = params.quantidade - item.quantidade;
  if (delta === 0) {
    const chargeKitchenAtLaunch = await kitchenItemsChargeAtLaunch(prisma, params.cervejariaId);
    return { ok: true as const, comanda: resumoComanda(comanda, chargeKitchenAtLaunch), item };
  }

  if (item.pedidoCozinha.status === 'ENTREGUE') {
    return { error: 'Este pedido já foi entregue' as const };
  }

  const pedidoId = item.pedidoCozinhaId!;
  const occurrenceScoped = cashOccurrenceContextEnabled();
  const cashLockScope = occurrenceScoped ? {
    pontoVendaId: item.pedidoCozinha.comanda.pontoVendaId,
    diaOperacional: item.pedidoCozinha.comanda.diaOperacional,
  } : null;

  try {
    const atualizada = await prisma.$transaction(async (tx) => {
      // Match order launch and payment: serialize by cash session before taking
      // the comanda lock so close-vs-consumption races cannot validate stale context.
      if (cashLockScope?.diaOperacional && cashLockScope.pontoVendaId) {
        await lockCaixaEmTx(tx, params.cervejariaId, cashLockScope.pontoVendaId, cashLockScope.diaOperacional);
      }
      await lockComandaItemsInTx(tx, params.comandaId);
      const itemAtual = await carregarItem(tx, params.comandaId, params.itemId, params.cervejariaId);
      if (!itemAtual || !itemAtual.pedidoCozinha) {
        throw Object.assign(new Error('Item não encontrado'), { statusCode: 404 });
      }
      if (itemAtual.pedidoCozinha.comanda.status !== 'ABERTA') {
        throw Object.assign(new Error('Comanda não encontrada ou fechada'), { statusCode: 409 });
      }
      if (itemBloqueadoPorCancelamentoIntegral(itemAtual.pedidoCozinha, itemAtual)) {
        throw Object.assign(new Error('Este pedido já foi cancelado'), { statusCode: 409 });
      }

      if (itemAtual.cancelamentoPendenteEm || itemAtual.canceladoEm) {
        throw Object.assign(new Error('Este item está em cancelamento'), { statusCode: 409 });
      }

      if (itemAtual.pedidoCozinha.status === 'ENTREGUE') {
        throw Object.assign(new Error('Este pedido já foi entregue'), { statusCode: 409 });
      }

      if (itemAtual.exigePreparo) {
        throw Object.assign(new Error('A quantidade não pode ser alterada depois que o pedido foi enviado à cozinha'), { statusCode: 409 });
      }

      const deltaAtual = params.quantidade - itemAtual.quantidade;
      if (deltaAtual < 0 && !(await usuarioPode(params.user, 'command.item.cancel', {}, tx))) {
        throw Object.assign(new Error('Você não tem permissão para cancelar itens'), { statusCode: 403 });
      }
      if (deltaAtual > 0 && !(await usuarioPode(params.user, 'command.operate', {}, tx))) {
        throw Object.assign(new Error('Você não tem permissão para aumentar itens'), { statusCode: 403 });
      }
      if (deltaAtual > 0 && occurrenceScoped) {
        const comandaAtual = itemAtual.pedidoCozinha.comanda;
        const pontoVendaId = comandaAtual.pontoVendaId;
        const dia = comandaAtual.diaOperacional;
        if (!pontoVendaId || !dia) {
          throw new CashOccurrenceContextError(
            'CASH_OCCURRENCE_COMMAND_SCOPE_MISSING',
            'A comanda não possui tenant, PDV e dia operacional para autorizar novo consumo.',
          );
        }
        if (pontoVendaId !== cashLockScope?.pontoVendaId || dia.getTime() !== cashLockScope?.diaOperacional?.getTime()) {
          throw new CashOccurrenceContextError(
            'CASH_OCCURRENCE_COMMAND_SCOPE_CHANGED',
            'A comanda mudou de PDV ou dia operacional enquanto a edição aguardava seu lock.',
          );
        }
        const sessao = await assertCaixaAberto(params.cervejariaId, pontoVendaId, dia, tx);
        if (sessao.cervejariaId !== params.cervejariaId || sessao.pontoVendaId !== pontoVendaId) {
          throw new CashOccurrenceContextError(
            'CASH_OCCURRENCE_SESSION_SCOPE_MISMATCH',
            'A sessão autorizadora não pertence ao tenant e PDV da comanda.',
          );
        }
        assertCommandOccurrenceMatchesSession(comandaAtual, sessao);
      }
      if (itemAtual.produto) {
        if (deltaAtual > 0) {
          await baixarEstoqueItemPedido(tx, {
            moduloControlaEstoque: params.moduloControlaEstoque,
            cervejariaId: params.cervejariaId,
            pontoVendaId: itemAtual.pedidoCozinha.pontoVendaId!,
            pedidoId,
            produtoId: itemAtual.produto.id,
            nome: itemAtual.nome ?? itemAtual.produto.nome,
            quantidade: deltaAtual,
            controlaEstoque: itemAtual.produto.controlaEstoque,
            tapId: itemAtual.tapId,
            volumeMl: itemAtual.volumeMl,
            registradoPorId: params.registradoPorId,
            opcionais: itemAtual.opcionais.map((o) => ({ produtoEstoqueId: o.opcional?.produtoEstoqueId ?? null, quantidade: o.quantidade })),
          });
        } else {
          await estornarEstoqueItemPedido(tx, {
            moduloControlaEstoque: params.moduloControlaEstoque,
            cervejariaId: params.cervejariaId,
            pontoVendaId: itemAtual.pedidoCozinha.pontoVendaId!,
            pedidoId,
            produtoId: itemAtual.produto.id,
            nome: itemAtual.nome ?? itemAtual.produto.nome,
            quantidade: -deltaAtual,
            controlaEstoque: itemAtual.produto.controlaEstoque,
            tapId: itemAtual.tapId,
            volumeMl: itemAtual.volumeMl,
            registradoPorId: params.registradoPorId,
            opcionais: itemAtual.opcionais.map((o) => ({ produtoEstoqueId: o.opcional?.produtoEstoqueId ?? null, quantidade: o.quantidade })),
          });
        }
      }

      await tx.itemComanda.update({
        where: { id: itemAtual.id },
        data: { quantidade: params.quantidade },
      });

      const comandaFresh = await tx.comanda.findUniqueOrThrow({
        where: { id: params.comandaId },
        include: INCLUDE_COMANDA_OPERACAO,
      });
      await ajustarDescontoSeNecessario(tx, comandaFresh, params.cervejariaId);
      const chargeKitchenAtLaunch = await kitchenItemsChargeAtLaunch(tx, params.cervejariaId);
      await recalcComandaTotalOperacao(tx, params.comandaId, { kitchenItemsChargeAtLaunch: chargeKitchenAtLaunch });

      return { comanda: await tx.comanda.findUniqueOrThrow({
        where: { id: params.comandaId },
        include: INCLUDE_COMANDA_OPERACAO,
      }), chargeKitchenAtLaunch };
    });

    notificarComandaOperacaoAtualizada(params.app, params.cervejariaId, params.comandaId);
    await notificarMudancaCozinha(params.app, params.cervejariaId, params.temCozinha, pedidoId);

    return { ok: true as const, comanda: resumoComanda(atualizada.comanda, atualizada.chargeKitchenAtLaunch), item };
  } catch (err) {
    if (err instanceof EstoqueInvalidoError) {
      return { error: err.message };
    }
    throw err;
  }
}
