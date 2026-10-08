import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { appendCutoverReceipt, readCutoverReceipts } from './pdv-unico-cutover-receipts.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'pdv-cutover-receipts-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

const row = (phase) => ({ runId: 'test-run-1234', tenantIds: ['cmr9yis3c0000hvu00q9fe7y1', 'cmsry9xrn0000hvlgopjxy0oo'], phase, status: 'PASS', result: { evidence: phase } });

test('receipt log is ordered, durable, and verifies its hash chain', () => {
  const file = path.join(root, 'receipts.jsonl');
  appendCutoverReceipt(file, row('minimal-prerequisite-migrations'));
  appendCutoverReceipt(file, row('business-catalog-transformations'));
  const receipts = readCutoverReceipts(file, { runId: 'test-run-1234', tenantIds: row('').tenantIds });
  assert.deepEqual(receipts.map(({ phase }) => phase), ['minimal-prerequisite-migrations', 'business-catalog-transformations']);
  assert.equal(readFileSync(file, 'utf8').endsWith('\n'), true);
});

test('receipt log rejects out-of-order appends, tampering, and incomplete final records', () => {
  const file = path.join(root, 'invalid.jsonl');
  assert.throws(() => appendCutoverReceipt(file, row('business-catalog-transformations')), /next confirmed/);
  appendCutoverReceipt(file, row('minimal-prerequisite-migrations'));
  const tampered = readFileSync(file, 'utf8').replace('"evidence":"minimal-prerequisite-migrations"', '"evidence":"changed"');
  const tamperedFile = path.join(root, 'tampered.jsonl');
  requireWrite(tamperedFile, tampered);
  assert.throws(() => readCutoverReceipts(tamperedFile, { runId: 'test-run-1234', tenantIds: row('').tenantIds }), /chain is invalid/);
  const incompleteFile = path.join(root, 'incomplete.jsonl');
  requireWrite(incompleteFile, readFileSync(file, 'utf8').trimEnd());
  assert.throws(() => readCutoverReceipts(incompleteFile, { runId: 'test-run-1234', tenantIds: row('').tenantIds }), /incomplete record/);
});

function requireWrite(file, contents) {
  writeFileSync(file, contents, 'utf8');
}
