import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getZonedParts } from '../event-datetime.js';
import { toNumber } from '../utils.js';
import { registrarHistoricoStatusPedido } from './cozinha.js';
import { kitchenService } from '../../services/kitchen-service.js';
import { isBebidaChopeOperacao } from '../produto-utils.js';

/**
 * Erro de regra de venda. O statusCode faz o Fastify responder 400 com a
 * mensagem pronta para o operador, em vez de registrar falha do servidor.
 */
import { cardapioProdutoVolumeKey, mapPrecosCardapioOperacao } from '../cardapio-preco.js';
import { operacaoUsaCardapio } from '../cardapio-toggle.js';
import { assertProdutoNoCardapioTurno } from './sessao-cardapio.js';
import { resolverOpcionais, type OpcionalSelecionadoInput, type OpcionalResolvido } from '../produto-opcionais.js';
import { canonicalPdvQaActivationEnabled, CanonicalPdvConfigurationError } from '../canonical-pdv-operational-config.js';

export class VendaInvalidaError extends Error {
  statusCode = 400;
}

/** Vendas concorrentes serializam no advisory lock do pedido; defaults do Prisma estouram antes. */
export const CAIXA_VENDA_TX = { maxWait: 15_000, timeout: 20_000 } as const;

/**
 * Dia da operacao no fuso de Brasilia. O operacao costuma virar a meia-noite,
 * entao a data do instante UTC colocaria a mesma noite em dois caixas.
 */
