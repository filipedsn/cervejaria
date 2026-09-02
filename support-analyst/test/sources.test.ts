import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnalystConfig } from '../src/config.js';
import { ElasticReadOnlyClient, ElasticSourceError, ElasticsearchSources, normalizeBatch } from '../src/index.js';

const range = { from: '2026-08-31T12:00:00.000Z', to: '2026-08-31T13:00:00.000Z' };
type Call = { url: string; init?: RequestInit };

function fake(response: Response | (() => Promise<Response>), calls: Call[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return typeof response === 'function' ? response() : response.clone();
  };
}
function hit(index = 'logs-audit.otel-dev-000001', id = 'event-1') {
  return { _index: index, _id: id, _source: { '@timestamp': '2026-08-31T12:01:00Z', attributes: { correlationId: 'corr-01' } } };
}
function validResponse(...hits: unknown[]) { return new Response(JSON.stringify({ hits: { hits } }), { status: 200, headers: { 'content-type': 'application/json' } }); }
function body(call: Call) { return JSON.parse(String(call.init?.body)); }

test('findAlertEvents has a mandatory range, predictable cursor, bounded size and source filter', async () => {
  const calls: Call[] = [];
  const source = new ElasticsearchSources(new ElasticReadOnlyClient('https://elastic.test/', 'secret-key', fake(validResponse(hit('quiver-tap-alert-events-dev', 'alert-1')), calls)));
  const docs = await source.findAlertEvents({ range, limit: 2, cursor: ['2026-08-31T12:01:00.000Z', 'alert-0'] });
  assert.equal(docs[0]?.sourceType, 'alert');
  assert.equal(calls[0]?.url, 'https://elastic.test/quiver-tap-alert-events-dev/_search?ignore_unavailable=true');
  assert.deepEqual(body(calls[0]!).query, { range: { '@timestamp': { gte: range.from, lte: range.to } } });
  assert.equal(body(calls[0]!).size, 2);
  assert.deepEqual(body(calls[0]!).search_after, ['2026-08-31T12:01:00.000Z']);
  assert.deepEqual(body(calls[0]!).sort, [{ '@timestamp': 'asc' }]);
  assert.equal(body(calls[0]!)._source.includes('reason'), true);
  assert.equal(body(calls[0]!)._source.includes('processed'), false);
});

test('pilot preflight is a strict bounded read that detects a missing approved index without a write probe', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const sources = new ElasticsearchSources(new ElasticReadOnlyClient('https://elastic.test', 'safe-key', async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 }); }));
  await sources.preflightAlertSource({ from: '2026-09-02T12:00:00.000Z', to: '2026-09-02T12:01:00.000Z' });
  assert.equal(calls[0]?.url, 'https://elastic.test/quiver-tap-alert-events-dev/_search');
  assert.equal(calls[0]?.init?.method, 'POST');
});

test('exact lookup templates query only approved DEV audit and technical patterns with keyword terms', async () => {
  const calls: Call[] = [];
  const source = new ElasticsearchSources(new ElasticReadOnlyClient('https://elastic.test', 'secret-key', fake(validResponse(hit()), calls)));
  await source.findByCorrelationId('corr-01', { range, limit: 3 });
  await source.findByRequestId('request-01', { range, limit: 3 });
  await source.findByTraceId('trace-01', { range, limit: 3 });
  await source.findByReleaseAndService({ releaseSha: 'release-01', service: 'quiver-api', range, limit: 3 });
  assert.equal(calls.length, 8);
  assert.ok(calls.every((call) => /logs-(audit|technical)\*\.otel-dev\*/.test(call.url)));
  assert.deepEqual(body(calls[0]!).query.bool.filter[1], { term: { 'attributes.correlationId.keyword': 'corr-01' } });
  assert.deepEqual(body(calls[2]!).query.bool.filter[1], { term: { 'attributes.requestId.keyword': 'request-01' } });
  assert.deepEqual(body(calls[4]!).query.bool.filter[1], { term: { 'trace_id.keyword': 'trace-01' } });
  assert.deepEqual(body(calls[6]!).query.bool.filter.slice(1), [{ term: { 'attributes.releaseSha.keyword': 'release-01' } }, { term: { 'attributes.service.keyword': 'quiver-api' } }]);
  assert.ok(calls.every((call) => body(call)._source.includes('body') === false));
  assert.ok(calls.every((call) => body(call).timeout === '5s'));
});

