import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { auditSnapshotModules, SYNTHETIC_EXPECTED_MODULES } from './pdv-unico-git-snapshot-import-audit.mjs';

const syntheticModules = [...SYNTHETIC_EXPECTED_MODULES.map((suffix) => `git-snapshot${suffix}`), path.join('git-snapshot', 'backend', 'scripts', 'pdv-unico-representative-qa.isolated.test.mjs')];

test('synthetic expected modules are still required when representative is blocked', () => {
  const result = auditSnapshotModules({ observedModules: syntheticModules, syntheticResult: 'PASS', representativeResult: 'BLOCKED', representativeAttempted: true });
  assert.equal(result.syntheticModules.result, 'PASS');
  assert.equal(result.representativeModules.result, 'ENTRYPOINT_OBSERVED');
});

test('synthetic modules stay required when representative did not run', () => {
  const result = auditSnapshotModules({ observedModules: SYNTHETIC_EXPECTED_MODULES.map((suffix) => `git-snapshot${suffix}`), syntheticResult: 'PASS', representativeResult: 'NOT_RUN', representativeAttempted: false });
  assert.equal(result.syntheticModules.result, 'PASS');
  assert.equal(result.representativeModules.result, 'NOT_RUN');
});

test('a blocked representative that did not reach its test entrypoint has no representative import expectation', () => {
  const observed = SYNTHETIC_EXPECTED_MODULES.map((suffix) => `git-snapshot${suffix}`);
  const result = auditSnapshotModules({ observedModules: observed, syntheticResult: 'PASS', representativeResult: 'BLOCKED', representativeAttempted: true });
  assert.equal(result.syntheticModules.result, 'PASS');
  assert.equal(result.representativeModules.result, 'NOT_REACHED');
  assert.equal(result.representativeModules.expectedCount, 0);
});

test('a missing synthetic module fails even when representative is blocked', () => {
  assert.throws(() => auditSnapshotModules({ observedModules: SYNTHETIC_EXPECTED_MODULES.slice(1).map((suffix) => `git-snapshot${suffix}`), syntheticResult: 'PASS', representativeResult: 'BLOCKED', representativeAttempted: true }), /synthetic modules/);
});

test('a successful representative run requires its entrypoint module', () => {
  assert.throws(() => auditSnapshotModules({ observedModules: SYNTHETIC_EXPECTED_MODULES.map((suffix) => `git-snapshot${suffix}`), syntheticResult: 'PASS', representativeResult: 'PASS', representativeAttempted: true }), /representative module/);
});
