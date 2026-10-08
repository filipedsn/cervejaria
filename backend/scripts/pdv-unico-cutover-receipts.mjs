import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { DEV_PDV_CUTOVER_SEQUENCE } from './pdv-unico-dev-cutover-core.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function readCutoverReceipts(filePath, { runId, tenantIds }) {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  if (text && !text.endsWith('\n')) throw new Error('Cutover receipt log ends with an incomplete record.');
  const records = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const expectedPhases = DEV_PDV_CUTOVER_SEQUENCE.slice(1);
  let previousHash = 'GENESIS';
  for (const [index, entry] of records.entries()) {
    const { sha256, ...body } = entry;
    if (body.previousSha256 !== previousHash || sha256 !== digest(body)
      || body.runId !== runId || JSON.stringify(body.tenantIds) !== JSON.stringify(tenantIds)
      || body.status !== 'PASS' || body.phase !== expectedPhases[index]) {
      throw new Error(`Cutover receipt chain is invalid at record ${index + 1}.`);
    }
    previousHash = sha256;
  }
  return records.map(({ sha256: _sha256, previousSha256: _previousSha256, ...row }) => row);
}

export function appendCutoverReceipt(filePath, row) {
  const completed = readCutoverReceipts(filePath, { runId: row.runId, tenantIds: row.tenantIds });
  const expectedPhase = DEV_PDV_CUTOVER_SEQUENCE.slice(1)[completed.length];
  if (row.status !== 'PASS' || row.phase !== expectedPhase) throw new Error('Only the next confirmed cutover phase may append a receipt.');
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8').trimEnd().split('\n').filter(Boolean).at(-1) : undefined;
  let previousSha256 = 'GENESIS';
  if (previous) {
    const parsed = JSON.parse(previous);
    previousSha256 = parsed.sha256;
  }
  const body = { ...row, previousSha256 };
  const entry = { ...body, sha256: digest(body) };
  const descriptor = openSync(filePath, 'a');
  try {
    writeSync(descriptor, `${JSON.stringify(entry)}\n`, undefined, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return entry.sha256;
}
