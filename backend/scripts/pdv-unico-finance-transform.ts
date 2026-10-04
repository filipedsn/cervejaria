import { PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';

export const PDV_FINANCE_SCOPE = 'PDV_FINANCEIRO_V1';
export const PDV_FINANCE_TRANSFORM_VERSION = 1;
const sourceKey = (type: string, id: string) => `${type}:${id}`;
function jsonSafe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toFixed(2);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}

export type ConfirmedFinanceSession = { id: string; companyId: string; pointId: string; sourceType: 'SESSAO_CAIXA_EVENTO' | 'SESSAO_CAIXA_OPERACAO' };
export interface PdvFinanceMigrationInput {
  companyId: string;
  pointId: string;
  confirmedPdvSourceKey: string;
  snapshot: any;
  confirmedSessions: Record<string, ConfirmedFinanceSession>;
  confirmedEvents: Record<string, { id: string; companyId: string; pointId: string }>;
  mappedPaymentIds: Set<string>;
}

function fail(code: string, type: string, id: string, message: string): never {
  throw new PdvCatalogBlocker(code, type, id, message);
}

function commandCompanyAndPoint(command: any, input: PdvFinanceMigrationInput, type: string, id: string) {
  if (command.origem === 'EVENTO') {
    const event = input.confirmedEvents[command.eventoId];
    if (!command.eventoId || !event || command.evento?.cervejariaId !== input.companyId || event.companyId !== input.companyId || event.pointId !== input.pointId || (command.pontoVendaId && command.pontoVendaId !== input.pointId)) fail('FINANCE_COMMAND_EVENT_MISMATCH', type, id, 'Comanda Evento não pertence à ocorrência confirmada neste tenant/PDV.');
  } else if (!command.pontoVendaId || command.pontoVendaId !== input.pointId || command.pontoVenda?.cervejariaId !== input.companyId || command.eventoId) {
    fail('FINANCE_COMMAND_PDV_MISMATCH', type, id, 'Comanda Por Caixa não pertence ao PDV/tenant esperado.');
  }
}

const paymentFields = (row: any) => ({
  id: row.id, comandaId: row.comandaId, contaReceberId: row.contaReceberId,
  sessaoCaixaId: row.sessaoCaixaId, sessaoCaixaEventoId: row.sessaoCaixaEventoId,
  forma: row.forma, valor: row.valor, valorRecebido: row.valorRecebido,
  troco: row.troco, registradoPorId: row.registradoPorId, pagoEm: row.pagoEm,
});
const debtFields = (row: any) => ({ id: row.id, comandaId: row.comandaId, clienteId: row.clienteId, valorOriginal: row.valorOriginal, criadoPorId: row.criadoPorId, createdAt: row.createdAt });
const movementFields = (row: any) => ({
  id: row.id, sessaoId: row.sessaoId, tipo: row.tipo, valor: row.valor,
  observacao: row.observacao, registradoPorId: row.registradoPorId,
  correcaoDeId: row.correcaoDeId, naturezaCorrecao: row.naturezaCorrecao,
  motivoCorrecao: row.motivoCorrecao, autorizadoPorId: row.autorizadoPorId,
  solicitadoPorId: row.solicitadoPorId, corrigidoEm: row.corrigidoEm, createdAt: row.createdAt,
});

