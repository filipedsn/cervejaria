import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDevElasticTarget, assertElasticTarget } from './elastic-target-guard.mjs';

test('accepts an explicit DEV target and DEV-only datasets', () => {
  assert.doesNotThrow(() => assertDevElasticTarget({ environment: 'dev', baseUrl: 'http://elastic-dev.internal:9200', indexPatterns: ['logs-audit*.otel-dev*', 'quiver-tap-alert-events-dev'] }));
});
test('rejects a PRD target before a request can be made', () => {
  assert.throws(() => assertDevElasticTarget({ environment: 'dev', baseUrl: 'https://elastic-prd.internal', indexPatterns: [] }), /bloqueado/);
});
test('rejects production datasets even when URL looks local', () => {
  assert.throws(() => assertDevElasticTarget({ environment: 'dev', baseUrl: 'http://localhost:9200', indexPatterns: ['logs-audit*.otel-prd*'] }), /Dataset/);
});
test('accepts an explicit PROD technical target', () => {
  assert.doesNotThrow(() => assertElasticTarget({ environment: 'prd', baseUrl: 'https://elastic-prd.internal', indexPatterns: ['logs-technical*.otel-prd*'] }));
});

test('accepts the full PRD read scope: audit, traces, metrics, infra and the PRD alert index', () => {
  assert.doesNotThrow(() => assertElasticTarget({ environment: 'prd', baseUrl: 'https://elastic-prd.internal', indexPatterns: ['quiver-tap-alert-events', 'logs-audit*.otel-prd*', 'traces-*.otel-prd*', 'metrics-*.otel-prd*', 'metrics-*.otel-infra*', 'logs-*.otel-infra*'] }));
  assert.doesNotThrow(() => assertElasticTarget({ environment: 'dev', baseUrl: 'http://127.0.0.1:9200', indexPatterns: ['quiver-tap-alert-events-dev', 'traces-*.otel-dev*', 'metrics-*.otel-dev*', 'metrics-*.otel-infra*'] }));
});

test('PRD cannot use the DEV alert index or any DEV stream, and DEV cannot use PRD', () => {
  for (const pattern of ['quiver-tap-alert-events-dev', 'logs-audit*.otel-dev*', 'traces-*.otel-dev*', 'logs-*otel-dev*.otel-prd*']) {
    assert.throws(() => assertElasticTarget({ environment: 'prd', baseUrl: 'https://elastic-prd.internal', indexPatterns: [pattern] }), /allowlist/, pattern);
  }
  assert.throws(() => assertElasticTarget({ environment: 'dev', baseUrl: 'http://127.0.0.1:9200', indexPatterns: ['quiver-tap-alert-events'] }), /allowlist/);
});

test('system indices and catch-all patterns are rejected in both environments', () => {
  for (const environment of ['dev', 'prd']) {
    for (const pattern of ['.kibana*', '.security*', '*', 'logs-*', 'metrics-*', 'traces-*']) {
      assert.throws(() => assertElasticTarget({ environment, baseUrl: environment === 'dev' ? 'http://127.0.0.1:9200' : 'https://elastic-prd.internal', indexPatterns: [pattern] }), /allowlist/, `${environment} ${pattern}`);
    }
  }
});