test('fallback source templates use a bounded explicit window and reject unlimited or unsafe input', async () => {
  const calls: Call[] = [];
  const source = new ElasticsearchSources(new ElasticReadOnlyClient('https://elastic.test', 'secret-key', fake(validResponse(hit()), calls)));
  await source.findAuditAround({ timestamp: '2026-08-31T12:00:00Z', windowMinutes: 5, limit: 1 });
  await source.findTechnicalAround({ timestamp: '2026-08-31T12:00:00Z', windowMinutes: 15, limit: 1 });
  assert.equal(calls.length, 2);
  await assert.rejects(async () => source.findAuditAround({ timestamp: 'not-a-date', windowMinutes: 5 }), ElasticSourceError);
  await assert.rejects(async () => source.findTechnicalAround({ timestamp: '2026-08-31T12:00:00Z', windowMinutes: 16 }), ElasticSourceError);
  await assert.rejects(async () => source.findByCorrelationId('not valid spaces', { range }), ElasticSourceError);
  await assert.rejects(async () => source.findAlertEvents({ range, limit: 51 }), ElasticSourceError);
  await assert.rejects(async () => source.findAlertEvents({ range: { from: range.to, to: range.from } }), ElasticSourceError);
});

test('HTTP source errors are classified, malformed responses fail closed, and credentials never enter errors', async () => {
  for (const [status, kind] of [[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate_limited']] as const) {
    const client = new ElasticReadOnlyClient('https://elastic.test', 'top-secret-api-key', async () => new Response('{}', { status }));
    await assert.rejects(client.search('x', {}), (error: unknown) => error instanceof ElasticSourceError && error.kind === kind && !error.message.includes('top-secret-api-key'));
  }
  const malformed = new ElasticsearchSources(new ElasticReadOnlyClient('https://elastic.test', 'secret', async () => validResponse({ _index: 'x' })));
  await assert.rejects(malformed.findAlertEvents({ range }), (error: unknown) => error instanceof ElasticSourceError && error.kind === 'malformed_response');
  const timeout = new ElasticReadOnlyClient('https://elastic.test', 'secret', async () => { throw new DOMException('aborted', 'TimeoutError'); });
  await assert.rejects(timeout.search('x', {}), (error: unknown) => error instanceof ElasticSourceError && error.kind === 'timeout');
});

test('source output is RawEventDocument only and normalization failures are counted without stopping the batch', async () => {
  const source = new ElasticsearchSources(new ElasticReadOnlyClient('https://elastic.test', 'secret', async () => validResponse(hit(), { _index: 'x', _id: 'bad', _source: {} })));
  const raw = await source.findAlertEvents({ range });
  assert.deepEqual(Object.keys(raw[0]!).sort(), ['id', 'index', 'source', 'sourceType']);
  const batch = normalizeBatch(raw);
  assert.deepEqual({ received: batch.received, normalized: batch.normalized, rejected: batch.rejected, rejectedReasons: batch.rejectedReasons }, { received: 2, normalized: 1, rejected: 1, rejectedReasons: { missing_timestamp: 1 } });
});

test('PRD source construction is blocked regardless of SUPPORT_ANALYST_ALLOW_PRD', () => {
  const config = readAnalystConfig({ SUPPORT_ANALYST_ENV: 'prd', SUPPORT_ANALYST_ES_URL: 'https://elastic.test', SUPPORT_ANALYST_ES_API_KEY: 'secret' });
  assert.equal(config.ok, true);
  assert.throws(() => ElasticsearchSources.fromConfig(config.config, { SUPPORT_ANALYST_ALLOW_PRD: 'true' }), /PRD access is not enabled for TQ-SA-04/);
});
