import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUSTER_FORBIDDEN_PRIVILEGES,
  INDEX_FORBIDDEN_PRIVILEGES,
  PROD_SOURCE_ALLOWLIST,
  getPrivilegeScope,
  resolveValidatorPolicy,
} from './validator-policy.mjs';

const base = {
  SUPPORT_ANALYST_ES_API_KEY: 'synthetic-key',
  SUPPORT_ANALYST_ES_URL: 'https://elastic-dev.example',
};

test('DEV target with DEV credential is accepted', () => {
  assert.doesNotThrow(() => resolveValidatorPolicy({
    ...base,
    SUPPORT_ANALYST_ENV: 'dev',
    SUPPORT_ANALYST_CREDENTIAL_ENV: 'dev',
    SUPPORT_ANALYST_ENDPOINT_ENV: 'dev',
  }));
});

test('DEV credential cannot be used for PROD', () => {
  assert.throws(() => resolveValidatorPolicy({
    ...base,
    SUPPORT_ANALYST_ENV: 'prd',
    SUPPORT_ANALYST_ALLOW_PRD: 'true',
    SUPPORT_ANALYST_CREDENTIAL_ENV: 'dev',
    SUPPORT_ANALYST_ENDPOINT_ENV: 'prd',
    SUPPORT_ANALYST_ES_URL: 'https://elastic-prd.example',
  }), /PROD_DEV_CREDENTIAL_TARGET_MISMATCH/);
});

test('PROD requires explicit allow before credential evaluation', () => {
  assert.throws(() => resolveValidatorPolicy({ ...base, SUPPORT_ANALYST_ENV: 'prd' }), /PROD_ANALYST_EXPLICIT_ALLOW_REQUIRED/);
});

test('PROD with explicit allow and classification but no key fails closed', () => {
  assert.throws(() => resolveValidatorPolicy({
    SUPPORT_ANALYST_ENV: 'prd',
    SUPPORT_ANALYST_ALLOW_PRD: 'true',
    SUPPORT_ANALYST_CREDENTIAL_ENV: 'prd',
    SUPPORT_ANALYST_ENDPOINT_ENV: 'prd',
    SUPPORT_ANALYST_ES_URL: 'https://elastic-prd.example',
  }), /PROD_ANALYST_CREDENTIAL_MISSING/);
});

test('unknown target fails closed', () => {
  assert.throws(() => resolveValidatorPolicy({ ...base, SUPPORT_ANALYST_ENV: 'qa' }), /SUPPORT_ANALYST_ENV/);
});

test('PROD mode is resolvable only after explicit gates', () => {
  const policy = resolveValidatorPolicy({
    SUPPORT_ANALYST_ENV: 'prd',
    SUPPORT_ANALYST_ALLOW_PRD: 'true',
    SUPPORT_ANALYST_CREDENTIAL_ENV: 'prd',
    SUPPORT_ANALYST_ENDPOINT_ENV: 'prd',
    SUPPORT_ANALYST_ES_API_KEY: 'synthetic-key',
    SUPPORT_ANALYST_ES_URL: 'https://elastic-prd.example',
  });
  assert.equal(policy.environment, 'prd');
  assert.equal(policy.allowPrd, true);
});

test('PROD privilege scope allows only technical PROD and denies DEV sources', () => {
  const scope = getPrivilegeScope('prd');
  assert.deepEqual(scope.allowed, ['logs-technical*.otel-prd*']);
  assert.ok(scope.denied.includes('logs-technical*.otel-dev*'));
  assert.ok(scope.denied.includes('logs-audit*.otel-dev*'));
  assert.ok(scope.denied.includes('quiver-tap-alert-events-dev'));
  assert.ok(scope.denied.includes('logs-audit*.otel-prd*'));
  assert.ok(scope.denied.includes('traces-*'));
});

test('DEV privilege scope remains the existing DEV allowlist and denies PROD', () => {
  const scope = getPrivilegeScope('dev');
  assert.deepEqual(scope.allowed, ['quiver-tap-alert-events-dev', 'logs-audit*.otel-dev*', 'logs-technical*.otel-dev*']);
  assert.ok(scope.denied.includes('logs-technical*.otel-prd*'));
});

test('PROD source allowlist excludes functional and PII-bearing fields', () => {
  assert.deepEqual(PROD_SOURCE_ALLOWLIST, [
    '@timestamp',
    'data_stream.dataset',
    'data_stream.namespace',
    'resource.attributes.service.name',
    'attributes.event.action',
    'attributes.legacy.kind',
    'trace_id',
    'span_id',
  ]);
  assert.ok(!PROD_SOURCE_ALLOWLIST.some((field) => /actor|cervejaria|userId|role|http|reason|metadata/i.test(field)));
});

test('privilege inspection forbids every mutable/admin privilege', () => {
  assert.ok(INDEX_FORBIDDEN_PRIVILEGES.includes('write'));
  assert.ok(INDEX_FORBIDDEN_PRIVILEGES.includes('create_doc'));
  assert.ok(INDEX_FORBIDDEN_PRIVILEGES.includes('delete'));
  assert.ok(CLUSTER_FORBIDDEN_PRIVILEGES.includes('manage_security'));
  assert.ok(CLUSTER_FORBIDDEN_PRIVILEGES.includes('all'));
});
