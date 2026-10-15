import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { assertClassCSourceMatchesApproval, validateClassCAuthorization } from './pdv-class-c-authorization.mjs';

const dbUrl = process.env.PDV_QA_DATABASE_URL;
const originBackupSha256 = process.env.PDV_QA_ORIGIN_BACKUP_SHA256;
const approvalPath = process.env.PDV_QA_CLASS_C_APPROVAL_PATH;
const receiptPath = process.env.PDV_QA_CLASS_C_VALIDATION_RECEIPT;
const sourceEntriesPath = process.env.PDV_QA_CLASS_C_SOURCE_ENTRIES_PATH;
if (!dbUrl || !originBackupSha256 || !approvalPath || !receiptPath || !sourceEntriesPath) throw new Error('QA database, backup digest, protected authorization, source snapshot and receipt path are required.');
const parsed = new URL(dbUrl);
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55449'
  || parsed.pathname !== '/cervejaria_qa_pdv_unico' || decodeURIComponent(parsed.username) !== 'postgres') {
  throw new Error('Only the named loopback disposable QA database is permitted.');
}
const approvalBytes = await readFile(approvalPath);
const approval = JSON.parse(approvalBytes.toString('utf8').replace(/^\uFEFF/, ''));
const auth = validateClassCAuthorization({ mode: 'qa', approval, originBackupSha256 });
const container = process.env.PDV_QA_CONTAINER ?? '';
if (container !== 'tapq-adminfreeze-20261015-002') throw new Error('Only the named disposable QA container is permitted.');
const toCents = (value) => {
  if (value == null) return null;
  const raw = String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error('QA source payment contains an amount outside the currency scale.');
  return `${match[1] === '-' ? '-' : ''}${(BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))).toString()}`;
};
// PostgreSQL stores the two legacy audit timestamps as timestamp without time zone;
// this application persists UTC wall time there, so only those values gain a Z.
const iso = (value) => {
  if (value == null) return null;
  const raw = String(value);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasZone ? raw : `${raw}Z`).toISOString();
};
const ids = approval.entries.map(({ id }) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Approval contains an unsafe SQL identifier.');
  return `('${id.replaceAll("'", "''")}')`;
});
const query = `WITH approved_ids(id) AS (VALUES ${ids.join(',')}), source AS (
  SELECT p."id", p."comandaId" AS "commandId", c."origem" AS "origin",
    c."pontoVendaId" AS "pointId", c."eventoId" AS "eventId", c."total" AS "commandTotal",
    c."fechadaEm" AS "commandClosedAt", p."forma" AS "form", p."valor" AS "centsValue",
    p."valorRecebido" AS "receivedValue", p."troco" AS "changeValue", p."pagoEm" AS "paidAt",
    p."registradoPorId" AS "registeredById", p."contaReceberId" AS "receivableId",
    p."sessaoCaixaId" AS "operationalSessionId", p."sessaoCaixaEventoId" AS "eventSessionId",
    COALESCE(e."cervejariaId", pv."cervejariaId") AS "tenantId"
  FROM public."Pagamento" p JOIN public."Comanda" c ON c."id"=p."comandaId"
  LEFT JOIN public."Evento" e ON e."id"=c."eventoId"
  LEFT JOIN quiosque."PontoVenda" pv ON pv."id"=c."pontoVendaId"
  JOIN approved_ids a ON a.id=p."id"
)
SELECT COALESCE(json_agg(source), '[]'::json) FROM source;`;
const psql = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'cervejaria_qa_pdv_unico'], { input: query, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
if (psql.status !== 0) throw new Error(`QA source snapshot query failed: ${(psql.stderr ?? '').slice(-1000)}`);
const queried = JSON.parse(psql.stdout.trim());
const sourceEntries = queried.map((row) => ({
    tenantId: row.tenantId,
    id: row.id,
    commandId: row.commandId,
    origin: row.origin,
    pointId: row.pointId,
    eventId: row.eventId,
    commandTotalCents: toCents(row.commandTotal),
    commandClosedAt: iso(row.commandClosedAt),
    form: row.form,
    cents: toCents(row.centsValue),
    receivedCents: toCents(row.receivedValue),
    changeCents: toCents(row.changeValue),
    paidAt: iso(row.paidAt),
    registeredById: row.registeredById,
    receivableId: row.receivableId,
    operationalSessionId: row.operationalSessionId,
    eventSessionId: row.eventSessionId,
    classification: 'C_ORIGIN_UNPROVEN',
}));
const source = assertClassCSourceMatchesApproval({ approval, sourceEntries });
const sourceEntriesBytes = Buffer.from(`${JSON.stringify(sourceEntries, null, 2)}\n`, 'utf8');
await writeFile(sourceEntriesPath, sourceEntriesBytes, { flag: 'wx' });
const receipt = {
    status: 'PASS',
    mode: 'QA_ONLY',
    originBackupSha256,
    approvalFileSha256: createHash('sha256').update(approvalBytes).digest('hex'),
    count: source.count,
    payloadSha256: source.payloadSha256,
    idsSha256: source.idsSha256,
    sourceEntriesFileSha256: createHash('sha256').update(sourceEntriesBytes).digest('hex'),
    transformerInvoked: false,
    validatedAt: new Date().toISOString(),
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify(receipt)}\n`);
