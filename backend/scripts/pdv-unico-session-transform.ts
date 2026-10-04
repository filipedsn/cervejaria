import { canonicalPdvPayloadHash, PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';

export const PDV_SESSION_SCOPE = 'PDV_SESSOES_CAIXA_V1';
export const PDV_SESSION_TRANSFORM_VERSION = 1;
const sourceKey = (type: string, id: string) => `${type}:${id}`;

function jsonSafe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toFixed(2);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}

export const operationalSessionData = (row: any) => ({
  id: row.id, cervejariaId: row.cervejariaId, pontoVendaId: row.pontoVendaId, trailerId: row.trailerId,
  diaOperacional: row.diaOperacional, status: row.status, trocoInicial: row.trocoInicial,
  abertoPorId: row.abertoPorId, abertoEm: row.abertoEm, fechadoPorId: row.fechadoPorId,
  fechadoEm: row.fechadoEm, contadoDinheiro: row.contadoDinheiro, contadoPix: row.contadoPix,
  contadoCartaoDebito: row.contadoCartaoDebito, contadoCartaoCredito: row.contadoCartaoCredito,
  contadoCartao: row.contadoCartao ?? null, observacaoFechamento: row.observacaoFechamento,
  cardapioId: row.cardapioId, ocorrenciaId: row.ocorrenciaId, origemHistorica: row.origemHistorica,
});

export interface PdvSessionMigrationInput {
  companyId: string;
  pointId: string;
  snapshot: any;
  confirmedPdvSourceKey: string;
  confirmedOccurrences: Record<string, { id: string; companyId: string; pointId: string; date: Date }>;
  confirmedMenus: Record<string, { id: string; companyId: string; pointId: string }>;
}

