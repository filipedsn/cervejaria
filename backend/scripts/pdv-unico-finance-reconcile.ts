import { PdvCatalogBlocker, canonicalPdvPayloadHash } from './pdv-unico-catalog-transform.js';

type Db = any;
type Item = { type: string; id: string; destinationData: Record<string, any> };

function cents(value: unknown): bigint {
  if (value == null) return 0n;
  const text = String(value);
  const match = /^(-?)(\d+)\.(\d{1,2})$/.exec(text) ?? /^(-?)(\d+)$/.exec(text);
  if (!match) throw new PdvCatalogBlocker('FINANCE_DECIMAL_UNSUPPORTED', null, null, 'Valor financeiro sem escala decimal comprovada.');
  return (match[1] === '-' ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0')));
}

function add(group: Map<string, bigint>, key: string, value: unknown) { group.set(key, (group.get(key) ?? 0n) + cents(value)); }
function sorted(group: Map<string, bigint>) { return [...group.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value.toString()]); }

/** Monetary comparison excludes closure counts: counted cash is not a payment. */
export function financeReconciliationDigest(payments: any[], debts: any[], movements: any[]) {
  const byForm = new Map<string, bigint>();
  const bySession = new Map<string, bigint>();
  const byDebt = new Map<string, bigint>();
  const movementBySessionAndType = new Map<string, bigint>();
  for (const row of payments) {
    add(byForm, row.forma, row.valor);
    add(bySession, row.sessaoCaixaId ?? 'NO_SESSION', row.valor);
    if (row.contaReceberId) add(byDebt, row.contaReceberId, row.valor);
  }
  for (const row of movements) add(movementBySessionAndType, `${row.sessaoId}:${row.tipo}`, row.valor);
  return {
    paymentIds: payments.map((row) => row.id).sort(), paymentCount: payments.length,
    paymentRows: payments.map((row) => ({ id: row.id, comandaId: row.comandaId, contaReceberId: row.contaReceberId,
      sessaoCaixaId: row.sessaoCaixaId, sessaoCaixaEventoId: row.sessaoCaixaEventoId,
      forma: row.forma, valorCentavos: cents(row.valor).toString(),
      recebidoCentavos: row.valorRecebido == null ? null : cents(row.valorRecebido).toString(),
      trocoCentavos: row.troco == null ? null : cents(row.troco).toString(),
      registradoPorId: row.registradoPorId, pagoEm: row.pagoEm })).sort((a, b) => a.id.localeCompare(b.id)),
    byForm: sorted(byForm), bySession: sorted(bySession),
    debtIds: debts.map((row) => row.id).sort(), debtCount: debts.length,
    debtRows: debts.map((row) => ({ id: row.id, comandaId: row.comandaId, clienteId: row.clienteId,
      principalCentavos: cents(row.valorOriginal).toString(),
      recebidoCentavos: (byDebt.get(row.id) ?? 0n).toString(),
      saldoCentavos: (cents(row.valorOriginal) - (byDebt.get(row.id) ?? 0n)).toString(),
      criadoPorId: row.criadoPorId, createdAt: row.createdAt })).sort((a, b) => a.id.localeCompare(b.id)),
    movementIds: movements.map((row) => row.id).sort(), movementCount: movements.length,
    movementRows: movements.map((row) => ({ id: row.id, sessaoId: row.sessaoId, tipo: row.tipo,
      valorCentavos: cents(row.valor).toString(), observacao: row.observacao, registradoPorId: row.registradoPorId,
      correcaoDeId: row.correcaoDeId, naturezaCorrecao: row.naturezaCorrecao, motivoCorrecao: row.motivoCorrecao,
      autorizadoPorId: row.autorizadoPorId, solicitadoPorId: row.solicitadoPorId,
      corrigidoEm: row.corrigidoEm, createdAt: row.createdAt })).sort((a, b) => a.id.localeCompare(b.id)),
    movementBySessionAndType: sorted(movementBySessionAndType),
  };
}

export async function reconcilePdvFinance(tx: Db, items: Item[]) {
  const byType = (types: string[]) => items.filter((item) => types.includes(item.type));
  const paymentItems = byType(['PAGAMENTO']);
  const debtItems = byType(['CONTA_RECEBER']);
  const movementItems = byType(['MOVIMENTO_CAIXA_OPERACAO', 'MOVIMENTO_CAIXA_EVENTO']);
  const [payments, debts, movements] = await Promise.all([
    tx.pagamento.findMany({ where: { id: { in: paymentItems.map((item) => item.id) } } }),
    tx.contaReceber.findMany({ where: { id: { in: debtItems.map((item) => item.id) } } }),
    tx.movimentoCaixaOperacao.findMany({ where: { id: { in: movementItems.map((item) => item.id) } } }),
  ]);
  const expected = financeReconciliationDigest(paymentItems.map((item) => item.destinationData), debtItems.map((item) => item.destinationData), movementItems.map((item) => item.destinationData));
  const actual = financeReconciliationDigest(payments, debts, movements);
  if (canonicalPdvPayloadHash(expected) !== canonicalPdvPayloadHash(actual)) throw new PdvCatalogBlocker('FINANCE_RECONCILIATION_DIVERGED', null, null, 'IDs, valores, recebimentos, saldos ou correções divergem da fotografia financeira.');
  return { paymentCount: payments.length, debtCount: debts.length, movementCount: movements.length, byForm: actual.byForm,
    bySession: actual.bySession, debts: actual.debtRows.map((row) => ({ id: row.id, principalCentavos: row.principalCentavos, recebidoCentavos: row.recebidoCentavos, saldoCentavos: row.saldoCentavos })) };
}
