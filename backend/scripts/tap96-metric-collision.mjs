import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const mode = process.argv[2];
if (!['baseline', 'corrected'].includes(mode)) throw new Error('Use baseline or corrected');
const es = 'http://127.0.0.1:19296';
const otlp = 'http://127.0.0.1:14318';
const instance = `tap96-${mode}-${Date.now()}`;
for (let i = 0; ; i++) {
  try { const r = await fetch(`${es}/_cluster/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) break; } catch {}
  if (i >= 20) throw new Error('Isolated ES did not become ready');
  await new Promise(r => setTimeout(r, 1000));
}
const timestamp = String(BigInt(Date.now()) * 1_000_000n);
const resource = { attributes: Object.entries({ 'service.name': 'quiver-tap-api-dev', 'service.instance.id': instance,
  'deployment.environment.name': 'development', 'data_stream.namespace': 'dev' }).map(([key, stringValue]) => ({ key, value: { stringValue } })) };
for (const [name, asDouble] of [['tap96.collision.first', 1], ['tap96.collision.second', 2]]) {
  const response = await fetch(`${otlp}/v1/metrics`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceMetrics: [{ resource, scopeMetrics: [{ scope: { name: 'tap96-collision' },
      metrics: [{ name, gauge: { dataPoints: [{ timeUnixNano: timestamp, asDouble }] } }] }] }] }) });
  assert.equal(response.status, 200);
  await new Promise(r => setTimeout(r, 2000));
}
await fetch(`${es}/metrics-*/_refresh`, { method: 'POST' });
const response = await fetch(`${es}/metrics-*/_search`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ size: 10, query: { term: { 'resource.attributes.service.instance.id': instance } } }) });
const data = await response.json();
const documents = data.hits?.hits?.map(hit => hit._source) ?? [];
mkdirSync('../artifacts/tap96', { recursive: true });
writeFileSync(`../artifacts/tap96/collision-${mode}.json`, JSON.stringify({ mode, timestamp, documents, searchStatus: response.status }, null, 2));
console.log(JSON.stringify({ mode, documents: documents.length, expected: mode === 'baseline' ? 1 : 2 }));
assert.equal(documents.length, mode === 'baseline' ? 1 : 2);
