import type { PlanningRecord } from './pdv-unico-migration-planner.js';
import type { Prisma } from '@prisma/client';

type SourceRow = Record<string, any>;
export interface PdvPlanningGraphInput {
  companyId: string;
  pdvs: SourceRow[]; trailers: SourceRow[]; clients: SourceRow[]; customerStatistics: SourceRow[];
  products: SourceRow[]; menus: SourceRow[]; optionals: SourceRow[]; events: SourceRow[];
  portalOrders: SourceRow[]; transactionLogs: SourceRow[]; eventExclusions: SourceRow[]; eventProducts: SourceRow[];
  taps: SourceRow[]; eventSessions: SourceRow[]; operationalSessions: SourceRow[]; commands: SourceRow[];
  orders: SourceRow[]; payments: SourceRow[]; receivables: SourceRow[]; tapSetups: SourceRow[];
  balances: SourceRow[]; stockMovements: SourceRow[];
  operationalConfig: SourceRow | null; moduleConfig: SourceRow | null;
}
export interface PdvPlanningGraph {
  records: PlanningRecord[];
  paymentLinkConflicts: Array<{ id:string; commandId:string; operationalSessionId:string|null; eventSessionId:string|null; issue:string }>;
  effectiveConfiguration: {
    operationMode: 'CAIXA' | 'EVENTO'; operationModeSource: string;
    inventoryEnabled: boolean; inventorySource: string;
    kitchenEnabled: boolean; kitchenSource: string;
  };
}

