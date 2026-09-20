import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTechnicalTelemetryRecord,
  emitTechnicalTelemetry,
  isLegacyFallbackKind,
} from './technical-telemetry-logger.js';

test('builds one routed, low-cardinality legacy fallback LogRecord', () => {
  const record = buildTechnicalTelemetryRecord({ action: 'legacy_fallback', legacyKind: 'operational_config' });
  assert.equal(record.body, 'legacy_fallback');
  assert.deepEqual(record.attributes, {
    'event.category': 'technical',
    'event.action': 'legacy_fallback',
    'event.outcome': 'success',
    'legacy.kind': 'operational_config',
    'data_stream.type': 'logs',
    'data_stream.dataset': 'technical',
    'data_stream.namespace': 'dev',
  });
});

test('only accepts the legacy-kind allowlist', () => {
  assert.equal(isLegacyFallbackKind('operational_config'), true);
  assert.equal(isLegacyFallbackKind('direct_sales_compat'), true);
  assert.equal(isLegacyFallbackKind('cash_capability'), true);
  assert.equal(isLegacyFallbackKind('email-address'), false);
});

test('builds a separately identifiable synthetic probe without a legacy label', () => {
  const record = buildTechnicalTelemetryRecord({ action: 'technical_telemetry_probe', probeId: 'probe-safe-001' });
  assert.equal(record.attributes['probe.id'], 'probe-safe-001');
  assert.equal(Object.hasOwn(record.attributes, 'legacy.kind'), false);
});

test('emits one record and keeps business execution fail-open', () => {
  const records: unknown[] = [];
  emitTechnicalTelemetry(
    { action: 'legacy_fallback', legacyKind: 'cash_capability' },
    { emit: (record) => records.push(record) },
  );
  assert.equal(records.length, 1);
  assert.doesNotThrow(() => emitTechnicalTelemetry(
    { action: 'legacy_fallback', legacyKind: 'cash_capability' },
    { emit: () => { throw new Error('collector unavailable'); } },
  ));
});
