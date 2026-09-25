import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectArchitecture, root } from './build-runtime-consumers.mjs';

test('checker detects the current legacy runtime regression', () => {
  const report = inspectArchitecture(root);
  assert.ok(report.activeRuntimeReferences > 0);
  assert.equal(report.gates.NO_ACTIVE_QUIOSQUE_DOMAIN, false);
  assert.equal(report.gates.ACTIVE_LEGACY_AUTHORITY, false);
  assert.ok(report.occurrences.some((item) => item.classification === 'PHYSICAL_DB_COMPATIBILITY'));
  assert.ok(report.occurrences.some((item) => item.classification === 'ACTIVE_RUNTIME'));
});

test('physical compatibility occurrences do not become active failures', () => {
  const report = inspectArchitecture(root);
  const excluded = report.occurrences.filter((item) => item.classification !== 'ACTIVE_RUNTIME');
  assert.ok(excluded.length > 0);
  assert.ok(excluded.every((item) => item.gate === 'EXCLUDED'));
});