export function buildPdvFinanceMigrationItems(input: PdvFinanceMigrationInput) {
  const items: Array<{ type: string; id: string; destinationType: string; destinationId: string; sourcePayload: unknown; destinationData: Record<string, unknown>; dependencies: string[] }> = [];
  if (!/^(PDV|TRAILER):.+/.test(input.confirmedPdvSourceKey)) fail('FINANCE_PDV_UNCONFIRMED', 'PDV', input.pointId, 'PDV canônico não foi confirmado.');

  for (const debt of input.snapshot.debts) {
    commandCompanyAndPoint(debt.comanda, input, 'CONTA_RECEBER', debt.id);
    if (debt.cliente.cervejariaId !== input.companyId || debt.comandaId !== debt.comanda.id || debt.comanda.clienteId !== debt.clienteId) fail('FINANCE_DEBT_CLIENT_MISMATCH', 'CONTA_RECEBER', debt.id, 'Dívida, cliente e comanda não pertencem à mesma origem.');
    const data = debtFields(debt);
    items.push({ type: 'CONTA_RECEBER', id: debt.id, destinationType: 'CONTA_RECEBER', destinationId: debt.id,
      sourcePayload: jsonSafe(data), destinationData: data, dependencies: [input.confirmedPdvSourceKey, ...(debt.comanda.eventoId ? [sourceKey('EVENTO', debt.comanda.eventoId)] : [])] });
  }

  for (const payment of input.snapshot.payments) {
    commandCompanyAndPoint(payment.comanda, input, 'PAGAMENTO', payment.id);
    if (payment.contaReceberId && (!payment.contaReceber || payment.contaReceber.comandaId !== payment.comandaId || payment.contaReceber.cliente.cervejariaId !== input.companyId)) fail('FINANCE_PAYMENT_DEBT_MISMATCH', 'PAGAMENTO', payment.id, 'Pagamento aponta a dívida ausente ou de outra comanda/empresa.');
    const eventSession = payment.sessaoCaixaEventoId;
    const cashSession = payment.sessaoCaixaId;
    let targetSessionId: string | null = null;
    let sessionDependency: string | null = null;
    if (eventSession) {
      const confirmed = input.confirmedSessions[sourceKey('SESSAO_CAIXA_EVENTO', eventSession)];
      if (!payment.sessaoCaixaEvento || !confirmed || confirmed.companyId !== input.companyId || confirmed.pointId !== input.pointId || payment.sessaoCaixaEvento.evento.cervejariaId !== input.companyId) fail('FINANCE_PAYMENT_SESSION_MISSING', 'PAGAMENTO', payment.id, 'Sessão Evento de recebimento ausente ou incompatível.');
      if (cashSession && (!input.mappedPaymentIds.has(payment.id) || cashSession !== confirmed.id)) fail('FINANCE_PAYMENT_DOUBLE_SESSION', 'PAGAMENTO', payment.id, 'Pagamento contém duas sessões de origem ou vínculo de destino não confirmado.');
      targetSessionId = confirmed.id;
      sessionDependency = sourceKey('SESSAO_CAIXA_EVENTO', eventSession);
    } else if (cashSession) {
      const confirmed = input.confirmedSessions[sourceKey('SESSAO_CAIXA_OPERACAO', cashSession)];
      if (!payment.sessaoCaixaOperacao || !confirmed || confirmed.companyId !== input.companyId || confirmed.pointId !== input.pointId || payment.sessaoCaixaOperacao.cervejariaId !== input.companyId || payment.sessaoCaixaOperacao.pontoVendaId !== input.pointId) fail('FINANCE_PAYMENT_SESSION_MISSING', 'PAGAMENTO', payment.id, 'Sessão Por Caixa de recebimento ausente ou incompatível.');
      targetSessionId = confirmed.id;
      sessionDependency = sourceKey('SESSAO_CAIXA_OPERACAO', cashSession);
    } else if (!payment.contaReceberId) {
      fail('FINANCE_PAYMENT_SESSION_MISSING', 'PAGAMENTO', payment.id, 'Pagamento imediato sem sessão persistida não pode ser associado por aproximação.');
    }
    const source = paymentFields(payment);
    const sourcePayload = eventSession ? { ...source, sessaoCaixaId: null } : source;
    const destinationData = { ...source, sessaoCaixaId: targetSessionId };
    items.push({ type: 'PAGAMENTO', id: payment.id, destinationType: 'PAGAMENTO', destinationId: payment.id,
      sourcePayload: jsonSafe(sourcePayload), destinationData, dependencies: [input.confirmedPdvSourceKey, ...(sessionDependency ? [sessionDependency] : []), ...(payment.contaReceberId ? [sourceKey('CONTA_RECEBER', payment.contaReceberId)] : [])] });
  }

  for (const movement of input.snapshot.operationalMovements) {
    if (movement.sessao.cervejariaId !== input.companyId || movement.sessao.pontoVendaId !== input.pointId) fail('FINANCE_MOVEMENT_PDV_MISMATCH', 'MOVIMENTO_CAIXA_OPERACAO', movement.id, 'Movimento Por Caixa pertence a outro tenant/PDV.');
    const data = movementFields(movement);
    items.push({ type: 'MOVIMENTO_CAIXA_OPERACAO', id: movement.id, destinationType: 'MOVIMENTO_CAIXA_OPERACAO', destinationId: movement.id,
      sourcePayload: jsonSafe(data), destinationData: data, dependencies: [sourceKey('SESSAO_CAIXA_OPERACAO', movement.sessaoId)] });
  }

  for (const movement of input.snapshot.eventMovements) {
    const confirmed = input.confirmedSessions[sourceKey('SESSAO_CAIXA_EVENTO', movement.sessaoId)];
    if (!confirmed || confirmed.companyId !== input.companyId || confirmed.pointId !== input.pointId || movement.sessao.evento.cervejariaId !== input.companyId) fail('FINANCE_MOVEMENT_SESSION_MISSING', 'MOVIMENTO_CAIXA_EVENTO', movement.id, 'Sessão Evento do movimento não foi confirmada neste tenant/PDV.');
    if (movement.tipo !== 'SUPRIMENTO' && movement.tipo !== 'SANGRIA') fail('FINANCE_MOVEMENT_TYPE_UNSUPPORTED', 'MOVIMENTO_CAIXA_EVENTO', movement.id, 'Tipo de movimento Evento não tem tradução comprovada.');
    const data = { id: movement.id, sessaoId: confirmed.id, tipo: movement.tipo, valor: movement.valor,
      observacao: movement.observacao, registradoPorId: movement.registradoPorId,
      correcaoDeId: null, naturezaCorrecao: null, motivoCorrecao: null, autorizadoPorId: null,
      solicitadoPorId: null, corrigidoEm: null, createdAt: movement.createdAt };
    items.push({ type: 'MOVIMENTO_CAIXA_EVENTO', id: movement.id, destinationType: 'MOVIMENTO_CAIXA_OPERACAO', destinationId: movement.id,
      sourcePayload: jsonSafe({ id: movement.id, sessaoId: movement.sessaoId, tipo: movement.tipo, valor: movement.valor, observacao: movement.observacao, registradoPorId: movement.registradoPorId, createdAt: movement.createdAt }),
      destinationData: data, dependencies: [sourceKey('SESSAO_CAIXA_EVENTO', movement.sessaoId)] });
  }

  const order: Record<string, number> = { CONTA_RECEBER: 0, PAGAMENTO: 1, MOVIMENTO_CAIXA_OPERACAO: 2, MOVIMENTO_CAIXA_EVENTO: 3 };
  items.sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99) || a.id.localeCompare(b.id));
  return items;
}
