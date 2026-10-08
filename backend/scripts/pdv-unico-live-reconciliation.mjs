import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DEV_PDV_TENANT_ALLOWLIST, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';

if (process.env.PDV_CUTOVER_PROFILE !== 'dev' || process.env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('Live reconciliation is restricted to the guarded DEV adapter.');
validateDevCutoverEnvironment(process.env);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const tenantIds = (process.env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
assert.deepEqual([...tenantIds].sort(), DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort());
const photoPath = path.resolve(process.env.PDV_REPRESENTATIVE_PHOTO_FILE ?? '');
const photoBytes = await readFile(photoPath);
const photoSha256 = createHash('sha256').update(photoBytes).digest('hex');
assert.equal(photoSha256, '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b');
const photo = JSON.parse(photoBytes.toString('utf8'));
const approval = JSON.parse(await readFile(path.join(backendRoot, 'scripts/pdv-unico-historical-no-session-approval.json'), 'utf8'));
const evidence = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-representative-dev-qa-evidence.json'), 'utf8'));
const approvalDigest = createHash('sha256').update(JSON.stringify(approval.entries)).digest('hex');
assert.equal(approvalDigest, '87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a');
assert.equal(approval.entries.length, 577);
const clientDir = path.resolve(process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Reconciliation Prisma client must be inside this run temp directory.');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, errorFormat: 'minimal' });
const cents = (value) => {
  const [whole, fraction = ''] = String(value).split('.');
  return (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
};
try {
  const sourceRows = (model) => photo.tableRows.find((table) => table.model === model)?.rows ?? [];
  const sourceCommands = new Map(sourceRows('Comanda').map((row) => [row.id, row]));
  const sourcePayments = sourceRows('Pagamento').filter((row) => tenantIds.includes(sourceCommands.get(row.comandaId)?.cervejariaId));
  const actualPayments = await db.pagamento.findMany({ where: { comanda: { cervejariaId: { in: tenantIds } } }, orderBy: { id: 'asc' }, include: { comanda: { select: { cervejariaId: true } } } });
  const expectedIds = sourcePayments.map((row) => row.id).sort();
  const actualIds = actualPayments.map((row) => row.id).sort();
  assert.deepEqual(actualIds, expectedIds, 'all selected-tenant payment IDs remain unchanged');
  assert.equal(actualPayments.length, 605, 'the original 605 payments remain present');
  const actualById = new Map(actualPayments.map((row) => [row.id, row]));
  const sourceById = new Map(sourcePayments.map((row) => [row.id, row]));
  const allCases = evidence.paymentSessionReview.allPaymentCases.filter((row) => tenantIds.includes(row.tenantId));
  assert.equal(allCases.length, 605, 'the pinned payment-session evidence must cover the exact original payment set');
  for (const review of allCases) {
    const id = review.paymentId;
    const source = sourceById.get(id);
    const actual = actualById.get(id);
    assert.ok(source && actual, `payment ${id} exists in both the approved source photo and destination`);
    for (const field of ['comandaId', 'contaReceberId', 'forma', 'registradoPorId']) assert.equal(actual[field] ?? null, source[field] ?? null, `payment ${id} ${field} preserved`);
    for (const field of ['valor', 'valorRecebido', 'troco']) assert.equal(actual[field] == null ? null : cents(actual[field]), source[field] == null ? null : cents(source[field]), `payment ${id} ${field} preserved in cents`);
    assert.equal(actual.pagoEm.toISOString(), new Date(source.pagoEm).toISOString(), `payment ${id} paidAt preserved`);
    if (review.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT') {
      assert.equal(actual.sessaoCaixaId, null); assert.equal(actual.sessaoCaixaEventoId, null); assert.equal(actual.provenienciaHistorica, 'CAIXA_NAO_COMPROVADA');
    } else if (review.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE') {
      assert.equal(actual.sessaoCaixaId, null); assert.equal(actual.provenienciaHistorica, null);
    } else {
      assert.equal(actual.sessaoCaixaId, source.sessaoCaixaId ?? source.sessaoCaixaEventoId);
      assert.equal(actual.sessaoCaixaEventoId, source.sessaoCaixaEventoId);
      assert.equal(actual.provenienciaHistorica, null);
    }
  }
  const cIds = approval.entries.map((row) => row.id).sort();
  const actualCIds = actualPayments.filter((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA').map((row) => row.id).sort();
  assert.deepEqual(actualCIds, cIds, 'only the same 577 approved class-C payment IDs carry unknown-session provenance');
  for (const id of cIds) {
    const row = actualById.get(id);
    assert.equal(row.sessaoCaixaId, null, `approved class-C payment ${id} has no inferred operational session`);
    assert.equal(row.sessaoCaixaEventoId, null, `approved class-C payment ${id} has no inferred event session`);
  }
  const expectedC = allCases.filter((row) => row.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT');
  const expectedA = allCases.filter((row) => row.classification === 'A_EXACT_SESSION_REFERENCE');
  const expectedB = allCases.filter((row) => row.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE');
  const unassigned = actualPayments.filter((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA');
  const sessionLinked = actualPayments.filter((row) => row.sessaoCaixaId !== null);
  const debtWithoutSession = actualPayments.filter((row) => row.contaReceberId !== null && row.sessaoCaixaId === null);
  assert.equal(unassigned.length, expectedC.length);
  assert.equal(sessionLinked.length, expectedA.length);
  assert.equal(debtWithoutSession.length, expectedB.length);
  assert.equal(unassigned.reduce((sum, row) => sum + BigInt(cents(row.valor)), 0n), expectedC.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  assert.equal(sessionLinked.reduce((sum, row) => sum + BigInt(cents(row.valor)), 0n), expectedA.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  assert.equal(debtWithoutSession.reduce((sum, row) => sum + BigInt(cents(row.valor)), 0n), expectedB.reduce((sum, row) => sum + BigInt(row.cents), 0n));
  const payments = {
    rows: actualPayments.length, sourceRows: sourcePayments.length, byFormCents: [...actualPayments.reduce((totals, row) => totals.set(row.forma, (totals.get(row.forma) ?? 0n) + BigInt(cents(row.valor))), new Map())].sort(([a], [b]) => a.localeCompare(b)).map(([form, total]) => [form, total.toString()]),
    approvedClassCPayments: actualCIds.length, approvedSetSha256: approvalDigest, status: 'PASS',
  };
  const products = [];
  for (const tenantId of tenantIds) {
    const baseline = sourceRows('Produto').filter((row) => row.cervejariaId === tenantId);
    const current = await db.produto.findMany({ where: { cervejariaId: tenantId }, select: { id: true, nome: true, categoria: true, categoriaPdvId: true } });
    assert.deepEqual(current.map((row) => row.id).sort(), baseline.map((row) => row.id).sort(), `tenant ${tenantId} product IDs/catalog preserved`);
    assert.equal(current.filter((row) => row.categoria?.trim() && !row.categoriaPdvId).length, 0, `tenant ${tenantId} historical category labels linked`);
    products.push({ tenantId, rows: current.length, status: 'PASS' });
  }
  const immutable = [];
  for (const model of ['TransacaoLog', 'ClienteEstatisticas']) {
    const baseline = sourceRows(model);
    const delegate = model[0].toLowerCase() + model.slice(1);
    const actual = await db[delegate].findMany({ where: { cervejariaId: { in: tenantIds } }, orderBy: { id: 'asc' } });
    assert.equal(actual.length, baseline.length, `${model} row count preserved`);
    const ids = new Set(actual.map((row) => row.id));
    assert.ok(baseline.every((row) => ids.has(row.id)), `${model} historical IDs preserved`);
    immutable.push({ model, rows: actual.length, status: 'PASS' });
  }
  const output = { status: 'PASS', photoSha256, tenants: tenantIds, payments, products, immutable, checkedAt: new Date().toISOString() };
  process.stdout.write(`${JSON.stringify(output)}\n`);
} finally { await db.$disconnect(); }