export function diaOperacional(referencia = new Date()): Date {
  const { year, month, day } = getZonedParts(referencia);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Dinheiro em centavos: soma de float erra centavo em venda com muitos itens. */
export function centavos(valor: unknown): number {
  return Math.round(toNumber(valor) * 100);
}

export function reais(valorEmCentavos: number): number {
  return valorEmCentavos / 100;
}

export interface ItemVendaInput {
  produtoId: string;
  quantidade: number;
  tapId?: string;
  volumeMl?: number;
  paraViagem?: boolean;
  observacao?: string;
  opcionais?: OpcionalSelecionadoInput[];
}

export interface ItemResolvido {
  produtoId: string;
  tapId: string | null;
  volumeMl: number;
  nome: string;
  precoUnit: number;
  quantidade: number;
  exigePreparo: boolean;
  prepararEmPedidoSeparado: boolean;
  controlaEstoque: boolean;
  paraViagem: boolean;
  observacao: string | null;
  opcionais: OpcionalResolvido[];
}

export function itemVaiParaCozinha(temCozinha: boolean, exigePreparo: boolean): boolean {
  return temCozinha && kitchenService.participates({ exigePreparo }, 'CAIXA');
}

type TxClient = Prisma.TransactionClient;

export async function validarChopeDoTurno(
  tx: TxClient,
  sessaoCaixaId: string,
  trailerId: string | null | undefined,
  pontoVendaId: string | null | undefined,
  cervejariaId: string,
  produtos: Array<{ id: string; tipo: Prisma.ProdutoGetPayload<{}>['tipo']; formato: Prisma.ProdutoGetPayload<{}>['formato']; categoria: string | null; precos: Array<{ volumeMl: number }> }>,
  itens: ItemVendaInput[],
  tapsEnabled: boolean,
) {
  for (const linha of itens) {
    const produto = produtos.find((item) => item.id === linha.produtoId)!;
    const chope = isBebidaChopeOperacao(produto);
    if (chope && !tapsEnabled) {
      throw new VendaInvalidaError('A venda de chope por Tap está desativada nas configurações');
    }
    if (!chope) {
      if (linha.tapId || linha.volumeMl) throw new VendaInvalidaError('Tap e volume sÃ³ podem ser informados para chope');
      continue;
    }
    if (!linha.tapId || !linha.volumeMl) throw new VendaInvalidaError('Selecione o Tap e o volume do chope');
    if (!trailerId && !pontoVendaId) throw new VendaInvalidaError('Este turno nÃ£o possui PDV vinculado para vender chope');

    const montagem = await tx.tapMontagem.findFirst({
      where: {
        sessaoCaixaId,
        tapId: linha.tapId,
        produtoId: produto.id,
        encerradoEm: null,
        tap: {
          ...(canonicalPdvQaActivationEnabled() && pontoVendaId
            ? { pontoVendaId, cervejariaId }
            : { trailerId }),
          ativo: true,
        },
      },
      select: { id: true },
    });
    if (!montagem) throw new VendaInvalidaError('Este chope nÃ£o estÃ¡ montado neste Tap para o turno');
    if (!produto.precos.some((preco) => preco.volumeMl === linha.volumeMl)) {
      throw new VendaInvalidaError('O volume selecionado nÃ£o possui preÃ§o cadastrado para este chope');
    }
  }
}

/**
 * Confere que os produtos sao da empresa e estao ativos, e copia nome e preco
 * para o item. Quantidades repetidas do mesmo produto viram uma linha so.
 */
export async function resolverItens(
  tx: TxClient,
  cervejariaId: string,
  itens: ItemVendaInput[],
  opts?: { sessaoCaixaId?: string; tapsEnabled?: boolean },
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
  const produtos = await tx.produto.findMany({
    where: { id: { in: ids }, cervejariaId, ativo: true },
    select: {
      id: true, nome: true, tipo: true, formato: true, categoria: true, pontoVendaId: true,
      exigePreparo: true, controlaEstoque: true,
      ...(canonicalPdvQaActivationEnabled() ? { prepararEmPedidoSeparado: true } : {}),
      precos: { orderBy: { volumeMl: 'asc' } },
    },
  });

  if (produtos.length !== ids.length) {
    throw new VendaInvalidaError('Produto indisponível no catálogo do operacao');
  }

  if (opts?.sessaoCaixaId) {
    const usaCardapio = await operacaoUsaCardapio(cervejariaId);
    if (usaCardapio) {
      const sessao = await tx.sessaoCaixaOperacao.findUnique({
        where: { id: opts.sessaoCaixaId },
        select: { cardapioId: true, trailerId: true, pontoVendaId: true },
      });
      if (canonicalPdvQaActivationEnabled() && (!sessao?.pontoVendaId || produtos.some((p) => p.pontoVendaId !== sessao.pontoVendaId))) {
        throw new VendaInvalidaError('Produto indisponível neste PDV');
      }
      const precosTemplate = sessao?.cardapioId
        ? await mapPrecosCardapioOperacao(sessao.cardapioId)
        : null;

      const overridesTurno = await tx.sessaoCaixaProdutoOperacao.findMany({
        where: {
          sessaoCaixaId: opts.sessaoCaixaId,
          produtoId: { in: ids },
          precoUnit: { not: null },
        },
        select: { produtoId: true, volumeMl: true, precoUnit: true },
      });
      const precosTurno = new Map(
        overridesTurno.map((r) => [cardapioProdutoVolumeKey(r.produtoId, r.volumeMl), toNumber(r.precoUnit!)]),
      );

      const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));
      for (const linha of itens) {
        const produto = produtoPorId.get(linha.produtoId)!;
        const volumeMenu = isBebidaChopeOperacao(produto) ? linha.volumeMl! : 0;
        const noCardapio = await assertProdutoNoCardapioTurno(opts.sessaoCaixaId, produto.id, volumeMenu);
        if (!noCardapio) {
          throw new VendaInvalidaError('Este item não está no cardápio deste turno');
        }
      }

      await validarChopeDoTurno(tx, opts.sessaoCaixaId, sessao?.trailerId, sessao?.pontoVendaId, cervejariaId, produtos, itens, opts.tapsEnabled ?? false);

      return Promise.all(itens.map(async (linha) => {
        const produto = produtoPorId.get(linha.produtoId)!;
        const chope = isBebidaChopeOperacao(produto);
        const volumeMenu = chope ? linha.volumeMl! : 0;
        const precoKey = cardapioProdutoVolumeKey(produto.id, volumeMenu);
        const precoTurno = precosTurno.get(precoKey);
        const precoTemplate = precosTemplate?.get(precoKey);
        const opcionais = await resolverOpcionais(tx, produto.id, linha.opcionais);
        const precoCatalogo = chope
          ? toNumber(produto.precos.find((preco) => preco.volumeMl === linha.volumeMl)?.preco ?? 0)
          : toNumber(produto.precos[0]?.preco ?? 0);
        const precoBase = precoTurno ?? precoTemplate ?? precoCatalogo;
        return {
          produtoId: produto.id,
          tapId: chope ? linha.tapId! : null,
          volumeMl: chope ? linha.volumeMl! : 0,
          nome: produto.nome,
          precoUnit: precoBase + opcionais.reduce((sum, opcional) => sum + opcional.precoAdicional * opcional.quantidade, 0),
          quantidade: linha.quantidade,
          exigePreparo: chope ? false : produto.exigePreparo,
          prepararEmPedidoSeparado: !chope && produto.exigePreparo && Boolean((produto as typeof produto & { prepararEmPedidoSeparado?: boolean }).prepararEmPedidoSeparado),
          controlaEstoque: produto.controlaEstoque,
          paraViagem: linha.paraViagem ?? false,
          observacao: linha.observacao?.trim() || null,
          opcionais,
        };
      }));
    }
  }

  if (opts?.sessaoCaixaId) {
    const sessao = await tx.sessaoCaixaOperacao.findUnique({
      where: { id: opts.sessaoCaixaId },
      select: { trailerId: true, pontoVendaId: true },
    });
    if (canonicalPdvQaActivationEnabled() && (!sessao?.pontoVendaId || produtos.some((p) => p.pontoVendaId !== sessao.pontoVendaId))) {
      throw new VendaInvalidaError('Produto indisponível neste PDV');
    }
    await validarChopeDoTurno(tx, opts.sessaoCaixaId, sessao?.trailerId, sessao?.pontoVendaId, cervejariaId, produtos, itens, opts.tapsEnabled ?? false);
  }

  const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));
  return Promise.all(itens.map(async (linha) => {
    const produto = produtoPorId.get(linha.produtoId)!;
    const chope = isBebidaChopeOperacao(produto);
    const precoBase = chope
      ? toNumber(produto.precos.find((preco) => preco.volumeMl === linha.volumeMl)?.preco ?? 0)
      : toNumber(produto.precos[0]?.preco ?? 0);
    const opcionais = await resolverOpcionais(tx, produto.id, linha.opcionais);
    return {
      produtoId: produto.id,
      tapId: chope ? linha.tapId! : null,
      volumeMl: chope ? linha.volumeMl! : 0,
      nome: produto.nome,
      precoUnit: precoBase + opcionais.reduce((sum, opcional) => sum + opcional.precoAdicional * opcional.quantidade, 0),
      quantidade: linha.quantidade,
      exigePreparo: chope ? false : produto.exigePreparo,
      prepararEmPedidoSeparado: !chope && produto.exigePreparo && Boolean((produto as typeof produto & { prepararEmPedidoSeparado?: boolean }).prepararEmPedidoSeparado),
      controlaEstoque: produto.controlaEstoque,
      paraViagem: linha.paraViagem ?? false,
      observacao: linha.observacao?.trim() || null,
      opcionais,
    };
  }));
}

