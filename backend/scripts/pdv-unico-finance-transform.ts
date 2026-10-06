import { PdvCatalogBlocker } from './pdv-unico-catalog-transform.js';
import { createHash } from 'node:crypto';

export const PDV_FINANCE_SCOPE = 'PDV_FINANCEIRO_V1';
export const PDV_FINANCE_TRANSFORM_VERSION = 3;
export const PDV_HISTORICAL_C_APPROVED_SNAPSHOT_SHA256 = '87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a';
const sourceKey = (type: string, id: string) => `${type}:${id}`;
function jsonSafe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return value.toFixed(2);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}

export type ConfirmedFinanceSession = { id: string; companyId: string; pointId: string; sourceType: 'SESSAO_CAIXA_EVENTO' | 'SESSAO_CAIXA_OPERACAO' };
export interface ApprovedHistoricalNoSessionPayment {
  tenantId: string; id: string; commandId: string; origin: string; pointId: string | null; eventId: string | null;
  commandTotalCents: string; commandClosedAt: string | null; form: string; cents: string;
  receivedCents: string | null; changeCents: string | null; paidAt: string;
  registeredById: string | null; receivableId: string | null;
  operationalSessionId: string | null; eventSessionId: string | null;
  classification: 'C_ORIGIN_UNPROVEN';
}
export interface HistoricalNoSessionApproval {
  version: 1;
  scope: 'TAP-76 QA rehearsal only';
  classification: 'C_ORIGIN_UNPROVEN';
  provenance: 'CAIXA_NAO_COMPROVADA';
  approvedSnapshotSha256: string;
  counts: { payments: number; withExactPaymentAuditReference: number; withoutExactPaymentAuditReference: number };
  entries: ApprovedHistoricalNoSessionPayment[];
}
export interface PdvFinanceMigrationInput {
  companyId: string;
  pointId: string;
  confirmedPdvSourceKey: string;
  snapshot: any;
  confirmedSessions: Record<string, ConfirmedFinanceSession>;
  confirmedEvents: Record<string, { id: string; companyId: string; pointId: string }>;
  mappedPaymentIds: Set<string>;
  historicalNoSessionApproval?: HistoricalNoSessionApproval;
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
  provenienciaHistorica: row.provenienciaHistorica ?? null,
  forma: row.forma, valor: row.valor, valorRecebido: row.valorRecebido,
  troco: row.troco, registradoPorId: row.registradoPorId, pagoEm: row.pagoEm,
});
const cents = (value: unknown) => {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) fail('FINANCE_HISTORICAL_APPROVAL_AMOUNT_INVALID', 'PAGAMENTO', '', 'Valor financeiro fora da escala autorizada.');
  return `${match[1] === '-' ? '-' : ''}${(BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))).toString()}`;
};

function validateHistoricalNoSessionApproval(approval: HistoricalNoSessionApproval | undefined) {
  if (!approval) return { byId: new Map<string, ApprovedHistoricalNoSessionPayment>(), digest: null as string | null };
  if (approval.version !== 1 || approval.scope !== 'TAP-76 QA rehearsal only' || approval.classification !== 'C_ORIGIN_UNPROVEN'
    || approval.provenance !== 'CAIXA_NAO_COMPROVADA' || approval.counts.payments !== approval.entries.length
    || approval.counts.withExactPaymentAuditReference !== 323 || approval.counts.withoutExactPaymentAuditReference !== 254
    || approval.counts.payments !== approval.counts.withExactPaymentAuditReference + approval.counts.withoutExactPaymentAuditReference
    || approval.entries.length !== 577 || approval.entries.some((entry) => entry.classification !== 'C_ORIGIN_UNPROVEN')) {
    fail('FINANCE_HISTORICAL_APPROVAL_INVALID', 'PAGAMENTO', '', 'A autorização C não corresponde ao inventário histórico aprovado.');
  }
  const digest = createHash('sha256').update(JSON.stringify(approval.entries)).digest('hex');
  if (digest !== approval.approvedSnapshotSha256 || digest !== PDV_HISTORICAL_C_APPROVED_SNAPSHOT_SHA256) fail('FINANCE_HISTORICAL_APPROVAL_DIGEST_MISMATCH', 'PAGAMENTO', '', 'A fotografia aprovada foi alterada.');
  const byId = new Map<string, ApprovedHistoricalNoSessionPayment>();
  for (const entry of approval.entries) {
    if (byId.has(entry.id)) fail('FINANCE_HISTORICAL_APPROVAL_DUPLICATE_ID', 'PAGAMENTO', entry.id, 'A autorização contém ID repetido.');
    byId.set(entry.id, entry);
  }
  return { byId, digest };
}