export function buildPdvSessionMigrationItems(input: PdvSessionMigrationInput) {
  const { companyId, pointId, snapshot } = input;
  if (!/^(PDV|TRAILER):.+/.test(input.confirmedPdvSourceKey)) throw new PdvCatalogBlocker('PDV_DEPENDENCY_NOT_CONFIRMED', 'PDV', pointId, 'O PDV canônico ainda não foi confirmado pelo escopo operacional anterior.');
  const items: Array<{ type: string; id: string; destinationType: string; destinationId: string; sourcePayload: unknown; destinationData: Record<string, unknown>; dependencies: string[] }> = [];
  const allowedPointIds = new Set([pointId]);

  for (const session of snapshot.operationalSessions) {
    if (session.cervejariaId !== companyId || session.pontoVenda?.cervejariaId !== companyId || !allowedPointIds.has(session.pontoVendaId)) throw new PdvCatalogBlocker('SESSION_TENANT_OR_PDV_MISMATCH', 'SESSAO_CAIXA_OPERACAO', session.id, 'Sessão Por Caixa pertence a outro tenant/PDV; nenhum vínculo será alterado.');
    if (session.trailerId && session.trailer?.cervejariaId !== companyId) throw new PdvCatalogBlocker('SESSION_TRAILER_TENANT_MISMATCH', 'SESSAO_CAIXA_OPERACAO', session.id, 'Trailer da sessão pertence a outro tenant.');
    if (session.cardapioId && (session.cardapio?.cervejariaId !== companyId || session.cardapio.pontoVendaId !== pointId)) throw new PdvCatalogBlocker('SESSION_MENU_TENANT_OR_PDV_MISMATCH', 'SESSAO_CAIXA_OPERACAO', session.id, 'Cardápio selecionado não pertence ao mesmo tenant/PDV.');
    for (const product of session.produtos) if (product.produto?.cervejariaId !== companyId || product.produto.pontoVendaId !== pointId) throw new PdvCatalogBlocker('SESSION_PRODUCT_TENANT_OR_PDV_MISMATCH', 'SESSAO_CAIXA_OPERACAO_ITEM', product.id, 'Produto do turno não pertence ao mesmo tenant/PDV.');
    items.push({
      type: 'SESSAO_CAIXA_OPERACAO', id: session.id, destinationType: 'SESSAO_CAIXA_OPERACAO', destinationId: session.id,
      sourcePayload: jsonSafe({ session: operationalSessionData(session), productItemIds: session.produtos.map((row: any) => row.id) }),
      destinationData: operationalSessionData(session), dependencies: [input.confirmedPdvSourceKey],
    });
    for (const product of session.produtos) {
      const data = { id: product.id, sessaoCaixaId: product.sessaoCaixaId, produtoId: product.produtoId, volumeMl: product.volumeMl, precoUnit: product.precoUnit, createdAt: product.createdAt };
      items.push({ type: 'SESSAO_CAIXA_OPERACAO_ITEM', id: product.id, destinationType: 'SESSAO_CAIXA_OPERACAO_ITEM', destinationId: product.id, sourcePayload: jsonSafe(data), destinationData: data, dependencies: [sourceKey('SESSAO_CAIXA_OPERACAO', session.id), `CATALOGO_PRODUTO:${product.produtoId}`] });
    }
  }

  const openTargetSessions = snapshot.operationalSessions.filter((row: any) => row.status === 'ABERTO');
  const openEventDays = new Set<string>();
  for (const session of snapshot.eventSessions) {
    const event = session.evento;
    if (event.cervejariaId !== companyId || event.trailer?.cervejariaId !== companyId || (event.cardapioId && event.cardapio?.cervejariaId !== companyId)) throw new PdvCatalogBlocker('EVENT_SESSION_SOURCE_TENANT_MISMATCH', 'SESSAO_CAIXA_EVENTO', session.id, 'Evento, trailer ou cardápio de origem diverge de empresa.');
    if (!event.data) throw new PdvCatalogBlocker('SESSION_OPERATIONAL_DAY_UNPROVEN', 'SESSAO_CAIXA_EVENTO', session.id, 'Evento sem data persistida não comprova o dia operacional; abertura/fechamento não será usado como aproximação.');
    const occurrence = input.confirmedOccurrences[session.eventoId];
    if (!occurrence) throw new PdvCatalogBlocker('SESSION_OCCURRENCE_MAPPING_MISSING', 'SESSAO_CAIXA_EVENTO', session.id, 'Não há mapa confirmado do Evento para uma ocorrência operacional.');
    if (occurrence.companyId !== companyId || occurrence.pointId !== pointId || occurrence.date.getTime() !== event.data.getTime()) throw new PdvCatalogBlocker('SESSION_OCCURRENCE_MAPPING_INCOMPATIBLE', 'SESSAO_CAIXA_EVENTO', session.id, 'Ocorrência mapeada diverge de tenant, PDV ou data do Evento.');
    const confirmedMenu = event.cardapioId ? input.confirmedMenus[event.cardapioId] : null;
    if (event.cardapioId && (!confirmedMenu || confirmedMenu.id !== event.cardapioId || confirmedMenu.companyId !== companyId || confirmedMenu.pointId !== pointId)) throw new PdvCatalogBlocker('SESSION_EVENT_MENU_UNCONFIRMED', 'SESSAO_CAIXA_EVENTO', session.id, 'Event menu has no confirmed map for this company/PDV.');
    for (const product of event.produtos ?? []) {
      if (product.produto?.cervejariaId !== companyId || (product.produto.pontoVendaId != null && product.produto.pontoVendaId !== pointId)) throw new PdvCatalogBlocker('SESSION_EVENT_PRODUCT_TENANT_OR_PDV_MISMATCH', 'EVENTO_PRODUTO', product.id, 'Event selected product belongs to another company/PDV.');
    }
    const dayKey = `${pointId}:${event.data.toISOString().slice(0, 10)}`;
    if (session.status === 'ABERTO') {
      if (openTargetSessions.some((row: any) => row.pontoVendaId === pointId && row.diaOperacional.toISOString().slice(0, 10) === event.data.toISOString().slice(0, 10))) throw new PdvCatalogBlocker('OPEN_SESSION_CONFLICT', 'SESSAO_CAIXA_EVENTO', session.id, 'Já há sessão Por Caixa aberta neste PDV/dia operacional.');
      if (openEventDays.has(dayKey)) throw new PdvCatalogBlocker('OPEN_SESSION_CONFLICT', 'SESSAO_CAIXA_EVENTO', session.id, 'Mais de uma sessão Evento aberta convergiria para o mesmo PDV/dia.');
      openEventDays.add(dayKey);
    }
    const data = {
      id: session.id, cervejariaId: companyId, pontoVendaId: pointId, trailerId: event.trailerId,
      diaOperacional: event.data, status: session.status, trocoInicial: session.trocoInicial,
      abertoPorId: session.abertoPorId, abertoEm: session.abertoEm, fechadoPorId: session.fechadoPorId,
      fechadoEm: session.fechadoEm, contadoDinheiro: session.contadoDinheiro, contadoPix: session.contadoPix,
      contadoCartaoDebito: session.contadoDebito, contadoCartaoCredito: session.contadoCredito,
      contadoCartao: session.contadoCartao, observacaoFechamento: session.observacaoFechamento,
      cardapioId: event.cardapioId ?? null, ocorrenciaId: occurrence.id, origemHistorica: 'EVENTO',
    };
    items.push({
      type: 'SESSAO_CAIXA_EVENTO', id: session.id, destinationType: 'SESSAO_CAIXA_OPERACAO', destinationId: session.id,
      sourcePayload: jsonSafe({ ...session, eventoDataPersistida: event.data, eventoTrailerId: event.trailerId, eventoCardapioId: event.cardapioId, occurrence }),
      destinationData: data, dependencies: [input.confirmedPdvSourceKey, sourceKey('EVENTO', session.eventoId), ...(event.cardapioId ? [sourceKey('CATALOGO_CARDAPIO', event.cardapioId)] : [])],
    });
    for (const selected of event.produtos ?? []) {
      const itemId = `${session.id}::${selected.id}`;
      items.push({
        type: 'EVENTO_PRODUTO_SESSAO', id: `${session.id}:${selected.id}`, destinationType: 'SESSAO_CAIXA_OPERACAO_ITEM', destinationId: itemId,
        sourcePayload: jsonSafe({ sessionId: session.id, eventoId: session.eventoId, selected, volumeEvidence: 'EVENTO_PRODUCT_SELECTION_HAS_NO_VOLUME_OR_TURN_PRICE' }),
        destinationData: { id: itemId, sessaoCaixaId: session.id, produtoId: selected.produtoId, volumeMl: 0, precoUnit: null, createdAt: selected.createdAt },
        dependencies: [sourceKey('SESSAO_CAIXA_EVENTO', session.id), `CATALOGO_PRODUTO:${selected.produtoId}`],
      });
    }
  }

  const order: Record<string, number> = { SESSAO_CAIXA_OPERACAO: 0, SESSAO_CAIXA_EVENTO: 1, SESSAO_CAIXA_OPERACAO_ITEM: 2, EVENTO_PRODUTO_SESSAO: 3 };
  items.sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99) || a.id.localeCompare(b.id));
  return items;
}

export function pdvSessionDestinationDigest(value: unknown) { return canonicalPdvPayloadHash(value); }
