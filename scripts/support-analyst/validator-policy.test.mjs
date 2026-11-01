import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUSTER_FORBIDDEN_PRIVILEGES,
  INDEX_FORBIDDEN_PRIVILEGES,
  evaluateLegacyFallbackEvidence,
  PROD_SOURCE_ALLOWLIST,
  getPrivilegeScope,
  resolveValidatorPolicy,
  resolveValidationPhase,
  validateProdFieldContract,
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

test('PROD privilege scope reads every PRD stream, including the audit journey (decision 2026-11-01)', () => {
  const scope = getPrivilegeScope('prd');
  assert.deepEqual(scope.allowed, ['quiver-tap-alert-events', 'logs-technical*.otel-prd*', 'logs-audit*.otel-prd*', 'traces-*.otel-prd*', 'metrics-*.otel-prd*', 'metrics-*.otel-infra*', 'logs-*.otel-infra*']);
  assert.ok(!scope.denied.includes('logs-audit*.otel-prd*'));
  assert.deepEqual(scope.optional, ['logs-*.otel-infra*']);
  assert.ok(scope.optional.every((pattern) => scope.allowed.includes(pattern)));
});

test('PROD privilege scope keeps DEV, the DEV alert index, system indices and catch-alls denied', () => {
  const scope = getPrivilegeScope('prd');
  for (const pattern of ['logs-technical*.otel-dev*', 'logs-audit*.otel-dev*', 'traces-*.otel-dev*', 'metrics-*.otel-dev*', 'quiver-tap-alert-events-dev', '.kibana*', '.security*', 'traces-*', 'metrics-*', 'logs-*']) {
    assert.ok(scope.denied.includes(pattern), pattern);
  }
  assert.ok(!scope.allowed.some((pattern) => /otel-dev|^\.|alert-events-dev/.test(pattern)));
  assert.ok(!scope.allowed.some((pattern) => scope.denied.includes(pattern)));
});

test('DEV privilege scope mirrors the DEV streams and denies PROD', () => {
  const scope = getPrivilegeScope('dev');
  assert.deepEqual(scope.allowed, ['quiver-tap-alert-events-dev', 'logs-audit*.otel-dev*', 'logs-technical*.otel-dev*', 'traces-*.otel-dev*', 'metrics-*.otel-dev*', 'metrics-*.otel-infra*']);
  for (const pattern of ['logs-technical*.otel-prd*', 'logs-audit*.otel-prd*', 'traces-*.otel-prd*', 'metrics-*.otel-prd*', 'quiver-tap-alert-events', '.kibana*', '.security*']) {
    assert.ok(scope.denied.includes(pattern), pattern);
  }
  assert.ok(!scope.allowed.some((pattern) => /otel-prd/.test(pattern)));
});

test('PRD read-only role descriptor matches the PRD scope and grants nothing else', async () => {
  const { readFile } = await import('node:fs/promises');
  const role = JSON.parse(await readFile(new URL('../../docs/support-analyst/prd-readonly-role.json', import.meta.url), 'utf8'));
  const descriptors = Object.values(role.role_descriptors);
  assert.equal(descriptors.length, 1);
  const [descriptor] = descriptors;
  assert.deepEqual(descriptor.cluster, []);
  assert.equal(descriptor.indices.length, 1);
  assert.deepEqual([...descriptor.indices[0].names].sort(), [...getPrivilegeScope('prd').allowed].sort());
  assert.deepEqual(descriptor.indices[0].privileges, ['read', 'view_index_metadata']);
  assert.equal(JSON.stringify(role).match(/"(?:encoded|api_key|password)"/), null);
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

test('PROD phase is explicit and fails closed when missing or invalid', () => {
  assert.equal(resolveValidationPhase({ environment: 'prd', argv: ['node', 'validator', '--phase=predeploy'], env: {} }), 'predeploy');
  assert.throws(() => resolveValidationPhase({ environment: 'prd', argv: ['node', 'validator'], env: {} }), /VALIDATION_PHASE_REQUIRED_FOR_PROD/);
  assert.throws(() => resolveValidationPhase({ environment: 'prd', argv: ['node', 'validator', '--phase=unknown'], env: {} }), /VALIDATION_PHASE_INVALID/);
});

test('DEV phase compatibility defaults safely to postdeploy', () => {
  assert.equal(resolveValidationPhase({ environment: 'dev', argv: ['node', 'validator'], env: {} }), 'postdeploy');
});

test('zero legacy fallback passes without legacy.kind materialization', () => {
  assert.deepEqual(evaluateLegacyFallbackEvidence({ hits: 0, kinds: [] }), {
    status: 'PASS', hits: 0, requiresKind: false, kinds: [],
  });
});

test('legacy fallback hits require allowed, complete classification', () => {
  assert.equal(evaluateLegacyFallbackEvidence({ hits: 2, kinds: ['cash_capability', 'operational_config'] }).status, 'PASS');
  assert.throws(() => evaluateLegacyFallbackEvidence({ hits: 1, kinds: [] }), /LEGACY_KIND_REQUIRED_FOR_FALLBACK/);
  assert.throws(() => evaluateLegacyFallbackEvidence({ hits: 1, kinds: ['unexpected'] }), /LEGACY_KIND_NOT_ALLOWED/);
});

test('PROD predeploy accepts unmapped future fields while postdeploy requires event action', () => {
  const stable = Object.fromEntries([
    '@timestamp', 'data_stream.dataset', 'data_stream.namespace',
    'resource.attributes.service.name', 'trace_id', 'span_id',
  ].map((field) => [field, { text: { searchable: true } }]));
  assert.doesNotThrow(() => validateProdFieldContract(stable, 'predeploy'));
  assert.throws(() => validateProdFieldContract(stable, 'postdeploy'), /attributes.event.action/);
  assert.doesNotThrow(() => validateProdFieldContract({ ...stable, 'attributes.event.action': { keyword: { searchable: true } } }, 'postdeploy'));
});
