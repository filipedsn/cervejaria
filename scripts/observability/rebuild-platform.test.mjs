import assert from 'node:assert/strict';
import test from 'node:test';
import { isResettableStream, retentionSpecifications, rebuildPlatform, ensureMetricsFingerprint } from './rebuild-platform.mjs';
test('reset excludes system, malformed, wildcard and unrelated streams', () => {
  assert(isResettableStream('logs-audit_customer.otel-dev'));
  for (const name of ['.kibana_8', '.security-7', '*', 'logs-*', 'logs-audit.otel-dev,.security', 'metrics-system-default', 'logs-audit.otel-production']) assert(!isResettableStream(name));
  assert.equal(retentionSpecifications().length, 10);
  assert(retentionSpecifications().every(s => s.retention > 0 && s.retention <= 30));
});
test('rebuild requires explicit discard authorization before issuing requests', async () => {
  let called = false;
  await assert.rejects(rebuildPlatform(async () => { called = true; }, { targets: ['logs-audit.otel-dev'] }, ''), /authorization/);
  assert.equal(called, false);
});
test('templates retain managed components and deletion targets exact owned inventory', async () => {
  const calls = [];
  const plan = { targets: ['logs-audit.otel-dev'], specifications: retentionSpecifications().slice(0,1), bases: { logs: { composed_of: ['otel@mappings'], data_stream: {}, template: { settings: {} } } }, protected: 'system' };
  const result = await rebuildPlatform(async (...args) => { calls.push(args); return args[0].startsWith('/_component_template') && !args[3] ? { httpStatus: 404 } : { acknowledged: true }; }, plan, 'DISCARD_CURRENT_OTEL_HISTORY');
  const templateCall = calls.find(c => c[0].startsWith('/_index_template/'));
  assert.deepEqual(templateCall[1].composed_of, ['otel@mappings']);
  assert.equal(templateCall[1].template.settings.index.lifecycle.name, plan.specifications[0].name);
  assert.deepEqual(calls.filter(c => c[3] === 'DELETE').map(c => c[0]), ['/_data_stream/logs-audit.otel-dev']);
  assert.equal(result.deleted.length, 1);
});
test('metrics compatibility mapping preserves independent custom fields', async () => {
  let applied;
  await ensureMetricsFingerprint(async (path, body) => {
    if (!body) return { component_templates: [{ component_template: { template: { mappings: { properties: { existing: { type: 'keyword' } } } } } }] };
    applied = body; return { acknowledged: true };
  });
  assert.equal(applied.template.mappings.properties.existing.type, 'keyword');
  assert.equal(applied.template.mappings.properties._metric_names_hash.time_series_dimension, true);
});
