import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DEV_PDV_TENANT_ALLOWLIST, validateDevCutoverEnvironment } from './pdv-unico-dev-cutover-core.mjs';
import { expectedMigratedPaymentSessionReferences } from './pdv-unico-payment-session-evidence.mjs';
import { canonicalTransacaoLogRows, compareTransacaoLogRows } from './pdv-unico-transacao-log-comparison.mjs';

if (process.env.PDV_CUTOVER_PROFILE !== 'dev' || process.env.PDV_CUTOVER_DEV_ADAPTER !== '1') throw new Error('Live reconciliation is restricted to the guarded DEV adapter.');
validateDevCutoverEnvironment(process.env);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const tenantIds = (process.env.PDV_CUTOVER_TENANTS ?? '').split(',').filter(Boolean);
if (JSON.stringify([...tenantIds].sort()) !== JSON.stringify(DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id).sort())) throw new Error('Reconciliation requires the complete approved tenant allowlist.');
const photoPath = path.resolve(process.env.PDV_REPRESENTATIVE_PHOTO_FILE ?? '');
const photoBytes = await readFile(photoPath);
const photoSha256 = createHash('sha256').update(photoBytes).digest('hex');
if (photoSha256 !== '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b') throw new Error('Approved source photo hash mismatch.');
const photo = JSON.parse(photoBytes.toString('utf8'));
const approval = JSON.parse(await readFile(path.join(backendRoot, 'scripts/pdv-unico-historical-no-session-approval.json'), 'utf8'));
const evidence = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-representative-dev-qa-evidence.json'), 'utf8'));
const approvalDigest = createHash('sha256').update(JSON.stringify(approval.entries)).digest('hex');
if (approvalDigest !== '87e3a8f6aca3e878a027c485ca2e15a120ba9cc0edfc27337e3f39858165ef7a' || approval.entries.length !== 577) throw new Error('Historical payment authorization evidence changed.');
const clientDir = path.resolve(process.env.PDV_CUTOVER_PRISMA_CLIENT ?? '');
const tempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? '');
if (!clientDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error('Reconciliation Prisma client must be inside this run temp directory.');
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, errorFormat: 'minimal' });
const auditEvidenceFile = path.resolve(process.env.PDV_CUTOVER_AUDIT_EVIDENCE_FILE ?? '');
const receiptsRoot = path.join(process.env.LOCALAPPDATA ?? process.env.USERPROFILE ?? '', 'TAP Quiver', 'pdv-cutover-receipts');
if (!auditEvidenceFile || path.dirname(auditEvidenceFile) !== path.resolve(receiptsRoot)) throw new Error('Pre-cutover audit evidence must be stored beside this run’s durable receipts.');
const auditEvidenceBytes = await readFile(auditEvidenceFile);
const auditEvidence = JSON.parse(auditEvidenceBytes.toString('utf8'));
const auditEvidenceSha256 = createHash('sha256').update(auditEvidenceBytes).digest('hex');
const auditRunId = process.env.PDV_CUTOVER_RUN_ID;
const approvedBackupSha256 = process.env.PDV_CUTOVER_BACKUP_SHA256;
const auditDatabaseUrl = new URL(process.env.PDV_CUTOVER_AUDIT_DATABASE_URL ?? '');
const destinationDatabaseUrl = new URL(process.env.DATABASE_URL);
if (auditEvidence.status !== 'PASS' || auditEvidence.runId !== auditRunId || auditEvidence.backupSha256 !== approvedBackupSha256
  || auditEvidence.differenceCount !== 0 || !/^cervejaria_restore_drill_audit_[a-z0-9_]+$/i.test(auditEvidence.recoveryDatabase ?? '')
  || auditDatabaseUrl.pathname.slice(1) !== auditEvidence.recoveryDatabase
  || auditDatabaseUrl.protocol !== destinationDatabaseUrl.protocol || auditDatabaseUrl.hostname !== destinationDatabaseUrl.hostname
  || auditDatabaseUrl.port !== destinationDatabaseUrl.port || auditDatabaseUrl.username !== destinationDatabaseUrl.username
  || auditDatabaseUrl.password !== destinationDatabaseUrl.password) throw new Error('Pre-cutover TransacaoLog audit evidence does not match this run, backup, or isolated DEV recovery database.');