/** Reads the source rows used by both the DEV inventory and the isolated graph test. The caller owns the transaction and its isolation/read-only policy. No client is instantiated on import. */
export async function readPdvPlanningSourceSnapshot(tx: Prisma.TransactionClient, companyId: string) {
  const hasField = (model: string, name: string) => (tx as any)?._runtimeDataModel?.models?.[model]?.fields?.some((field: any) => field.name === name) ?? false;
  const comandaHasOccurrence = hasField('Comanda', 'ocorrenciaId');
  const productHasPoint = hasField('Produto', 'pontoVendaId');
  const optionalHasPoint = hasField('Opcional', 'pontoVendaId');
  const commandScope = { OR: [{ evento: { cervejariaId: companyId } }, { pontoVenda: { cervejariaId: companyId } }] };
  const [pdvs, trailers, events, commands, operationalConfig, moduleConfig, eventSessions, operationalSessions, receivables, balances, stockMovements, orders, tapSetups, products, menus, taps, optionals, clients, customerCount] = await Promise.all([
    tx.pontoVenda.findMany({ where: { cervejariaId: companyId }, select: { id: true }, orderBy: { id: 'asc' } }),
    tx.trailer.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, nome: true, identificador: true, ativo: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    tx.evento.findMany({ where: { cervejariaId: companyId }, select: { id: true, nome: true, local: true, data: true, horaInicio: true, horaFim: true, recorrencia: true, diaSemana: true, serieId: true, status: true, encerradoEm: true, comandasContadorDesde: true, portalGeneration: true, cervejariaId: true, trailerId: true, cardapioId: true, createdAt: true, updatedAt: true, trailer: { select: { cervejariaId: true } }, cardapio: { select: { cervejariaId: true } }, serie: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
    tx.comanda.findMany({ where: commandScope, select: { id: true, origem: true, status: true, tipo: true, numero: true, total: true, desconto: true, eventoId: true, clienteId: true, pontoVendaId: true, ...(comandaHasOccurrence ? { ocorrenciaId: true } : {}), diaOperacional: true, identificador: true, abertaPorId: true, fechadoPorId: true, fechadaEm: true, createdAt: true, updatedAt: true, evento: { select: { cervejariaId: true, data: true } }, pontoVenda: { select: { cervejariaId: true } }, cliente: { select: { cervejariaId: true } }, itens: { select: { id: true, produtoId: true, tapId: true, volumeMl: true, quantidade: true, precoUnit: true, nome: true, observacao: true, exigePreparo: true, paraViagem: true, cancelamentoPendenteEm: true, canceladoEm: true, pedidoCozinhaId: true, createdAt: true, produto: { select: { cervejariaId: true, ...(productHasPoint ? { pontoVendaId: true } : {}) } }, opcionais: { select: { id: true, opcionalId: true, opcionalCatalogoId: true, nome: true, precoAdicional: true, quantidade: true, opcional: { select: { grupo: { select: { produto: { select: { cervejariaId: true, ...(productHasPoint ? { pontoVendaId: true } : {}) } } } }, produtoEstoque: { select: { cervejariaId: true, ...(productHasPoint ? { pontoVendaId: true } : {}) } } } }, opcionalCatalogo: { select: { cervejariaId: true, ...(optionalHasPoint ? { pontoVendaId: true } : {}) } } } } } }, _count: { select: { pagamentos: true, pedidosOperacao: true } } }, orderBy: { id: 'asc' } }),
    tx.configuracaoOperacional.findUnique({ where: { cervejariaId: companyId }, select: { directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true } }),
    tx.configuracaoOperacao.findUnique({ where: { cervejariaId: companyId }, select: { ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: true, quantidadeMesas: true } }),
    tx.sessaoCaixaEvento.findMany({ where: { evento: { cervejariaId: companyId } }, select: { id: true, eventoId: true, status: true, trocoInicial: true, abertoPorId: true, abertoEm: true, fechadoPorId: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true, contadoDebito: true, contadoCredito: true, contadoCartao: true, observacaoFechamento: true, evento: { select: { cervejariaId: true } }, movimentos: { select: { id: true, tipo: true, valor: true, observacao: true, registradoPorId: true, createdAt: true } } }, orderBy: { id: 'asc' } }),
    tx.sessaoCaixaOperacao.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, pontoVendaId: true, trailerId: true, pontoVenda: { select: { cervejariaId: true } }, trailer: { select: { cervejariaId: true } }, status: true, diaOperacional: true, trocoInicial: true, abertoPorId: true, abertoEm: true, fechadoPorId: true, fechadoEm: true, contadoDinheiro: true, contadoPix: true, contadoCartaoDebito: true, contadoCartaoCredito: true, observacaoFechamento: true, cardapioId: true, cardapio: { select: { cervejariaId: true } }, produtos: { select: { id: true, produtoId: true, volumeMl: true, precoUnit: true, createdAt: true, produto: { select: { cervejariaId: true } } } }, movimentos: { select: { id: true, tipo: true, valor: true, observacao: true, registradoPorId: true, correcaoDeId: true, naturezaCorrecao: true, motivoCorrecao: true, autorizadoPorId: true, solicitadoPorId: true, corrigidoEm: true, createdAt: true } } }, orderBy: { id: 'asc' } }),
    tx.contaReceber.findMany({ where: { comanda: commandScope }, select: { id: true, comandaId: true, clienteId: true, valorOriginal: true, criadoPorId: true, createdAt: true, cliente: { select: { cervejariaId: true } }, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true, clienteId: true } }, pagamentos: { select: { id: true, comandaId: true, contaReceberId: true, valor: true, forma: true, pagoEm: true, sessaoCaixaId: true, sessaoCaixaEventoId: true } } }, orderBy: { id: 'asc' } }),
    tx.inventoryBalance.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, pontoVendaId: true, produtoId: true, quantidade: true, estoqueMinimo: true, updatedAt: true, pontoVenda: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true, formato: true } } }, orderBy: { id: 'asc' } }),
    tx.inventoryMovement.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, pontoVendaId: true, produtoId: true, tipo: true, quantidade: true, observacao: true, registradoPorId: true, pedidoId: true, createdAt: true, pontoVenda: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true, formato: true } } }, orderBy: { id: 'asc' } }),
    tx.pedidoOperacao.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, status: true, comandaId: true, pontoVendaId: true, numero: true, diaOperacional: true, paraViagem: true, observacao: true, criadoPorId: true, statusDesde: true, entregueEm: true, clienteAvisadoEm: true, createdAt: true, updatedAt: true, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true, evento: { select: { cervejariaId: true } }, pontoVenda: { select: { cervejariaId: true } } } }, pontoVenda: { select: { cervejariaId: true } }, itensComanda: { select: { id: true, comandaId: true, produtoId: true, tapId: true, volumeMl: true, quantidade: true, precoUnit: true, nome: true, observacao: true, exigePreparo: true, paraViagem: true, cancelamentoPendenteEm: true, canceladoEm: true, pedidoCozinhaId: true, createdAt: true, produto: { select: { cervejariaId: true, ...(productHasPoint ? { pontoVendaId: true } : {}) } }, opcionais: { select: { id: true, opcionalId: true, opcionalCatalogoId: true, nome: true, precoAdicional: true, quantidade: true, opcional: { select: { grupo: { select: { produto: { select: { cervejariaId: true, ...(productHasPoint ? { pontoVendaId: true } : {}) } } } }, produtoEstoque: { select: { cervejariaId: true, ...(productHasPoint ? { pontoVendaId: true } : {}) } } } }, opcionalCatalogo: { select: { cervejariaId: true, ...(optionalHasPoint ? { pontoVendaId: true } : {}) } } } } } }, historicoStatus: { select: { id: true, status: true, registradoEm: true } } }, orderBy: { id: 'asc' } }),
    tx.tapMontagem.findMany({ where: { OR: [{ evento: { cervejariaId: companyId } }, { sessaoCaixa: { cervejariaId: companyId } }] }, select: { id: true, eventoId: true, sessaoCaixaId: true, tapId: true, produtoId: true, iniciadoEm: true, encerradoEm: true, evento: { select: { cervejariaId: true } }, sessaoCaixa: { select: { cervejariaId: true } }, tap: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
    tx.produto.findMany({ where: { cervejariaId: companyId }, select: { id: true, tipo: true, formato: true, categoria: true, ativo: true, controlaEstoque: true, exigePreparo: true, precos: { select: { id: true, volumeMl: true, preco: true } , orderBy: { volumeMl: 'asc' } }, gruposOpcionais: { select: { id: true, obrigatorio: true, maximo: true, ordem: true, ativo: true, opcoes: { select: { id: true, ativo: true, precoAdicional: true, produtoEstoqueId: true, produtoEstoque: { select: { cervejariaId: true } } } } }, orderBy: { ordem: 'asc' } } }, orderBy: { id: 'asc' } }),
    tx.cardapio.findMany({ where: { cervejariaId: companyId }, select: { id: true, ativo: true, chopeVolumesConfigurados: true, produtos: { select: { id: true, produtoId: true, volumeMl: true, precoUnit: true, produto: { select: { cervejariaId: true } } }, orderBy: [{ produtoId: 'asc' }, { volumeMl: 'asc' }] } }, orderBy: { id: 'asc' } }),
    tx.tap.findMany({ where: { cervejariaId: companyId }, select: { id: true, trailerId: true, numero: true, produtoId: true, ativo: true, trailer: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
    tx.opcional.findMany({ where: { cervejariaId: companyId }, select: { id: true, ativo: true, preco: true, produtos: { select: { id: true, produtoId: true, ordem: true } } }, orderBy: { id: 'asc' } }),
    tx.cliente.findMany({ where: { cervejariaId: companyId }, select: { id: true, cervejariaId: true, nome: true, telefone: true, email: true, dataNascimento: true, optInMarketing: true, optInEm: true, cadastradoVia: true, observacoes: true, ativo: true, isSistema: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    tx.cliente.count({ where: { cervejariaId: companyId } }),
  ]);
  const [eventExclusions, eventProducts] = await Promise.all([
    tx.eventoSerieExclusao.findMany({ where: { serie: { cervejariaId: companyId } }, select: { id: true, serieId: true, data: true, cervejariaId: true, createdAt: true }, orderBy: { id: 'asc' } }),
    tx.eventoProduto.findMany({ where: { evento: { cervejariaId: companyId } }, select: { id: true, eventoId: true, produtoId: true, createdAt: true, evento: { select: { cervejariaId: true } }, produto: { select: { cervejariaId: true } } }, orderBy: { id: 'asc' } }),
  ]);
  const [portalOrders, customerStatistics, transactionLogs] = await Promise.all([
    tx.pedidoCliente.findMany({ where: { evento: { cervejariaId: companyId } }, select: {
      id: true, eventoId: true, comandaId: true, clienteId: true, status: true, observacao: true,
      recusadoMotivo: true, confirmadoPorId: true, confirmadoEm: true, createdAt: true, updatedAt: true,
      evento: { select: { cervejariaId: true } }, comanda: { select: { origem: true, eventoId: true, pontoVendaId: true, clienteId: true } },
      cliente: { select: { cervejariaId: true } },
      itens: { select: { id: true, pedidoId: true, produtoId: true, tapId: true, volumeMl: true, quantidade: true, precoUnit: true, produto: { select: { cervejariaId: true } } } },
    }, orderBy: { id: 'asc' } }),
    tx.clienteEstatisticas.findMany({ where: { cliente: { cervejariaId: companyId } }, select: { clienteId: true, totalComandasFechadas: true, totalGasto: true, totalMlChope: true, primeiraVisitaEm: true, ultimaVisitaEm: true, updatedAt: true }, orderBy: { clienteId: 'asc' } }),
    tx.transacaoLog.findMany({ where: { cervejariaId: companyId }, select: { id: true, tipo: true, usuarioId: true, eventoId: true, comandaId: true, entidadeTipo: true, entidadeId: true, metadata: true, createdAt: true }, orderBy: { id: 'asc' } }),
  ]);
  const payments = await tx.pagamento.findMany({ where: { comanda: commandScope }, select: { id: true, comandaId: true, forma: true, valor: true, valorRecebido: true, troco: true, registradoPorId: true, pagoEm: true, contaReceberId: true, sessaoCaixaId: true, sessaoCaixaEventoId: true, comanda: { select: { origem: true } } }, orderBy: { id: 'asc' } });
  return { companyId, pdvs, trailers, events, commands, operationalConfig, moduleConfig, eventSessions, operationalSessions, receivables, balances, stockMovements, orders, tapSetups, products, menus, taps, optionals, clients, customerCount, eventExclusions, eventProducts, portalOrders, customerStatistics, transactionLogs, payments };
}

/** Pure, shared source graph construction. No Prisma client or connection is created on import. */
export function buildPdvPlanningGraph(input: PdvPlanningGraphInput): PdvPlanningGraph {
  const { companyId, pdvs, trailers, operationalConfig, moduleConfig, clients, customerStatistics, products, menus, optionals, events, portalOrders, transactionLogs, eventExclusions, eventProducts, taps, eventSessions, operationalSessions, commands, orders, payments, receivables, tapSetups, balances, stockMovements } = input;
  const operationalSessionIds = new Set((operationalSessions ?? []).map((s:any)=>s.id));
  const eventSessionIds = new Set((eventSessions ?? []).map((s:any)=>s.id));
  const paymentLinkConflicts = (payments ?? []).filter((p:any)=>Boolean(p.sessaoCaixaId && p.sessaoCaixaEventoId) || Boolean(p.sessaoCaixaId && !operationalSessionIds.has(p.sessaoCaixaId)) || Boolean(p.sessaoCaixaEventoId && !eventSessionIds.has(p.sessaoCaixaEventoId))).map((p:any)=>({ id:p.id, commandId:p.comandaId, operationalSessionId:p.sessaoCaixaId, eventSessionId:p.sessaoCaixaEventoId, issue:p.sessaoCaixaId && p.sessaoCaixaEventoId ? 'both-session-links' : p.sessaoCaixaId && !operationalSessionIds.has(p.sessaoCaixaId) ? 'missing-or-cross-tenant-operational-session' : 'missing-or-cross-tenant-event-session' }));
  const effectiveConfiguration = {
    operationMode: operationalConfig?.plannedOperationsEnabled === true ? 'EVENTO' as const : 'CAIXA' as const,
    operationModeSource: operationalConfig?.plannedOperationsEnabled == null ? 'PROFILE_DEFAULT_CAIXA_WITH_LEGACY_FALLBACK_SIGNAL' : 'CONFIGURACAO_OPERACIONAL.plannedOperationsEnabled',
    inventoryEnabled: operationalConfig?.inventoryEnabled ?? Boolean(moduleConfig?.ativo && moduleConfig?.controlaEstoque),
    inventorySource: operationalConfig?.inventoryEnabled == null ? 'LEGACY_CONFIGURACAO_OPERACAO_FALLBACK' : 'CONFIGURACAO_OPERACIONAL.inventoryEnabled',
    kitchenEnabled: operationalConfig?.kitchenEnabled ?? Boolean(moduleConfig?.ativo && moduleConfig?.temCozinha),
    kitchenSource: operationalConfig?.kitchenEnabled == null ? 'LEGACY_CONFIGURACAO_OPERACAO_FALLBACK' : 'CONFIGURACAO_OPERACIONAL.kitchenEnabled',
  };
  const records: PlanningRecord[] = [];
  const add = (type: PlanningRecord['type'], id: string, parents: PlanningRecord['parents'] = [], options: Omit<PlanningRecord, 'type' | 'id' | 'tenantId' | 'parents'> & { tenantId?: string } = {}) => {
    records.push({ type, id, tenantId: options.tenantId ?? companyId, parents, ...options });
  };
  for (const pdv of pdvs) add('PDV', pdv.id);
  for (const trailer of trailers) add('TRAILER', trailer.id);
  if (operationalConfig) add('CONFIG_OPERACIONAL', companyId);
  if (moduleConfig) add('CONFIG_OPERACAO', companyId);
  for (const client of clients) add('CLIENTE', client.id, [], { tenantId: client.cervejariaId });
  for (const statistics of customerStatistics) add('CLIENTE_ESTATISTICA', statistics.clienteId, [{ type: 'CLIENTE', id: statistics.clienteId, relation: 'clienteId' }], { sourceLinks: { clienteId: statistics.clienteId }, requiredLinks: ['clienteId'] });
  for (const product of products) {
    add('PRODUTO', product.id, [], { tenantId: companyId });
    for (const price of product.precos) add('PRECO', price.id, [{ type: 'PRODUTO', id: product.id, relation: 'produtoId' }]);
    for (const group of product.gruposOpcionais) {
      add('GRUPO_OPCIONAL', group.id, [{ type: 'PRODUTO', id: product.id, relation: 'produtoId' }]);
      for (const option of group.opcoes) add('OPCAO_PRODUTO', option.id, [{ type: 'GRUPO_OPCIONAL', id: group.id, relation: 'grupoId' }, ...(option.produtoEstoqueId ? [{ type: 'PRODUTO' as const, id: option.produtoEstoqueId, relation: 'produtoEstoqueId', tenantId: option.produtoEstoque?.cervejariaId }] : [])]);
    }
  }
  for (const menu of menus) {
    add('CARDAPIO', menu.id);
    for (const item of menu.produtos) add('CARDAPIO_PRODUTO', item.id, [{ type: 'CARDAPIO', id: menu.id, relation: 'cardapioId' }, { type: 'PRODUTO', id: item.produtoId, relation: 'produtoId', tenantId: item.produto.cervejariaId }]);
  }
  for (const optional of optionals) add('OPCIONAL_CATALOGO', optional.id);
  for (const optional of optionals) for (const link of optional.produtos) add('OPCIONAL_VINCULO', link.id, [{ type: 'OPCIONAL_CATALOGO', id: optional.id, relation: 'opcionalId' }, { type: 'PRODUTO', id: link.produtoId, relation: 'produtoId' }]);
  for (const event of events) {
    const parents: NonNullable<PlanningRecord['parents']> = [{ type: 'TRAILER', id: event.trailerId, relation: 'trailerId', tenantId: event.trailer.cervejariaId }];
    if (event.cardapioId) parents.push({ type: 'CARDAPIO', id: event.cardapioId, relation: 'cardapioId', tenantId: event.cardapio?.cervejariaId });
    if (event.serieId) parents.push({ type: 'EVENTO', id: event.serieId, relation: 'serieId', tenantId: event.serie?.cervejariaId });
    add('EVENTO', event.id, parents, { sourceLinks: { trailerId: event.trailerId, cardapioId: event.cardapioId, serieId: event.serieId }, pdvFrom: { type: 'TRAILER', id: event.trailerId, relation: 'trailerId' }, eventRole: event.serieId ? 'OCORRENCIA' : event.recorrencia === 'SEMANAL' ? 'AGENDA' : 'OCORRENCIA' });
  }
  for (const request of portalOrders) add('PEDIDO_CLIENTE', request.id, [
    { type: 'EVENTO', id: request.eventoId, relation: 'eventoId', tenantId: request.evento.cervejariaId },
    { type: 'COMANDA', id: request.comandaId, relation: 'comandaId' },
    { type: 'CLIENTE', id: request.clienteId, relation: 'clienteId', tenantId: request.cliente.cervejariaId },
  ], { sourceLinks: { eventoId: request.eventoId, comandaId: request.comandaId, clienteId: request.clienteId }, requiredLinks: ['eventoId', 'comandaId', 'clienteId'], pdvFrom: { type: 'EVENTO', id: request.eventoId, relation: 'eventoId' } });
  for (const request of portalOrders) for (const item of request.itens) add('PEDIDO_CLIENTE_ITEM', item.id, [
    { type: 'PEDIDO_CLIENTE', id: request.id, relation: 'pedidoId' },
    { type: 'PRODUTO', id: item.produtoId, relation: 'produtoId', tenantId: item.produto.cervejariaId },
  ], { sourceLinks: { pedidoId: request.id, produtoId: item.produtoId }, requiredLinks: ['pedidoId', 'produtoId'], pdvFrom: { type: 'PEDIDO_CLIENTE', id: request.id, relation: 'pedidoId' } });
  for (const log of transactionLogs) {
    const parents: NonNullable<PlanningRecord['parents']> = [];
    if (log.eventoId) parents.push({ type: 'EVENTO', id: log.eventoId, relation: 'eventoId' });
    if (log.comandaId) parents.push({ type: 'COMANDA', id: log.comandaId, relation: 'comandaId' });
    const sourceLinks = { eventoId: log.eventoId, comandaId: log.comandaId };
    const pdvFrom = log.eventoId ? { type: 'EVENTO' as const, id: log.eventoId, relation: 'eventoId' }
      : log.comandaId ? { type: 'COMANDA' as const, id: log.comandaId, relation: 'comandaId' } : undefined;
    add('TRANSACAO_LOG', log.id, parents, { sourceLinks, pdvFrom, historicalAudit: { entityType: log.entidadeTipo, entityId: log.entidadeId, metadata: log.metadata } });
  }
  for (const exclusion of eventExclusions) add('AGENDA_EXCECAO', exclusion.id, [{ type: 'EVENTO', id: exclusion.serieId, relation: 'serieId', tenantId: exclusion.cervejariaId }], { sourceLinks: { serieId: exclusion.serieId } });
  for (const item of eventProducts) add('EVENTO_PRODUTO', item.id, [{ type: 'EVENTO', id: item.eventoId, relation: 'eventoId', tenantId: item.evento.cervejariaId }, { type: 'PRODUTO', id: item.produtoId, relation: 'produtoId', tenantId: item.produto.cervejariaId }], { sourceLinks: { eventoId: item.eventoId, produtoId: item.produtoId } });
  for (const tap of taps) add('TAP', tap.id, [{ type: 'TRAILER', id: tap.trailerId, relation: 'trailerId', tenantId: tap.trailer.cervejariaId }, ...(tap.produtoId ? [{ type: 'PRODUTO' as const, id: tap.produtoId, relation: 'produtoId' }] : [])], { sourceLinks: { trailerId: tap.trailerId, produtoId: tap.produtoId } });
  for (const session of eventSessions) add('SESSAO_EVENTO', session.id, [{ type: 'EVENTO', id: session.eventoId, relation: 'eventoId', tenantId: session.evento.cervejariaId }], { sourceLinks: { eventoId: session.eventoId }, requiredLinks: ['eventoId'], pdvFrom: { type: 'EVENTO', id: session.eventoId, relation: 'eventoId' }, historicalOrigin: 'EVENTO' });
  for (const session of operationalSessions) add('SESSAO_CAIXA', session.id, [
    { type: 'PDV', id: session.pontoVendaId, relation: 'pontoVendaId', tenantId: session.pontoVenda.cervejariaId },
    ...(session.trailerId ? [{ type: 'TRAILER' as const, id: session.trailerId, relation: 'trailerId', tenantId: session.trailer?.cervejariaId }] : []),
    ...(session.cardapioId ? [{ type: 'CARDAPIO' as const, id: session.cardapioId, relation: 'cardapioId', tenantId: session.cardapio?.cervejariaId }] : []),
  ], { sourceLinks: { pontoVendaId: session.pontoVendaId, trailerId: session.trailerId, cardapioId: session.cardapioId }, requiredLinks: ['pontoVendaId'], pdvFrom: { type: 'PDV', id: session.pontoVendaId, relation: 'pontoVendaId' } });
  for (const command of commands) {
    const parents: NonNullable<PlanningRecord['parents']> = [];
    if (command.eventoId) parents.push({ type: 'EVENTO', id: command.eventoId, relation: 'eventoId', tenantId: command.evento?.cervejariaId });
    if (command.pontoVendaId) parents.push({ type: 'PDV', id: command.pontoVendaId, relation: 'pontoVendaId', tenantId: command.pontoVenda?.cervejariaId });
    if (command.clienteId) parents.push({ type: 'CLIENTE', id: command.clienteId, relation: 'clienteId', tenantId: command.cliente?.cervejariaId });
    const pdvParent = command.origem === 'EVENTO' && command.eventoId
      ? { type: 'EVENTO' as const, id: command.eventoId, relation: 'eventoId' }
      : command.pontoVendaId ? { type: 'PDV' as const, id: command.pontoVendaId, relation: 'pontoVendaId' } : undefined;
    const blocker = command.origem === 'EVENTO' && !command.eventoId || ['CAIXA', 'QUIOSQUE'].includes(command.origem) && !command.pontoVendaId
      ? { code: 'REQUIRED_ORIGIN_LINK_MISSING', category: 'CONFLITO_DADOS' as const, evidence: `Origem ${command.origem} sem seu vínculo obrigatório na fotografia.` }
      : !['EVENTO', 'CAIXA', 'QUIOSQUE'].includes(command.origem)
        ? { code: 'UNKNOWN_COMMAND_ORIGIN', category: 'INFORMACAO_INSUFICIENTE' as const, evidence: `Origem ${command.origem} ainda não tem regra explícita no planejador.` }
        : undefined;
    const requiredLinks = command.origem === 'EVENTO' ? ['eventoId'] : ['CAIXA', 'QUIOSQUE'].includes(command.origem) ? ['pontoVendaId'] : [];
    add('COMANDA', command.id, parents, { sourceLinks: { eventoId: command.eventoId, pontoVendaId: command.pontoVendaId, clienteId: command.clienteId }, requiredLinks, pdvFrom: pdvParent, pdvConstraints: command.eventoId && command.pontoVendaId ? [{ type: 'PDV', id: command.pontoVendaId, relation: 'pontoVendaId' }] : [], blocker, historicalOrigin: command.origem });
    for (const item of command.itens) {
      const itemParents: NonNullable<PlanningRecord['parents']> = [{ type: 'COMANDA', id: command.id, relation: 'comandaId' }];
      if (item.produtoId) itemParents.push({ type: 'PRODUTO', id: item.produtoId, relation: 'produtoId' });
      if (item.tapId) itemParents.push({ type: 'TAP', id: item.tapId, relation: 'tapId' });
      if (item.pedidoCozinhaId) itemParents.push({ type: 'PEDIDO', id: item.pedidoCozinhaId, relation: 'pedidoCozinhaId' });
      add('ITEM_COMANDA', item.id, itemParents, { sourceLinks: { comandaId: command.id, produtoId: item.produtoId, tapId: item.tapId, pedidoCozinhaId: item.pedidoCozinhaId }, pdvFrom: pdvParent });
      for (const optional of item.opcionais) add('ITEM_OPCIONAL', optional.id, [
        { type: 'ITEM_COMANDA', id: item.id, relation: 'itemComandaId' },
        ...(optional.opcionalId ? [{ type: 'OPCAO_PRODUTO' as const, id: optional.opcionalId, relation: 'opcionalId' }] : []),
        ...(optional.opcionalCatalogoId ? [{ type: 'OPCIONAL_CATALOGO' as const, id: optional.opcionalCatalogoId, relation: 'opcionalCatalogoId' }] : []),
      ], { sourceLinks: { itemComandaId: item.id, opcionalId: optional.opcionalId, opcionalCatalogoId: optional.opcionalCatalogoId }, pdvFrom: pdvParent });
    }
  }
  for (const session of eventSessions) for (const movement of session.movimentos) add('MOVIMENTO_EVENTO', movement.id, [{ type: 'SESSAO_EVENTO', id: session.id, relation: 'sessaoId' }], { sourceLinks: { sessaoId: session.id } });
  for (const session of operationalSessions) {
    for (const product of session.produtos) add('SESSAO_PRODUTO', product.id, [{ type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoCaixaId' }, { type: 'PRODUTO', id: product.produtoId, relation: 'produtoId', tenantId: product.produto.cervejariaId }], { sourceLinks: { sessaoCaixaId: session.id, produtoId: product.produtoId }, pdvFrom: { type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoCaixaId' } });
    for (const movement of session.movimentos) add('MOVIMENTO_CAIXA', movement.id, [{ type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoId' }, ...(movement.correcaoDeId ? [{ type: 'MOVIMENTO_CAIXA' as const, id: movement.correcaoDeId, relation: 'correcaoDeId' }] : [])], { sourceLinks: { sessaoId: session.id, correcaoDeId: movement.correcaoDeId }, pdvFrom: { type: 'SESSAO_CAIXA', id: session.id, relation: 'sessaoId' } });
  }
  for (const order of orders) {
    const orderParents: NonNullable<PlanningRecord['parents']> = [{ type: 'COMANDA', id: order.comandaId, relation: 'comandaId' }];
    if (order.pontoVendaId) orderParents.push({ type: 'PDV', id: order.pontoVendaId, relation: 'pontoVendaId', tenantId: order.pontoVenda?.cervejariaId });
    add('PEDIDO', order.id, orderParents, { sourceLinks: { comandaId: order.comandaId, pontoVendaId: order.pontoVendaId }, pdvFrom: { type: 'COMANDA', id: order.comandaId, relation: 'comandaId' }, pdvConstraints: order.pontoVendaId ? [{ type: 'PDV', id: order.pontoVendaId, relation: 'pontoVendaId' }] : [] });
    for (const item of order.itensComanda) add('PEDIDO_ITEM_LINK', item.id, [{ type: 'PEDIDO', id: order.id, relation: 'pedidoId' }, { type: 'ITEM_COMANDA', id: item.id, relation: 'itemComandaId' }]);
    for (const history of order.historicoStatus) add('PEDIDO_HISTORICO', history.id, [{ type: 'PEDIDO', id: order.id, relation: 'pedidoId' }]);
  }
  for (const payment of payments) {
    const parents: NonNullable<PlanningRecord['parents']> = [{ type: 'COMANDA', id: payment.comandaId, relation: 'comandaId' }];
    if (payment.contaReceberId) parents.push({ type: 'CONTA_RECEBER', id: payment.contaReceberId, relation: 'contaReceberId' });
    if (payment.sessaoCaixaId) parents.push({ type: 'SESSAO_CAIXA', id: payment.sessaoCaixaId, relation: 'sessaoCaixaId' });
    if (payment.sessaoCaixaEventoId) parents.push({ type: 'SESSAO_EVENTO', id: payment.sessaoCaixaEventoId, relation: 'sessaoCaixaEventoId' });
    const doubleSession = payment.sessaoCaixaId && payment.sessaoCaixaEventoId;
    add('PAGAMENTO', payment.id, parents, { sourceLinks: { comandaId: payment.comandaId, contaReceberId: payment.contaReceberId, sessaoCaixaId: payment.sessaoCaixaId, sessaoCaixaEventoId: payment.sessaoCaixaEventoId }, requiredLinks: ['comandaId'], pdvFrom: { type: 'COMANDA', id: payment.comandaId, relation: 'comandaId' }, blocker: doubleSession ? { code: 'PAYMENT_SESSION_LINK_CONFLICT', category: 'CONFLITO_DADOS', evidence: 'O mesmo pagamento referencia simultaneamente sessão operacional e sessão de evento.' } : undefined });
  }
  for (const account of receivables) add('CONTA_RECEBER', account.id, [{ type: 'COMANDA', id: account.comandaId, relation: 'comandaId' }, { type: 'CLIENTE', id: account.clienteId, relation: 'clienteId', tenantId: account.cliente.cervejariaId }], { sourceLinks: { comandaId: account.comandaId, clienteId: account.clienteId }, requiredLinks: ['comandaId', 'clienteId'], pdvFrom: { type: 'COMANDA', id: account.comandaId, relation: 'comandaId' } });
  for (const setup of tapSetups) add('TAP_MONTAGEM', setup.id, [
    ...(setup.eventoId ? [{ type: 'EVENTO' as const, id: setup.eventoId, relation: 'eventoId', tenantId: setup.evento?.cervejariaId }] : []),
    ...(setup.sessaoCaixaId ? [{ type: 'SESSAO_CAIXA' as const, id: setup.sessaoCaixaId, relation: 'sessaoCaixaId', tenantId: setup.sessaoCaixa?.cervejariaId }] : []),
    { type: 'TAP', id: setup.tapId, relation: 'tapId', tenantId: setup.tap.cervejariaId }, { type: 'PRODUTO', id: setup.produtoId, relation: 'produtoId', tenantId: setup.produto.cervejariaId },
  ], { sourceLinks: { eventoId: setup.eventoId, sessaoCaixaId: setup.sessaoCaixaId, tapId: setup.tapId, produtoId: setup.produtoId }, pdvFrom: setup.eventoId ? { type: 'EVENTO', id: setup.eventoId, relation: 'eventoId' } : setup.sessaoCaixaId ? { type: 'SESSAO_CAIXA', id: setup.sessaoCaixaId, relation: 'sessaoCaixaId' } : undefined });
  for (const balance of balances) add('ESTOQUE', balance.id, [{ type: 'PDV', id: balance.pontoVendaId, relation: 'pontoVendaId', tenantId: balance.pontoVenda.cervejariaId }, { type: 'PRODUTO', id: balance.produtoId, relation: 'produtoId', tenantId: balance.produto.cervejariaId }], { sourceLinks: { pontoVendaId: balance.pontoVendaId, produtoId: balance.produtoId }, pdvFrom: { type: 'PDV', id: balance.pontoVendaId, relation: 'pontoVendaId' } });
  for (const movement of stockMovements) add('MOVIMENTO_ESTOQUE', movement.id, [{ type: 'PDV', id: movement.pontoVendaId, relation: 'pontoVendaId', tenantId: movement.pontoVenda.cervejariaId }, { type: 'PRODUTO', id: movement.produtoId, relation: 'produtoId', tenantId: movement.produto.cervejariaId }, ...(movement.pedidoId ? [{ type: 'PEDIDO' as const, id: movement.pedidoId, relation: 'pedidoId' }] : [])], { sourceLinks: { pontoVendaId: movement.pontoVendaId, produtoId: movement.produtoId, pedidoId: movement.pedidoId }, pdvFrom: { type: 'PDV', id: movement.pontoVendaId, relation: 'pontoVendaId' } });

  return { records, paymentLinkConflicts, effectiveConfiguration };
}
