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
