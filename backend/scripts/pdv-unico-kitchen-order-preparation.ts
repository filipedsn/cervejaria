import { canonicalPdvPayloadHash, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';

// V3 binds the original command-PDV link and its provenance into immutable evidence.
export const PDV_KITCHEN_ORDER_PREPARATION_SCOPE = 'PDV_PEDIDOS_COZINHA_CONTEXT_PREPARATION_V3';
export const PDV_KITCHEN_ORDER_PREPARATION_VERSION = 3;
export const PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE = 'PEDIDO_COZINHA_PDV_PREPARATION_V3';

/** Read with the pre-commercial client: deliberately does not select Comanda.ocorrenciaId. */
export async function readPdvKitchenOrderPreparationSnapshot(tx: any, companyId: string) {
  const orders = await tx.pedidoOperacao.findMany({
    where: { cervejariaId: companyId }, orderBy: { id: 'asc' },
    select: {
      id: true, cervejariaId: true, comandaId: true, pontoVendaId: true, numero: true,
      diaOperacional: true, status: true, paraViagem: true, observacao: true, criadoPorId: true,
      statusDesde: true, entregueEm: true, clienteAvisadoEm: true, createdAt: true, updatedAt: true,
      comanda: { select: { id: true, origem: true, eventoId: true, pontoVendaId: true, evento: { select: { id: true, cervejariaId: true } }, pontoVenda: { select: { id: true, cervejariaId: true } } } },
      pontoVenda: { select: { id: true, cervejariaId: true } },
    },
  });
  const ids = orders.map((row: any) => row.id);
  // Do not tenant-filter: a cross-tenant movement with a globally identified order is itself a blocker.
  const movements = ids.length ? await tx.inventoryMovement.findMany({ where: { pedidoId: { in: ids } }, select: { id: true, cervejariaId: true, pontoVendaId: true, produtoId: true, tipo: true, quantidade: true, observacao: true, registradoPorId: true, pedidoId: true, createdAt: true }, orderBy: { id: 'asc' } }) : [];
  const preparationMaps = ids.length ? await tx.pdvMigrationMap.findMany({ where: { sourceType: PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, sourceId: { in: ids } } }) : [];
  return { orders, movements, preparedOrderIds: new Set(preparationMaps.map((row: any) => row.sourceId)), preparationMapsByOrderId: new Map(preparationMaps.map((row: any) => [row.sourceId, row])) };
}

function block(code: string, id: string, message: string): never { throw new PdvCatalogBlocker(code, PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, id, message); }

function jsonSafe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, jsonSafe(child)]));
  return value;
}