function assertApprovedHistoricalPayment(payment: any, expected: ApprovedHistoricalNoSessionPayment, companyId: string) {
  const actual = {
    tenantId: companyId,
    id: payment.id,
    commandId: payment.comandaId,
    origin: payment.comanda.origem,
    pointId: payment.comanda.pontoVendaId ?? null,
    eventId: payment.comanda.eventoId ?? null,
    commandTotalCents: cents(payment.comanda.total),
    commandClosedAt: payment.comanda.fechadaEm?.toISOString?.() ?? null,
    form: payment.forma,
    cents: cents(payment.valor),
    receivedCents: payment.valorRecebido == null ? null : cents(payment.valorRecebido),
    changeCents: payment.troco == null ? null : cents(payment.troco),
    paidAt: payment.pagoEm.toISOString(),
    registeredById: payment.registradoPorId ?? null,
    receivableId: payment.contaReceberId ?? null,
    operationalSessionId: payment.sessaoCaixaId ?? null,
    eventSessionId: payment.sessaoCaixaEventoId ?? null,
  };
  for (const [field, value] of Object.entries(actual)) {
    if (expected[field as keyof ApprovedHistoricalNoSessionPayment] !== value) {
      fail('FINANCE_HISTORICAL_APPROVAL_PAYLOAD_DIVERGED', 'PAGAMENTO', payment.id, `Campo autorizado ${field} difere da fotografia aprovada.`);
    }
  }
}
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
  const approval = validateHistoricalNoSessionApproval(input.historicalNoSessionApproval);
  if (input.historicalNoSessionApproval) {
    const expectedForTenant = input.historicalNoSessionApproval.entries.filter((entry) => entry.tenantId === input.companyId);
    const sourceIds = new Set(input.snapshot.payments.map((payment: any) => payment.id));
    const missing = expectedForTenant.find((entry) => !sourceIds.has(entry.id));
    if (missing) fail('FINANCE_HISTORICAL_APPROVAL_SOURCE_MISSING', 'PAGAMENTO', missing.id, 'Pagamento autorizado não existe na fotografia financeira do tenant.');
  }

  for (const debt of input.snapshot.debts) {
    commandCompanyAndPoint(debt.comanda, input, 'CONTA_RECEBER', debt.id);
    if (debt.cliente.cervejariaId !== input.companyId || debt.comandaId !== debt.comanda.id || debt.comanda.clienteId !== debt.clienteId) fail('FINANCE_DEBT_CLIENT_MISMATCH', 'CONTA_RECEBER', debt.id, 'Dívida, cliente e comanda não pertencem à mesma origem.');
    const data = debtFields(debt);
    items.push({ type: 'CONTA_RECEBER', id: debt.id, destinationType: 'CONTA_RECEBER', destinationId: debt.id,
      sourcePayload: jsonSafe(data), destinationData: data, dependencies: [input.confirmedPdvSourceKey, ...(debt.comanda.eventoId ? [sourceKey('EVENTO', debt.comanda.eventoId)] : [])] });
  }

  for (const payment of input.snapshot.payments) {
    commandCompanyAndPoint(payment.comanda, input, 'PAGAMENTO', payment.id);
    const approved = approval.byId.get(payment.id);
    if (approved && approved.tenantId === input.companyId) assertApprovedHistoricalPayment(payment, approved, input.companyId);
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
      if (!approved || approved.tenantId !== input.companyId || !input.historicalNoSessionApproval) {
        fail('FINANCE_PAYMENT_SESSION_MISSING', 'PAGAMENTO', payment.id, 'Pagamento imediato sem sessão persistida não pode ser associado por aproximação.');
      }
    }
    const source = paymentFields(payment);
    const isApprovedHistoricalNoSession = !eventSession && !cashSession && !payment.contaReceberId && approved?.tenantId === input.companyId;
    if (isApprovedHistoricalNoSession) source.provenienciaHistorica = null;
    const sourcePayload = eventSession ? { ...source, sessaoCaixaId: null } : source;
    const destinationData = { ...source, sessaoCaixaId: targetSessionId,
      provenienciaHistorica: isApprovedHistoricalNoSession ? 'CAIXA_NAO_COMPROVADA' : source.provenienciaHistorica };
    const migrationPayload = isApprovedHistoricalNoSession
      ? { ...sourcePayload, historicalDisposition: 'C_ORIGIN_UNPROVEN', approvalSnapshotSha256: approval.digest }
      : sourcePayload;
    items.push({ type: 'PAGAMENTO', id: payment.id, destinationType: 'PAGAMENTO', destinationId: payment.id,
      sourcePayload: jsonSafe(migrationPayload), destinationData, dependencies: [input.confirmedPdvSourceKey, ...(sessionDependency ? [sessionDependency] : []), ...(payment.contaReceberId ? [sourceKey('CONTA_RECEBER', payment.contaReceberId)] : [])] });
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
