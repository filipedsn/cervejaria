import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { assertReceiptInsideArtifacts } from './qa-evidence-location.mjs';

test('accepts the real repository artifacts path when the harness source is an export', () => {
  const workspace = path.resolve(process.cwd());
  const artifacts = path.join(workspace, 'artifacts');
  const receipt = path.join(artifacts, 'qc-20261015', 'admin-close-state-reconciliation.json');
  assert.equal(assertReceiptInsideArtifacts(receipt, artifacts), receipt);
});

test('rejects a receipt outside the configured artifacts root', () => {
  const workspace = path.resolve(process.cwd());
  const artifacts = path.join(workspace, 'artifacts');
  assert.throws(
    () => assertReceiptInsideArtifacts(path.join(workspace, 'backend', 'receipt.json'), artifacts),
    /QA_RECEIPT_OUTSIDE_ARTIFACTS_ROOT/,
  );
});
