import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnalystConfig, requireRuntimeElasticsearchConfig } from '../src/config.js';

test('accepts structurally valid DEV configuration without requiring offline credentials', () => {
  const result = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_RUNTIME_DIR: 'deploy/runtime/support-analyst' });
  assert.equal(result.ok, true);
  assert.equal(result.config.environment, 'dev');
  assert.equal(result.config.elasticsearchApiKey, undefined);
});

test('accepts a valid API-key endpoint and rejects basic-auth URLs without exposing credentials', () => {
  const valid = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'https://elastic.example.test:9200' });
  assert.equal(valid.ok, true);
  const invalid = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'https://user:password@example.test:9200' });
  assert.deepEqual(invalid, { ok: false, reason: 'SUPPORT_ANALYST_ES_URL must be an HTTP(S) URL without user credentials' });
  assert.equal(invalid.reason.includes('password@example'), false);
});

test('rejects legacy and privileged credential environment variables', () => {
  const rejected = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_AGENT_ES_API_KEY: 'legacy-secret' });
  assert.equal(rejected.ok, false);
  const config = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', ELASTIC_USER: 'elastic', ELASTIC_PASSWORD: 'privileged', ELASTIC_API_KEY_COLLECTOR: 'collector-secret' });
  assert.deepEqual(config, { ok: false, reason: 'privileged Elasticsearch credentials are not accepted' });
});

test('TQ-SA-04 runtime is fail-closed for PRD even with a future-looking gate', () => {
  const structural = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'prd', SUPPORT_ANALYST_ES_URL: 'https://elastic.example.test', SUPPORT_ANALYST_ES_API_KEY: 'api-key-secret' });
  assert.equal(structural.ok, true);
  const blocked = requireRuntimeElasticsearchConfig(structural.config, { SUPPORT_ANALYST_ALLOW_PRD: 'true' });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked, { ok: false, reason: 'PRD access is not enabled for TQ-SA-04.' });
  assert.equal(blocked.reason.includes('api-key-secret'), false);
});

test('future runtime requires its exclusive URL and API key', () => {
  const structural = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'https://elastic.example.test' });
  assert.equal(structural.ok, true);
  assert.deepEqual(requireRuntimeElasticsearchConfig(structural.config, {}), {
    ok: false,
    reason: 'runtime Elasticsearch configuration requires SUPPORT_ANALYST_ES_URL and SUPPORT_ANALYST_ES_API_KEY'
  });
});
