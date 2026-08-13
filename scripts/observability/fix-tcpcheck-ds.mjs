#!/usr/bin/env node
/**
 * Clona mapping OTel do httpcheck e aplica template para tcpcheck.
 * Uso: node scripts/observability/fix-tcpcheck-ds.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const esBase = (process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200').replace(/\/$/, '');

function loadObservabilityEnv() {
  const envFile = path.join(root, 'deploy/observability/.env.observability');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && val && process.env[key] === undefined) process.env[key] = val;
  }
}

loadObservabilityEnv();

function esAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = process.env.ELASTIC_API_KEY?.trim() || process.env.ELASTIC_API_KEY_COLLECTOR?.trim();
  if (apiKey) {
    headers.Authorization = `ApiKey ${apiKey}`;
    return headers;
  }
  const user = process.env.ELASTIC_USER?.trim() || 'elastic';
  const pass = process.env.ELASTIC_PASSWORD?.trim();
  if (pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  return headers;
}

async function es(method, p, body) {
  const res = await fetch(`${esBase}${p}`, {
    method,
    headers: esAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

const mappingRes = await es('GET', '/metrics-httpcheckreceiver.otel-infra*/_mapping');
const indexName = Object.keys(mappingRes ?? {})[0];
if (!indexName || !mappingRes[indexName]?.mappings) {
  console.error('Mapping httpcheck indisponivel. Rode npm run obs:up primeiro.');
  process.exit(1);
}

const mappings = structuredClone(mappingRes[indexName].mappings);
delete mappings._data_stream_timestamp;

const ds = mappings.properties?.data_stream?.properties?.dataset;
if (ds) ds.value = 'tcpcheckreceiver.otel';

const metrics = mappings.properties?.metrics?.properties ?? {};
metrics['tcpcheck.duration'] = { type: 'long', time_series_metric: 'gauge' };
metrics['tcpcheck.error'] = { type: 'long', time_series_metric: 'counter' };
metrics['tcpcheck.status'] = { type: 'long', time_series_metric: 'gauge' };

const attrs = mappings.properties?.attributes?.properties ?? {};
attrs['tcpcheck.endpoint'] = {
  type: 'keyword',
  ignore_above: 1024,
  time_series_dimension: true,
};

const template = {
  index_patterns: ['metrics-tcpcheckreceiver.otel-infra*'],
  priority: 350,
  data_stream: {},
  template: {
    settings: { number_of_replicas: 0 },
    mappings,
  },
  _meta: {
    description: 'Quiver Tap OTel tcpcheck (cloned from httpcheck mapping)',
  },
};

const put = await es('PUT', '/_index_template/quiver-tcpcheck-otel-infra', template);
console.log('Template:', JSON.stringify(put));

const dsName = 'metrics-tcpcheckreceiver.otel-infra';
const exists = await es('GET', `/_data_stream/${dsName}`);
if (exists.data_streams?.length) {
  const del = await es('DELETE', `/_data_stream/${dsName}`);
  console.log('Data stream removido:', JSON.stringify(del));
} else {
  console.log('Data stream nao existia.');
}

console.log('\nReinicie o collector: npm run obs:up');
