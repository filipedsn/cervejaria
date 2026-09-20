import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveValidatorPolicy } from './validator-policy.mjs';

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
