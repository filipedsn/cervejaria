import { canonicalPdvPayloadHash, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';

export const PDV_COMMERCE_SCOPE = 'PDV_COMANDAS_PEDIDOS_ESTOQUE_V1';
export const PDV_COMMERCE_TRANSFORM_VERSION = 2;
const key = (type: string, id: string) => `${type}:${id}`;
const relationKeys = new Set(['evento', 'pontoVenda', 'cliente', 'produto', 'opcional', 'opcionalCatalogo', 'grupo', 'produtoEstoque', 'comanda', 'pedido', 'sessao', 'cervejaria', 'itens', 'itensComanda', 'historicoStatus', 'opcionais', 'produtos', 'movimentos']);

function jsonSafe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name]) => !relationKeys.has(name)).map(([name, child]) => [name, jsonSafe(child)]));
  return value;
}

function persistedData(value: any): any {
  if (value instanceof Date || (value && typeof value === 'object' && typeof value.toFixed === 'function')) return value;
  if (Array.isArray(value)) return value.map(persistedData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name]) => !relationKeys.has(name)).map(([name, child]) => [name, persistedData(child)]));
  return value;
}

function block(code: string, type: string, id: string, message: string): never { throw new PdvCatalogBlocker(code, type, id, message); }

/** Stable origin projections exclude only links this migration writes. */
export function buildPdvCommerceMigrationItems(input: {
  companyId: string; pointId: string; confirmedPdvSourceKey: string; snapshot: any;
  confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string }>;
}) {
  const { companyId, pointId, snapshot } = input;
  if (!/^(PDV|TRAILER):.+/.test(input.confirmedPdvSourceKey)) block('COMMERCE_PDV_UNCONFIRMED', 'PDV', pointId, 'PDV canônico não foi confirmado.');
  const items: any[] = [];
  const commandById = new Map(snapshot.commands.map((row: any) => [row.id, row]));
  const orderById = new Map(snapshot.orders.map((row: any) => [row.id, row]));
  const eventOccurrence = (eventId: string, sourceType: string, sourceId: string) => {
    const occurrence = input.confirmedOccurrences[eventId];
    if (!occurrence) block('COMMERCE_OCCURRENCE_MAP_MISSING', sourceType, sourceId, 'Origem Evento não tem ocorrência confirmada.');
    if (occurrence.companyId !== companyId || occurrence.pointId !== pointId) block('COMMERCE_OCCURRENCE_TENANT_MISMATCH', sourceType, sourceId, 'Mapa de ocorrência pertence a outra empresa ou PDV.');
    return occurrence;
  };
  const add = (type: string, id: string, destinationType: string, destinationId: string, source: any, destination: any, dependencies: string[]) => {
    items.push({ type, id, destinationType, destinationId, sourcePayload: jsonSafe(source), destinationData: destination, dependencies });
  };

  for (const command of snapshot.commands) {
    if (command.clienteId && command.cliente?.cervejariaId !== companyId) block('COMMERCE_COMMAND_CLIENT_TENANT_MISMATCH', 'COMANDA', command.id, 'Cliente da comanda pertence a outra empresa ou está ausente.');
    let occurrenceId: string | null = null;
    const dependencies = [input.confirmedPdvSourceKey];
    if (command.origem === 'EVENTO') {
      if (!command.eventoId || !command.evento || command.evento.cervejariaId !== companyId) block('COMMERCE_COMMAND_EVENT_MISSING', 'COMANDA', command.id, 'Comanda EVENTO não tem Evento válido da mesma empresa.');
      const occurrence = eventOccurrence(command.eventoId, 'COMANDA', command.id);
      occurrenceId = occurrence.id;
      dependencies.push(key('EVENTO', command.eventoId));
      if (command.pontoVendaId && command.pontoVendaId !== pointId) block('COMMERCE_COMMAND_PDV_MISMATCH', 'COMANDA', command.id, 'Comanda EVENTO já aponta para outro PDV.');
      if (command.ocorrenciaId && command.ocorrenciaId !== occurrenceId) block('COMMERCE_COMMAND_OCCURRENCE_MISMATCH', 'COMANDA', command.id, 'Comanda já aponta para outra ocorrência.');
    } else if (command.origem === 'CAIXA') {
      if (command.eventoId) block('COMMERCE_CASH_COMMAND_HAS_EVENT', 'COMANDA', command.id, 'Comanda CAIXA também aponta para Evento; origem ambígua.');
      if (command.pontoVendaId && (command.pontoVendaId !== pointId || command.pontoVenda?.cervejariaId !== companyId)) block('COMMERCE_COMMAND_PDV_MISMATCH', 'COMANDA', command.id, 'Comanda CAIXA aponta para outro PDV ou tenant.');
    } else block('COMMERCE_COMMAND_ORIGIN_UNSUPPORTED', 'COMANDA', command.id, 'Origem da comanda não tem transformação definida.');
    const { pontoVendaId: _pontoVendaId, ocorrenciaId: _occurrenceId, ...source } = command;
    add('COMANDA', command.id, 'COMANDA', command.id, source, { pontoVendaId: pointId, ocorrenciaId: occurrenceId }, dependencies);
  }

  for (const command of snapshot.commands) for (const item of command.itens) {
    if (item.produtoId && item.produto?.cervejariaId !== companyId) block('COMMERCE_ITEM_PRODUCT_TENANT_MISMATCH', 'ITEM_COMANDA', item.id, 'Produto do item pertence a outra empresa ou está ausente.');
    const deps = [key('COMANDA', command.id)];
    if (item.produtoId) deps.push(key('CATALOGO_PRODUTO', item.produtoId));
    add('ITEM_COMANDA', item.id, 'ITEM_COMANDA', item.id, item, persistedData(item), deps);
    for (const optional of item.opcionais) {
      if (optional.opcionalId && optional.opcional?.grupo?.produto?.cervejariaId !== companyId || optional.opcionalId && optional.opcional?.produtoEstoqueId && optional.opcional.produtoEstoque?.cervejariaId !== companyId || optional.opcionalCatalogoId && optional.opcionalCatalogo?.cervejariaId !== companyId) block('COMMERCE_SOLD_OPTIONAL_TENANT_MISMATCH', 'ITEM_COMANDA_OPCIONAL', optional.id, 'Opcional vendido aponta para catálogo/estoque de outra empresa ou ausente.');
      add('ITEM_COMANDA_OPCIONAL', optional.id, 'ITEM_COMANDA_OPCIONAL', optional.id, optional, persistedData(optional), [key('ITEM_COMANDA', item.id)]);
    }
  }

  for (const order of snapshot.orders) {
    const command: any = commandById.get(order.comandaId);
    if (!command || order.cervejariaId !== companyId || order.comanda?.eventoId !== command.eventoId || (order.comanda?.pontoVendaId && command.pontoVendaId && order.comanda.pontoVendaId !== command.pontoVendaId)) block('COMMERCE_ORDER_COMMAND_MISMATCH', 'PEDIDO_COZINHA', order.id, 'Pedido de cozinha aponta para comanda ausente ou divergente.');
    let expectedPoint = command.origem === 'EVENTO' ? eventOccurrence(command.eventoId, 'PEDIDO_COZINHA', order.id).pointId : command.pontoVendaId;
    expectedPoint ||= pointId;
    if (expectedPoint !== pointId || order.pontoVendaId && order.pontoVendaId !== pointId || order.pontoVenda?.cervejariaId && order.pontoVenda.cervejariaId !== companyId) block('COMMERCE_ORDER_PDV_MISMATCH', 'PEDIDO_COZINHA', order.id, 'Pedido de cozinha já aponta para outro PDV/tenant.');
    const { pontoVendaId: _orderPointId, ...orderSource } = order;
    add('PEDIDO_COZINHA', order.id, 'PEDIDO_COZINHA', order.id, orderSource, { pontoVendaId: pointId }, [key('COMANDA', command.id), input.confirmedPdvSourceKey, ...(command.eventoId ? [key('EVENTO', command.eventoId)] : [])]);
    for (const item of order.itensComanda) {
      if (item.comandaId !== command.id || !command.itens.some((candidate: any) => candidate.id === item.id)) block('COMMERCE_ORDER_ITEM_LINK_MISMATCH', 'PEDIDO_ITEM_LINK', item.id, 'Vínculo pedido/item não corresponde à comanda fotografada.');
    }
    for (const history of order.historicoStatus) add('PEDIDO_COZINHA_STATUS', history.id, 'PEDIDO_COZINHA_STATUS', history.id, history, persistedData(history), [key('PEDIDO_COZINHA', order.id)]);
  }

  for (const request of snapshot.portalOrders) {
    const command: any = commandById.get(request.comandaId);
    if (!command || request.evento?.cervejariaId !== companyId || request.cliente?.cervejariaId !== companyId || request.comanda?.eventoId !== request.eventoId || request.comanda?.clienteId !== request.clienteId) block('COMMERCE_PORTAL_ORDER_LINK_MISMATCH', 'PEDIDO_CLIENTE', request.id, 'Pedido do portal tem referências ausentes ou de tenant divergente.');
    eventOccurrence(request.eventoId, 'PEDIDO_CLIENTE', request.id);
    add('PEDIDO_CLIENTE', request.id, 'PEDIDO_CLIENTE', request.id, request, persistedData(request), [key('COMANDA', command.id), key('EVENTO', request.eventoId)]);
    for (const line of request.itens) add('PEDIDO_CLIENTE_ITEM', line.id, 'PEDIDO_CLIENTE_ITEM', line.id, line, persistedData(line), [key('PEDIDO_CLIENTE', request.id), key('CATALOGO_PRODUTO', line.produtoId)]);
  }

  for (const row of snapshot.balances) {
    if (row.cervejariaId !== companyId || row.pontoVenda?.cervejariaId !== companyId || row.pontoVendaId !== pointId || row.produto?.cervejariaId !== companyId) block('COMMERCE_STOCK_BALANCE_LINK_MISMATCH', 'ESTOQUE_SALDO', row.id, 'Saldo de estoque tem produto, PDV ou empresa incompatível.');
    add('ESTOQUE_SALDO', row.id, 'ESTOQUE_SALDO', row.id, row, persistedData(row), [input.confirmedPdvSourceKey, key('CATALOGO_PRODUTO', row.produtoId)]);
  }
  for (const row of snapshot.stockMovements) {
    if (row.cervejariaId !== companyId || row.pontoVenda?.cervejariaId !== companyId || row.pontoVendaId !== pointId || row.produto?.cervejariaId !== companyId) block('COMMERCE_STOCK_MOVEMENT_LINK_MISMATCH', 'MOVIMENTO_ESTOQUE', row.id, 'Movimento de estoque tem produto, PDV ou empresa incompatível.');
    const dependencies = [input.confirmedPdvSourceKey, key('CATALOGO_PRODUTO', row.produtoId)];
    if (row.pedidoId) {
      if (!orderById.has(row.pedidoId)) block('COMMERCE_STOCK_ORDER_MISSING', 'MOVIMENTO_ESTOQUE', row.id, 'Movimento referencia pedido não incluído na fotografia.');
      dependencies.push(key('PEDIDO_COZINHA', row.pedidoId));
    }
    add('MOVIMENTO_ESTOQUE', row.id, 'MOVIMENTO_ESTOQUE', row.id, row, persistedData(row), dependencies);
  }

  const priority: Record<string, number> = { COMANDA: 0, PEDIDO_COZINHA: 1, PEDIDO_CLIENTE: 2, ITEM_COMANDA: 3, ITEM_COMANDA_OPCIONAL: 4, PEDIDO_COZINHA_STATUS: 5, PEDIDO_CLIENTE_ITEM: 6, ESTOQUE_SALDO: 7, MOVIMENTO_ESTOQUE: 8 };
  items.sort((a, b) => (priority[a.type] ?? 99) - (priority[b.type] ?? 99) || a.id.localeCompare(b.id));
  return items;
}

export function commercePayloadHash(value: unknown) { return canonicalPdvPayloadHash(value); }