/** Attribution requires agreement among every extant source link; only the order PDV is written. */
export function buildPdvKitchenOrderPreparationItems(input: { companyId: string; pointId: string; confirmedPdvSourceKey: string; snapshot: any; confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string }>; confirmedCommercialCommands?: Set<string>; commandLinkEvidence?: Map<string, { sourcePdvId: string | null; origin: 'LEGACY_SOURCE_LINK' | 'UNLINKED_SOURCE' }> }) {
  const { companyId, pointId, snapshot } = input;
  const items: any[] = [];
  const movementsByOrder = new Map<string, any[]>();
  for (const movement of snapshot.movements) {
    if (!movement.pedidoId) continue;
    const rows = movementsByOrder.get(movement.pedidoId) ?? [];
    rows.push(movement); movementsByOrder.set(movement.pedidoId, rows);
  }
  for (const order of snapshot.orders) {
    if (order.cervejariaId !== companyId) block('KITCHEN_ORDER_TENANT_MISMATCH', order.id, 'Pedido pertence a outra empresa.');
    const command = order.comanda;
    if (!command || command.id !== order.comandaId) block('KITCHEN_ORDER_COMMAND_MISSING', order.id, 'Comanda do pedido ausente ou incompatível.');
    let authoritativePoint: string | null = null;
    const dependencies = [input.confirmedPdvSourceKey];
    if (command.origem === 'CAIXA') {
      if (command.eventoId || command.evento) block('KITCHEN_ORDER_COMMAND_AMBIGUOUS', order.id, 'Comanda CAIXA também aponta para Evento.');
      if (!command.pontoVendaId || command.pontoVenda?.id !== command.pontoVendaId || command.pontoVenda.cervejariaId !== companyId) block('KITCHEN_ORDER_COMMAND_PDV_UNPROVEN', order.id, 'Comanda CAIXA não fornece PDV autoritativo do mesmo tenant.');
      authoritativePoint = command.pontoVendaId;
    } else if (command.origem === 'EVENTO') {
      if (!command.eventoId || command.evento?.id !== command.eventoId || command.evento.cervejariaId !== companyId) block('KITCHEN_ORDER_EVENT_MISSING_OR_TENANT_MISMATCH', order.id, 'Comanda EVENTO não tem Evento válido do mesmo tenant.');
      const occurrence = input.confirmedOccurrences[command.eventoId];
      if (!occurrence) block('KITCHEN_ORDER_OCCURRENCE_MAP_UNCONFIRMED', order.id, 'Evento não possui mapa de ocorrência confirmado.');
      if (occurrence.companyId !== companyId || occurrence.pointId !== pointId) block('KITCHEN_ORDER_OCCURRENCE_TENANT_MISMATCH', order.id, 'Mapa da ocorrência pertence a outro tenant ou PDV.');
      authoritativePoint = occurrence.pointId;
      dependencies.push(`EVENTO:${command.eventoId}`);
    } else block('KITCHEN_ORDER_ORIGIN_UNSUPPORTED', order.id, 'Origem da comanda sem autoridade de atribuição.');

    if (command.pontoVendaId && command.pontoVendaId !== pointId) block('KITCHEN_ORDER_COMMAND_PDV_CONFLICT', order.id, 'PDV da comanda diverge do PDV canônico.');
    if (order.pontoVendaId && (order.pontoVendaId !== pointId || order.pontoVenda?.cervejariaId !== companyId)) block('KITCHEN_ORDER_EXISTING_PDV_CONFLICT', order.id, 'Pedido já aponta para outro PDV ou tenant; não será sobrescrito.');
    if (authoritativePoint !== pointId) block('KITCHEN_ORDER_AUTHORITY_PDV_CONFLICT', order.id, 'Relações autoritativas apontam para outro PDV.');

    if (command.origem === 'EVENTO' && (command.pontoVendaId != null || command.pontoVenda != null) && !input.confirmedCommercialCommands?.has(command.id)) block('KITCHEN_ORDER_COMMERCE_LINK_UNCONFIRMED', order.id, 'Comanda possui vínculo comercial sem mapa/recibo/destino confirmado.');
    const linkEvidence = input.commandLinkEvidence?.get(command.id) ?? { sourcePdvId: command.pontoVendaId ?? null, origin: command.pontoVendaId == null ? 'UNLINKED_SOURCE' as const : 'LEGACY_SOURCE_LINK' as const };
    if (command.origem === 'EVENTO' && linkEvidence.sourcePdvId != null && linkEvidence.sourcePdvId !== pointId) block('KITCHEN_ORDER_COMMAND_PDV_CONFLICT', order.id, 'Source command PDV evidence differs from canonical PDV.');
    const movements = movementsByOrder.get(order.id) ?? [];
    const movementPoints = new Set<string>();
    for (const movement of movements) {
      if (movement.cervejariaId !== companyId) block('KITCHEN_ORDER_MOVEMENT_TENANT_CONFLICT', movement.id, 'Movimento vinculado pertence a outra empresa.');
      movementPoints.add(movement.pontoVendaId);
    }
    if (movementPoints.size > 1) block('KITCHEN_ORDER_MULTIPLE_MOVEMENT_PDVS', order.id, 'Movimentos vinculados apontam para mais de um PDV.');
    if (movementPoints.size === 1 && !movementPoints.has(pointId)) block('KITCHEN_ORDER_MOVEMENT_PDV_CONFLICT', order.id, 'PDV do movimento diverge da atribuição autoritativa.');

    if (order.pontoVendaId === pointId && !snapshot.preparedOrderIds.has(order.id)) continue;
    const sourcePayload = jsonSafe({
      commandLinkEvidence: { sourcePdvId: linkEvidence.sourcePdvId, origin: linkEvidence.origin },
      order: { ...order, pontoVendaId: null, pontoVenda: null, comanda: { ...order.comanda, pontoVendaId: null, pontoVenda: null } },
      command: { id: command.id, origem: command.origem, eventoId: command.eventoId, pontoVendaId: null, evento: command.evento, pontoVenda: null },
      movements,
      authoritativePointId: authoritativePoint,
    });
    items.push({ type: PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, id: order.id, destinationType: 'PEDIDO_COZINHA', destinationId: order.id, sourcePayload, destinationData: { pontoVendaId: pointId }, dependencies });
  }
  return items;
}

export function pdvKitchenPreparationPayloadHash(value: unknown) { return canonicalPdvPayloadHash(value); }