export function totalEmCentavos(itens: Array<{ precoUnit: unknown; quantidade: number }>): number {
  return itens.reduce(
    (soma, item) => soma + centavos(item.precoUnit) * item.quantidade,
    0,
  );
}

/**
 * Chave de 64 bits estavel para o advisory lock. Derivada do par empresa+dia,
 * que e exatamente o escopo em que a senha precisa ser unica.
 */
function lockKeyDaSenha(cervejariaId: string, dia: Date): bigint {
  const digest = createHash('sha256')
    .update(`pedido-operacao:${cervejariaId}:${dia.toISOString().slice(0, 10)}`)
    .digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

export async function proximoNumeroPedidoOperacao(tx: TxClient, cervejariaId: string, dia: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKeyDaSenha(cervejariaId, dia)})`;
  const ultimo = await tx.pedidoOperacao.findFirst({
    where: { cervejariaId, diaOperacional: dia },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  return (ultimo?.numero ?? 0) + 1;
}

/**
 * Cria o pedido com a senha do dia. A senha e sequencial por empresa e reinicia
 * a cada dia de operacao. Um advisory lock de transacao serializa a alocacao do
 * numero: sem ele, duas vendas simultaneas leem o mesmo maximo e a segunda viola
 * a unique — e no Postgres esse erro aborta a transacao inteira, entao nao ha
 * como tentar de novo por dentro dela.
 */
export async function criarPedidos(
  tx: TxClient,
  params: {
    cervejariaId: string;
    comandaId: string;
    pontoVendaId: string;
    dia: Date;
    criadoPorId: string;
    paraViagem?: boolean;
    observacao?: string;
    itens: ItemResolvido[];
    temCozinha: boolean;
  },
) {
  const grupos = particionarItensParaPedidos(params.itens, params.temCozinha);
  const pedidos: Array<{ pedido: Awaited<ReturnType<typeof criarPedidoUnico>>; itens: ItemResolvido[] }> = [];
  for (const itens of grupos) {
    pedidos.push({ pedido: await criarPedidoUnico(tx, { ...params, itens }), itens });
  }
  return pedidos;
}

/** Cada linha independente conserva seus opcionais/snapshot e quantidade; as demais linhas de preparo ficam juntas. */
export function particionarItensParaPedidos(itens: ItemResolvido[], temCozinha: boolean): ItemResolvido[][] {
  if (!temCozinha || itens.length <= 1) return itens.length ? [itens] : [];
  const independentes = itens.filter((item) => item.exigePreparo && item.prepararEmPedidoSeparado);
  if (independentes.length === 0) return [itens];
  const independentesSet = new Set(independentes);
  const comuns = itens.filter((item) => !independentesSet.has(item));
  if (independentes.length === 1 && comuns.filter((item) => item.exigePreparo).length === 0) return [itens];
  return [...(comuns.length ? [comuns] : []), ...independentes.map((item) => [item])];
}

async function criarPedidoUnico(
  tx: TxClient,
  params: {
    cervejariaId: string;
    comandaId: string;
    pontoVendaId: string;
    dia: Date;
    criadoPorId: string;
    paraViagem?: boolean;
    observacao?: string;
    itens: ItemResolvido[];
    temCozinha: boolean;
  },
) {
  const numero = await proximoNumeroPedidoOperacao(tx, params.cervejariaId, params.dia);

  const pedido = await tx.pedidoOperacao.create({
    data: {
      cervejariaId: params.cervejariaId,
      comandaId: params.comandaId,
      pontoVendaId: params.pontoVendaId,
      numero,
      diaOperacional: params.dia,
      criadoPorId: params.criadoPorId,
      paraViagem: Boolean(params.paraViagem || params.itens.some((item) => item.paraViagem)),
      observacao: params.observacao,
    },
  });

  const itensCriados = [] as Array<{ id: string }>;
  for (const item of params.itens) {
      const criado = await tx.itemComanda.create({ data: {
      comandaId: params.comandaId,
      produtoId: item.produtoId,
      tapId: item.tapId,
      volumeMl: item.volumeMl,
      quantidade: item.quantidade,
      precoUnit: item.precoUnit,
      nome: item.nome,
      observacao: item.observacao,
      paraViagem: item.paraViagem,
      exigePreparo: itemVaiParaCozinha(params.temCozinha, item.exigePreparo),
      pedidoCozinhaId: pedido.id,
    } });
    itensCriados.push(criado);
  }
  for (const [indice, item] of params.itens.entries()) {
    if (item.opcionais.length === 0) continue;
    const itemCriado = itensCriados[indice];
    if (!itemCriado) continue;
    await tx.itemComandaOpcional.createMany({
      data: item.opcionais.map((opcional) => ({
        itemComandaId: itemCriado.id,
        opcionalId: null,
        opcionalCatalogoId: opcional.opcionalCatalogoId ?? opcional.opcionalId,
        nome: opcional.nome,
        precoAdicional: opcional.precoAdicional,
        quantidade: opcional.quantidade,
      })),
    });
  }

  const pedidoComItens = await tx.pedidoOperacao.findUniqueOrThrow({
    where: { id: pedido.id },
    include: { itensComanda: true },
  });

  await registrarHistoricoStatusPedido(tx, pedido.id, 'RECEBIDO', pedido.createdAt);

  return pedidoComItens;
}

type ComandaCompleta = Prisma.ComandaGetPayload<{
  include: {
    pontoVenda: {
      select: {
        cervejaria: {
          select: {
            configuracaoOperacional: { select: { kitchenItemsChargeAtLaunch: true } };
          };
        };
      };
    };
    evento: {
      select: {
        cervejaria: {
          select: {
            configuracaoOperacional: { select: { kitchenItemsChargeAtLaunch: true } };
          };
        };
      };
    };
    pedidosOperacao: { include: { itensComanda: { include: { opcionais: true; cancelamentosEntregue: true } } } };
    itens: true;
    pagamentos: true;
    contaReceber: { include: { pagamentos: true } };
    cliente: { select: { id: true; nome: true; telefone: true } };
  };
}>;

type LinhaFinanceiraComanda = {
  precoUnit: unknown;
  quantidade: number;
  exigePreparo?: boolean;
  cancelamentoPendenteEm?: unknown;
  canceladoEm?: unknown;
  pedidoCozinhaId?: string | null;
};

/** Regra canônica dos valores da comanda operacional, sempre em centavos. */
export function calcularFinanceiroComanda(params: {
  status: string;
  totalPersistido?: unknown;
  desconto?: unknown;
  kitchenItemsChargeAtLaunch?: boolean;
  itensSemPedido: LinhaFinanceiraComanda[];
  pedidos: Array<{ status: string; itens: LinhaFinanceiraComanda[] }>;
}) {
  const ativos = (item: LinhaFinanceiraComanda) => !item.cancelamentoPendenteEm && !item.canceladoEm;
  const itensConsumidos = [
    ...params.itensSemPedido.filter((item) => !item.pedidoCozinhaId && ativos(item)),
    ...params.pedidos
      .filter((pedido) => {
        if (pedido.status === 'CANCELAMENTO_PENDENTE') return false;
        if (pedido.status !== 'CANCELADO') return true;
        if (pedido.itens.some((item) => item.exigePreparo && item.cancelamentoPendenteEm && !item.canceladoEm)) return false;
        // canceladoEm prevalece sobre uma marca de solicitação antiga que possa
        // ter ficado gravada junto; itens ativos do mesmo ticket continuam devidos.
        const cancelouPreparoIndividualmente = pedido.itens.some((item) =>
          item.exigePreparo && item.canceladoEm,
        );
        const aindaHaItemAtivo = pedido.itens.some(ativos);
        return cancelouPreparoIndividualmente && aindaHaItemAtivo;
      })
      .flatMap((pedido) => pedido.itens.filter((item) =>
        ativos(item) && (!item.exigePreparo || params.kitchenItemsChargeAtLaunch === true || pedido.status === 'ENTREGUE'),
      )),
  ];
  const subtotal = totalEmCentavos(itensConsumidos);
  const valorEmAberto = params.status === 'ABERTA' && params.kitchenItemsChargeAtLaunch !== true
    ? params.pedidos
      .filter((pedido) =>
        !['ENTREGUE', 'CANCELADO', 'CANCELAMENTO_PENDENTE'].includes(pedido.status) &&
        pedido.itens.some((item) => item.exigePreparo),
      )
      .reduce((soma, pedido) => soma + totalEmCentavos(pedido.itens.filter((item) => item.exigePreparo && ativos(item))), 0)
    : 0;
  const desconto = centavos(params.desconto ?? 0);
  const total = params.status === 'ABERTA'
    ? Math.max(0, subtotal - desconto)
    : centavos(params.totalPersistido ?? 0);

  return { subtotal, valorEmAberto, desconto, total };
}

export function subtotalComandaEmCentavos(
  comanda: Pick<ComandaCompleta, 'status' | 'total' | 'desconto' | 'itens' | 'pedidosOperacao'>,
  kitchenItemsChargeAtLaunch = false,
): number {
  return calcularFinanceiroComanda({
    status: comanda.status,
    desconto: comanda.desconto,
    totalPersistido: comanda.total,
    kitchenItemsChargeAtLaunch,
    itensSemPedido: comanda.itens.filter((item) => !item.pedidoCozinhaId),
    pedidos: comanda.pedidosOperacao.map((pedido) => ({ status: pedido.status, itens: pedido.itensComanda })),
  }).subtotal;
}

/**
 * Monta a conta como o operador ve. Total vem persistido na comanda (padrão cervejaria).
 */
export function resumoComanda(comanda: ComandaCompleta, effectiveKitchenItemsChargeAtLaunch?: boolean) {
  const canonicalEnabled = canonicalPdvQaActivationEnabled();
  if (canonicalEnabled && effectiveKitchenItemsChargeAtLaunch === undefined) {
    throw new CanonicalPdvConfigurationError(
      'CANONICAL_PDV_SETTINGS_CONTEXT_REQUIRED',
      'A configuração canônica validada deve acompanhar o resumo da comanda.',
    );
  }
  const kitchenItemsChargeAtLaunch = effectiveKitchenItemsChargeAtLaunch
    ?? comanda.pontoVenda?.cervejaria.configuracaoOperacional?.kitchenItemsChargeAtLaunch
    ?? comanda.evento?.cervejaria.configuracaoOperacional?.kitchenItemsChargeAtLaunch
    ?? false;
  const pedidos = comanda.pedidosOperacao.map((pedido) => ({
    id: pedido.id,
    numero: pedido.numero,
    status: pedido.status,
    clienteAvisadoEm: pedido.clienteAvisadoEm,
    paraViagem: pedido.paraViagem,
    observacao: pedido.observacao,
    createdAt: pedido.createdAt,
    itens: pedido.itensComanda.map((item) => ({
      id: item.id,
      produtoId: item.produtoId ?? '',
      nome: item.nome ?? '',
      precoUnit: toNumber(item.precoUnit),
      quantidade: item.quantidade,
      paraViagem: item.paraViagem,
      cancelamentoPendenteEm: item.cancelamentoPendenteEm,
      canceladoEm: item.canceladoEm,
      cancelamentosEntregue: item.cancelamentosEntregue?.map((cancelamento) => ({
        id: cancelamento.id,
        quantidade: cancelamento.quantidade,
        valorRetirado: toNumber(cancelamento.valorRetirado),
        motivo: cancelamento.motivo,
        tratamentoEstoque: cancelamento.tratamentoEstoque,
        createdAt: cancelamento.createdAt,
      })),
      observacao: item.observacao,
      opcionais: item.opcionais.map((opcional) => ({
        id: opcional.id,
        nome: opcional.nome,
        precoAdicional: toNumber(opcional.precoAdicional),
        quantidade: opcional.quantidade,
      })),
      subtotal: reais(centavos(item.precoUnit) * item.quantidade),
      exigePreparo: item.exigePreparo,
    })),
  }));

  const financeiro = calcularFinanceiroComanda({
    status: comanda.status,
    totalPersistido: comanda.total,
    desconto: comanda.desconto,
    kitchenItemsChargeAtLaunch,
    itensSemPedido: comanda.itens.filter((item) => !item.pedidoCozinhaId),
    pedidos: comanda.pedidosOperacao.map((pedido) => ({ status: pedido.status, itens: pedido.itensComanda })),
  });

  return {
    id: comanda.id,
    tipo: comanda.tipo,
    identificador: comanda.identificador,
    numero: comanda.numero,
    cliente: comanda.cliente,
    status: comanda.status,
    pontoVendaId: comanda.pontoVendaId,
    ocorrenciaId: comanda.ocorrenciaId ?? null,
    createdAt: comanda.createdAt,
    fechadaEm: comanda.fechadaEm,
    subtotal: reais(financeiro.subtotal),
    desconto: reais(financeiro.desconto),
    total: reais(financeiro.total),
    valorEmAberto: reais(financeiro.valorEmAberto),
    pedidos,
    pagamentos: comanda.pagamentos.map((pagamento) => ({
      id: pagamento.id,
      forma: pagamento.forma,
      valor: toNumber(pagamento.valor),
      valorRecebido: pagamento.valorRecebido === null ? null : toNumber(pagamento.valorRecebido),
      troco: pagamento.troco === null ? null : toNumber(pagamento.troco),
      pagoEm: pagamento.pagoEm,
    })),
    contaPendente: comanda.contaReceber
      ? {
          id: comanda.contaReceber.id,
          valorOriginal: toNumber(comanda.contaReceber.valorOriginal),
          recebido: comanda.contaReceber.pagamentos.reduce((sum, pagamento) => sum + toNumber(pagamento.valor), 0),
          saldo: Math.max(0, toNumber(comanda.contaReceber.valorOriginal) - comanda.contaReceber.pagamentos.reduce((sum, pagamento) => sum + toNumber(pagamento.valor), 0)),
        }
      : null,
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
  if (pagamentos.length === 0) {
    if (devidoEmCentavos === 0) return [];
    throw new VendaInvalidaError('Informe como o cliente pagou');
  }

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
