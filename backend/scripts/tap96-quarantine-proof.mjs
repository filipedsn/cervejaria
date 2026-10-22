import assert from 'node:assert/strict';
const marker = `tap96-unknown-${Date.now()}`;
const timeUnixNano = String(BigInt(Date.now()) * 1_000_000n);
const payload = { resourceLogs: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: marker } }] },
  scopeLogs: [{ scope: { name: 'tap96-quarantine' }, logRecords: [{ timeUnixNano, body: { stringValue: marker },
    attributes: [{ key: 'data_stream.namespace', value: { stringValue: 'prd' } }] }] }] }] };
const response = await fetch('http://127.0.0.1:14318/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
assert.equal(response.status, 200);
let hits = [];
for (let i = 0; i < 20; i++) {
  const r = await fetch('http://127.0.0.1:19296/logs-*/_search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: { term: { 'resource.attributes.service.name': marker } } }) });
  hits = (await r.json()).hits?.hits ?? [];
  if (hits.length) break;
  await new Promise(r => setTimeout(r, 500));
}
assert.equal(hits.length, 1);
console.log(JSON.stringify({ marker, indexedIn: hits[0]._index, namespace: hits[0]._source.data_stream.namespace }));
assert.equal(hits[0]._source.data_stream.namespace, 'quarantine', 'payload cannot override the quarantine of an unidentified resource');
