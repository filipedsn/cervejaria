import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeEndpoint, createRequest, parseArgs, specsForTarget, streamsForTarget } from './apply-retention.mjs';

test('prd com --apply exige --confirm-prd e argumentos sao validados', () => {
  assert.throws(() => parseArgs(['--target', 'prd', '--apply']), /confirm-prd/);
  assert.equal(parseArgs(['--target', 'prd', '--apply', '--confirm-prd']).apply, true);
  assert.throws(() => parseArgs(['--target', 'dev', '--rollover']), /exige --apply/);
  assert.throws(() => parseArgs([]), /--target/);
  assert.throws(() => parseArgs(['--target', 'dev', '--force']), /desconhecido/);
});

test('specs e streams sao filtrados por alvo', () => {
  assert.ok(specsForTarget('prd').every((spec) => spec.namespace === 'prd' || spec.namespace === 'infra'));
  assert.ok(specsForTarget('prd').some((spec) => spec.name === 'quiver-tap-audit-prd'));
  assert.ok(specsForTarget('dev').every((spec) => spec.namespace === 'dev' || spec.namespace === 'infra'));
  assert.deepEqual(
    streamsForTarget(['metrics-generic.otel-prd', 'logs-audit.otel-dev', 'metrics-httpcheckreceiver.otel-infra', '.kibana'], 'prd'),
    ['metrics-generic.otel-prd', 'metrics-httpcheckreceiver.otel-infra'],
  );
});

test('alvo prd recusa localhost e alvo dev recusa host remoto', () => {
  assert.throws(() => assertSafeEndpoint('http://localhost:9200', 'prd'), /localhost/);
  assert.throws(() => assertSafeEndpoint('http://10.0.0.5:9200', 'dev'), /localhost/);
  assert.doesNotThrow(() => assertSafeEndpoint('http://10.0.0.5:9200', 'prd'));
  assert.doesNotThrow(() => assertSafeEndpoint('http://127.0.0.1:9200', 'dev'));
});

test('request nunca executa DELETE', async () => {
  const request = createRequest('http://es.test', {}, async () => { throw new Error('nao deveria chamar a rede'); });
  await assert.rejects(request('/x', undefined, false, 'DELETE'), /nunca executa DELETE/);
});