const auditDb = new PrismaClient({ datasources: { db: { url: auditDatabaseUrl.toString() } }, errorFormat: 'minimal' });
const sourceRows = (model) => photo.tableRows.find((table) => table.model === model)?.rows ?? [];
const dateValue = (value) => value instanceof Date ? value.toISOString() : value?.$photoType === 'date' ? new Date(value.value).toISOString() : value;
const canonicalValue = (value) => {
  const normalized = dateValue(value);
  if (normalized !== value) return normalized;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalValue(child)]));
  return value;
};
const cents = (value) => {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid decimal representation: ${text}`);
  if ((match[3] ?? '').length > 2 && /[^0]/.test(match[3].slice(2))) throw new Error(`Unexpected fractional precision: ${text}`);
  const amount = BigInt(match[2]) * 100n + BigInt(((match[3] ?? '') + '00').slice(0, 2));
  return (match[1] ? -amount : amount).toString();
};
const normalizeRow = (row, decimalFields = []) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [
  key,
  decimalFields.includes(key) && value != null ? { decimalCents: cents(value) } : canonicalValue(value),
]));
const ownerFromReferences = ({ origem, eventoId, pontoVendaId, clienteId }, maps, context) => {
  const refs = [];
  for (const [kind, id, map] of [['Evento', eventoId, maps.eventos], ['PontoVenda', pontoVendaId, maps.pontos], ['Cliente', clienteId, maps.clientes]]) {
    if (id == null) continue;
    const row = map.get(id);
    if (!row) return { tenantId: null, error: `${context}: ${kind} ${id} is referenced but absent from the approved source photo.` };
    refs.push({ kind, id, tenantId: row.cervejariaId });
  }
  const requiredKind = origem === 'EVENTO' ? 'Evento' : origem === 'CAIXA' ? 'PontoVenda' : null;
  if (!requiredKind) return { tenantId: null, refs, error: `${context}: unsupported comanda origin ${origem}.` };
  if (!refs.some(({ kind }) => kind === requiredKind)) return { tenantId: null, refs, error: `${context}: ${origem} comanda has no ${requiredKind} ownership reference.` };
  const owners = [...new Set(refs.map(({ tenantId }) => tenantId))];
  if (owners.length !== 1) return { tenantId: null, refs, error: `${context}: contradictory ownership references ${JSON.stringify(refs)}.` };
  return { tenantId: owners[0], refs };
};
const collectMismatch = (list, check, message, details) => { if (!check) list.push({ message, ...(details === undefined ? {} : { details }) }); };
async function emitEvidence(report) {
  const evidenceFile = process.env.PDV_CUTOVER_RECONCILIATION_EVIDENCE_FILE;
  if (evidenceFile) {
    const receiptsRoot = path.join(process.env.LOCALAPPDATA ?? process.env.USERPROFILE ?? '', 'TAP Quiver', 'pdv-cutover-receipts');
    if (path.dirname(path.resolve(evidenceFile)) !== path.resolve(receiptsRoot)) throw new Error('Reconciliation evidence must be written beside the durable DEV cutover receipts.');
    report.evidenceFile = evidenceFile;
    await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

try {
  const errors = [];
  const maps = {
    eventos: new Map(sourceRows('Evento').map((row) => [row.id, row])),
    pontos: new Map(sourceRows('PontoVenda').map((row) => [row.id, row])),
    clientes: new Map(sourceRows('Cliente').map((row) => [row.id, row])),
  };
  const sourceCommands = new Map(sourceRows('Comanda').map((row) => [row.id, row]));
  const sourceOwners = new Map();
  for (const row of sourceCommands.values()) {
    const owner = ownerFromReferences(row, maps, `source comanda ${row.id}`);
    sourceOwners.set(row.id, owner);
    if (owner.error && (row.eventoId || row.pontoVendaId || row.clienteId)) errors.push({ message: owner.error });
  }
  const sourcePayments = [];
  for (const payment of sourceRows('Pagamento')) {
    const command = sourceCommands.get(payment.comandaId);
    if (!command) { errors.push({ message: `source payment ${payment.id} references absent comanda ${payment.comandaId}.` }); continue; }
    const owner = sourceOwners.get(command.id);
    if (owner?.error && (command.eventoId || command.pontoVendaId || command.clienteId)) continue;
    if (tenantIds.includes(owner?.tenantId)) sourcePayments.push(payment);
  }
  const actualPayments = await db.pagamento.findMany({
    where: { OR: [
      { comanda: { evento: { is: { cervejariaId: { in: tenantIds } } } } },
      { comanda: { pontoVenda: { is: { cervejariaId: { in: tenantIds } } } } },
      { comanda: { cliente: { is: { cervejariaId: { in: tenantIds } } } } },
    ] },
    orderBy: { id: 'asc' },
    include: { comanda: { select: { id: true, origem: true, eventoId: true, pontoVendaId: true, clienteId: true,
      evento: { select: { cervejariaId: true } }, pontoVenda: { select: { cervejariaId: true } }, cliente: { select: { cervejariaId: true } } } } },
  });
  const destinationOwner = (command, id) => {
    const refs = [['Evento', command.eventoId, command.evento?.cervejariaId], ['PontoVenda', command.pontoVendaId, command.pontoVenda?.cervejariaId], ['Cliente', command.clienteId, command.cliente?.cervejariaId]]
      .filter(([, referenceId]) => referenceId != null).map(([kind, referenceId, tenantId]) => ({ kind, id: referenceId, tenantId }));
    const required = command.origem === 'EVENTO' ? 'Evento' : command.origem === 'CAIXA' ? 'PontoVenda' : null;
    const owners = [...new Set(refs.map(({ tenantId }) => tenantId).filter(Boolean))];
    if (!required || !refs.some(({ kind }) => kind === required) || owners.length !== 1 || refs.some(({ tenantId }) => !tenantId)) {
      errors.push({ message: `destination comanda ${id} has missing/contradictory tenant ownership.`, details: { origem: command.origem, refs } });
      return null;
    }
    return owners[0];
  };
  const expectedIds = sourcePayments.map(({ id }) => id).sort();
  const actualIds = actualPayments.map(({ id }) => id).sort();
  collectMismatch(errors, JSON.stringify(actualIds) === JSON.stringify(expectedIds), 'selected-tenant payment ID set differs from approved source photo.', { expected: expectedIds.length, actual: actualIds.length });
  collectMismatch(errors, actualPayments.length === 605, 'the original 605 payments are not all present.', { actual: actualPayments.length });
  const actualById = new Map(actualPayments.map((row) => [row.id, row]));
  const sourceById = new Map(sourcePayments.map((row) => [row.id, row]));
  const expectedCases = evidence.paymentSessionReview.allPaymentCases.filter((row) => tenantIds.includes(row.tenantId));
  collectMismatch(errors, expectedCases.length === 605, 'pinned payment-session evidence does not cover exactly the original 605 selected-tenant payments.', { actual: expectedCases.length });
  for (const payment of actualPayments) {
    const owner = destinationOwner(payment.comanda, payment.id);
    collectMismatch(errors, tenantIds.includes(owner), `payment ${payment.id} comanda resolves outside selected tenant set.`, { owner });
  }
  for (const review of expectedCases) {
    const { paymentId: id } = review;
    const source = sourceById.get(id);
    const actual = actualById.get(id);
    collectMismatch(errors, Boolean(source && actual), `payment ${id} exists in both source photo and destination.`);
    if (!source || !actual) continue;
    for (const field of ['comandaId', 'contaReceberId', 'forma', 'registradoPorId']) collectMismatch(errors, (actual[field] ?? null) === (source[field] ?? null), `payment ${id} ${field} preserved.`, { expected: source[field] ?? null, actual: actual[field] ?? null });
    for (const field of ['valor', 'valorRecebido', 'troco']) collectMismatch(errors, actual[field] == null ? source[field] == null : source[field] != null && cents(actual[field]) === cents(source[field]), `payment ${id} ${field} preserved in cents.`);
    collectMismatch(errors, dateValue(actual.pagoEm) === dateValue(source.pagoEm), `payment ${id} pagoEm preserved.`);
    if (review.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT') {
      collectMismatch(errors, actual.sessaoCaixaId == null && actual.sessaoCaixaEventoId == null && actual.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA', `approved class-C payment ${id} remains unassigned with the exact historical marker.`);
    } else if (review.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE') {
      collectMismatch(errors, actual.sessaoCaixaId == null && actual.sessaoCaixaEventoId == null && actual.provenienciaHistorica == null, `class-B payment ${id} retains null session and provenance.`);
    } else {
      const expectedSessions = expectedMigratedPaymentSessionReferences(review);
      collectMismatch(errors, actual.sessaoCaixaId === expectedSessions.operationalId && actual.sessaoCaixaEventoId === expectedSessions.eventId && actual.provenienciaHistorica == null, `class-A payment ${id} retains its exact mapped session references.`);
    }
  }
  const approvedIds = approval.entries.map(({ id }) => id).sort();
  const actualApprovedIds = actualPayments.filter(({ provenienciaHistorica }) => provenienciaHistorica === 'CAIXA_NAO_COMPROVADA').map(({ id }) => id).sort();
  collectMismatch(errors, JSON.stringify(actualApprovedIds) === JSON.stringify(approvedIds), 'only the same 577 authorized class-C payment IDs carry unknown-session provenance.', { expected: approvedIds.length, actual: actualApprovedIds.length });
  for (const id of approvedIds) {
    const row = actualById.get(id);
    collectMismatch(errors, Boolean(row && row.sessaoCaixaId == null && row.sessaoCaixaEventoId == null), `approved class-C payment ${id} has no inferred operational session.`);
  }
  const expectedC = expectedCases.filter((row) => row.classification === 'C_NO_SESSION_PROVENANCE_INSUFFICIENT');
  const expectedA = expectedCases.filter((row) => row.classification === 'A_EXACT_SESSION_REFERENCE');
  const expectedB = expectedCases.filter((row) => row.classification === 'B_HISTORICAL_NO_SESSION_PROVENANCE');
  const actualC = actualPayments.filter((row) => row.provenienciaHistorica === 'CAIXA_NAO_COMPROVADA');
  const sessionLinked = actualPayments.filter((row) => row.sessaoCaixaId !== null);
  const debtWithoutSession = actualPayments.filter((row) => row.contaReceberId !== null && row.sessaoCaixaId === null);
  collectMismatch(errors, actualC.length === expectedC.length && sessionLinked.length === expectedA.length && debtWithoutSession.length === expectedB.length,
    'payment session classification counts changed.', { actual: { classC: actualC.length, sessionLinked: sessionLinked.length, debtWithoutSession: debtWithoutSession.length }, expected: { classC: expectedC.length, sessionLinked: expectedA.length, debtWithoutSession: expectedB.length } });
  for (const [label, actual, expected] of [['class-C', actualC, expectedC], ['class-A', sessionLinked, expectedA], ['class-B', debtWithoutSession, expectedB]]) {
    const expectedCents = expected.reduce((sum, row) => sum + BigInt(row.cents), 0n);
    const actualCents = actual.reduce((sum, row) => sum + BigInt(cents(row.valor)), 0n);
    collectMismatch(errors, actualCents === expectedCents, `${label} payment value total preserved in cents.`, { expected: expectedCents.toString(), actual: actualCents.toString() });
  }

  const products = [];
  for (const tenantId of tenantIds) {
    const baseline = sourceRows('Produto').filter((row) => row.cervejariaId === tenantId);
    const current = await db.produto.findMany({ where: { cervejariaId: tenantId }, select: { id: true, nome: true, categoria: true, categoriaPdvId: true } });
    collectMismatch(errors, JSON.stringify(current.map(({ id }) => id).sort()) === JSON.stringify(baseline.map(({ id }) => id).sort()), `tenant ${tenantId} product IDs/catalog preserved.`);
    collectMismatch(errors, current.filter(({ categoria, categoriaPdvId }) => categoria?.trim() && !categoriaPdvId).length === 0, `tenant ${tenantId} historical category labels linked.`);
    products.push({ tenantId, rows: current.length });
  }
  const immutable = [];
  const photoLogs = sourceRows('TransacaoLog').filter(({ cervejariaId }) => tenantIds.includes(cervejariaId));
  const [backupLogs, actualLogs] = await Promise.all([
    auditDb.transacaoLog.findMany({ where: { cervejariaId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
    db.transacaoLog.findMany({ where: { cervejariaId: { in: tenantIds } }, orderBy: { id: 'asc' } }),
  ]);
  const photoLogIds = photoLogs.map(({ id, cervejariaId }) => `${cervejariaId}\0${id}`).sort();
  const backupLogIds = backupLogs.map(({ id, cervejariaId }) => `${cervejariaId}\0${id}`).sort();
  collectMismatch(errors, JSON.stringify(photoLogIds) === JSON.stringify(backupLogIds), 'pre-cutover backup TransacaoLog IDs and tenants match the approved photo identity set.', { photoRows: photoLogIds.length, backupRows: backupLogIds.length });
  const logComparison = compareTransacaoLogRows(backupLogs, actualLogs);
  collectMismatch(errors, logComparison.differences.length === 0, 'complete pre-cutover TransacaoLog content, including metadata, is preserved.', { differenceCount: logComparison.differences.length, differences: logComparison.differences });
  const backupTenantEvidence = auditEvidence.tenants?.filter(({ tenantId }) => tenantIds.includes(tenantId)) ?? [];
  collectMismatch(errors, backupTenantEvidence.length === tenantIds.length
    && tenantIds.every((tenantId) => backupTenantEvidence.find(({ tenantId: id }) => id === tenantId)?.backupRows === backupLogs.filter((row) => row.cervejariaId === tenantId).length),
  'restored audit evidence covers both selected tenants and all their original logs.');
  const logContentHashes = {
    backupSha256: createHash('sha256').update(JSON.stringify(canonicalTransacaoLogRows(backupLogs))).digest('hex'),
    devSha256: createHash('sha256').update(JSON.stringify(canonicalTransacaoLogRows(actualLogs))).digest('hex'),
  };
  immutable.push({ model: 'TransacaoLog', key: 'id', rows: actualLogs.length, backupRows: backupLogs.length,
    comparedFields: Object.keys(backupLogs[0] ?? {}).length, source: 'pre-cutover DEV backup including metadata',
    backupContentSha256: logContentHashes.backupSha256, devContentSha256: logContentHashes.devSha256,
    auditEvidenceSha256, status: logComparison.differences.length ? 'BLOCKED' : 'CHECKED' });
  const sourceStats = sourceRows('ClienteEstatisticas').filter(({ clienteId }) => tenantIds.includes(maps.clientes.get(clienteId)?.cervejariaId));
  const actualStats = await db.clienteEstatisticas.findMany({ where: { cliente: { is: { cervejariaId: { in: tenantIds } } } }, orderBy: { clienteId: 'asc' }, include: { cliente: { select: { cervejariaId: true } } } });
  for (const [model, baseline, actual, key, decimals] of [
    ['ClienteEstatisticas', sourceStats, actualStats.map(({ cliente, ...row }) => row), 'clienteId', ['totalGasto']],
  ]) {
    const before = new Map(baseline.map((row) => [row[key], row]));
    const after = new Map(actual.map((row) => [row[key], row]));
    collectMismatch(errors, before.size === baseline.length && after.size === actual.length, `${model} key uniqueness preserved.`);
    collectMismatch(errors, JSON.stringify([...after.keys()].sort()) === JSON.stringify([...before.keys()].sort()), `${model} ${key} key set preserved.`, { expected: before.size, actual: after.size });
    for (const [id, source] of before) {
      const current = after.get(id);
      if (!current) continue;
      collectMismatch(errors, JSON.stringify(normalizeRow(source, decimals)) === JSON.stringify(normalizeRow(current, decimals)), `${model} ${key} ${id} complete historical content preserved.`, { expected: normalizeRow(source, decimals), actual: normalizeRow(current, decimals) });
    }
    immutable.push({ model, key, rows: actual.length, comparedFields: Object.keys(baseline[0] ?? {}).length, status: 'CHECKED' });
  }
  const payments = {
    rows: actualPayments.length, sourceRows: sourcePayments.length, approvedClassCPayments: actualApprovedIds.length,
    approvedSetSha256: approvalDigest, expectedPaymentIdsSha256: createHash('sha256').update(expectedIds.join('\n')).digest('hex'),
    status: errors.length ? 'BLOCKED' : 'PASS',
  };
  if (errors.length) {
    await emitEvidence({ status: 'BLOCKED', photoSha256, backupSha256: approvedBackupSha256, auditEvidenceSha256, tenants: tenantIds, payments, products, immutable, divergenceCount: errors.length, divergences: errors, checkedAt: new Date().toISOString() });
    process.exitCode = 2;
  } else {
    await emitEvidence({ status: 'PASS', photoSha256, backupSha256: approvedBackupSha256, auditEvidenceSha256, tenants: tenantIds, payments, products: products.map((row) => ({ ...row, status: 'PASS' })), immutable: immutable.map((row) => ({ ...row, status: 'PASS' })), checkedAt: new Date().toISOString() });
  }
} finally { await Promise.all([db.$disconnect(), auditDb.$disconnect()]); }
