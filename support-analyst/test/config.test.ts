import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnalystConfig, readTelegramConfig, readWatchConfig, requireRuntimeElasticsearchConfig } from '../src/config.js';

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

test('PRD runtime requires all three markers and refuses a loopback endpoint', () => {
  const structural = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'prd', SUPPORT_ANALYST_ES_URL: 'https://elastic.example.test', SUPPORT_ANALYST_ES_API_KEY: 'api-key-secret' });
  if (!structural.ok) throw new Error('structural config should be valid');
  const noAllow = requireRuntimeElasticsearchConfig(structural.config, {});
  assert.deepEqual(noAllow, { ok: false, reason: 'PRD requires SUPPORT_ANALYST_ALLOW_PRD=true' });
  const noMarkers = requireRuntimeElasticsearchConfig(structural.config, { SUPPORT_ANALYST_ALLOW_PRD: 'true' });
  assert.deepEqual(noMarkers, { ok: false, reason: 'PRD requires SUPPORT_ANALYST_CREDENTIAL_ENV=prd and SUPPORT_ANALYST_ENDPOINT_ENV=prd' });
  assert.equal(JSON.stringify(noMarkers).includes('api-key-secret'), false);
  const markers = { SUPPORT_ANALYST_ALLOW_PRD: 'true', SUPPORT_ANALYST_CREDENTIAL_ENV: 'prd', SUPPORT_ANALYST_ENDPOINT_ENV: 'prd' };
  assert.equal(requireRuntimeElasticsearchConfig(structural.config, markers).ok, true);
  const local = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'prd', SUPPORT_ANALYST_ES_URL: 'http://127.0.0.1:9200', SUPPORT_ANALYST_ES_API_KEY: 'k' });
  if (!local.ok) throw new Error('structural config should be valid');
  assert.equal(requireRuntimeElasticsearchConfig(local.config, markers).ok, false);
});

test('DEV runtime only accepts the local Elasticsearch', () => {
  const remote = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'https://elastic.example.test', SUPPORT_ANALYST_ES_API_KEY: 'k' });
  if (!remote.ok) throw new Error('structural config should be valid');
  assert.deepEqual(requireRuntimeElasticsearchConfig(remote.config, {}), { ok: false, reason: 'DEV runtime must target the local Elasticsearch (localhost or 127.0.0.1)' });
  const local = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'http://localhost:9200', SUPPORT_ANALYST_ES_API_KEY: 'k' });
  if (!local.ok) throw new Error('structural config should be valid');
  assert.equal(requireRuntimeElasticsearchConfig(local.config, {}).ok, true);
});

test('watch and telegram config defaults and invalid values', () => {
  const watch = readWatchConfig({}, 'prd');
  if (!watch.ok) throw new Error('default watch config should be valid');
  assert.equal(watch.config.enabled, false);
  assert.equal(watch.config.publicUrl, 'https://tap.quivercloud.com.br');
  assert.equal(watch.config.intervalMs, 60_000);
  assert.equal(watch.config.digestHour, 8);
  assert.equal(watch.config.bootQuietMinutes, 10);
  assert.equal(watch.config.kibanaUrl, undefined);
  assert.equal(readWatchConfig({ SUPPORT_ANALYST_PUBLIC_URL: 'http://tap.quivercloud.com.br' }, 'prd').ok, false);
  assert.equal(readWatchConfig({ SUPPORT_ANALYST_DIGEST_HOUR: '24' }, 'prd').ok, false);
  assert.equal(readWatchConfig({ SUPPORT_ANALYST_WATCH_INTERVAL_MS: '1000' }, 'prd').ok, false);
  assert.equal(readWatchConfig({ SUPPORT_ANALYST_BOOT_QUIET_MINUTES: '-1' }, 'prd').ok, false);
  assert.equal(readWatchConfig({ SUPPORT_ANALYST_KIBANA_URL: 'https://user:pw@kibana.test' }, 'prd').ok, false);
  const devWatch = readWatchConfig({ SUPPORT_ANALYST_KIBANA_URL: 'http://localhost:5601/' }, 'dev');
  if (!devWatch.ok) throw new Error('default dev watch config should be valid');
  assert.equal(devWatch.config.publicUrl, 'http://127.0.0.1:3002');
  assert.equal(devWatch.config.kibanaUrl, 'http://localhost:5601');
  assert.deepEqual(readTelegramConfig({}), { ok: true, config: { enabled: false, dryRun: true, botToken: undefined, chatId: undefined, maxPerHour: 20 } });
  assert.equal(readTelegramConfig({ SUPPORT_ANALYST_TELEGRAM_ENABLED: 'true', SUPPORT_ANALYST_TELEGRAM_DRY_RUN: 'false' }).ok, false);
  assert.equal(readTelegramConfig({ SUPPORT_ANALYST_TELEGRAM_MAX_PER_HOUR: '0' }).ok, false);
});

test('future runtime requires its exclusive URL and API key', () => {
  const structural = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'dev', SUPPORT_ANALYST_ES_URL: 'https://elastic.example.test' });
  assert.equal(structural.ok, true);
  assert.deepEqual(requireRuntimeElasticsearchConfig(structural.config, {}), {
    ok: false,
    reason: 'runtime Elasticsearch configuration requires SUPPORT_ANALYST_ES_URL and SUPPORT_ANALYST_ES_API_KEY'
  });
});
