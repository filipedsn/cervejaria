#!/usr/bin/env node
// Aplica ILM + templates de retencao (NUNCA executa DELETE).
// Uso: node scripts/observability/apply-retention.mjs --target dev|prd [--apply] [--rollover] [--confirm-prd]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyRetentionTemplates, ensureMetricsFingerprint, retentionSpecifications } from './rebuild-platform.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv) {
  const args = { target: undefined, apply: false, rollover: false, confirmPrd: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') { args.target = argv[i + 1]; i += 1; }
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--rollover') args.rollover = true;
    else if (arg === '--confirm-prd') args.confirmPrd = true;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (args.target !== 'dev' && args.target !== 'prd') throw new Error('Use --target dev ou --target prd');
  if (args.rollover && !args.apply) throw new Error('--rollover exige --apply');
  if (args.target === 'prd' && args.apply && !args.confirmPrd) throw new Error('Mutacao em PRD exige --confirm-prd (e GATE autorizado)');
  return args;
}

export function readEnvFile(path) {
  if (!existsSync(path)) throw new Error(`Arquivo de ambiente ausente: ${path}`);
  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) value = value.slice(1, -1);
    env[line.slice(0, eq).trim()] = value;
  }
  return env;
}

export function specsForTarget(target) {
  const namespaces = target === 'prd' ? ['prd', 'infra'] : ['dev', 'infra'];
  return retentionSpecifications().filter((spec) => namespaces.includes(spec.namespace));
}

export function streamsForTarget(names, target) {
  const pattern = target === 'prd'
    ? /^(logs|metrics|traces)-[a-zA-Z0-9_.-]+\.otel-(prd|infra)$/
    : /^(logs|metrics|traces)-[a-zA-Z0-9_.-]+\.otel-(dev|infra)$/;
  return names.filter((name) => pattern.test(name)).sort();
}

export function assertSafeEndpoint(url, target) {
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  if (target === 'prd' && loopback) throw new Error('Alvo PRD nao pode apontar para localhost (isso e o DEV).');
  if (target === 'dev' && !loopback) throw new Error('Alvo DEV precisa apontar para localhost.');
}

export function createRequest(baseUrl, env, fetchImpl = fetch) {
  const headers = { 'content-type': 'application/json' };
  if (env.ELASTIC_API_KEY) headers.authorization = `ApiKey ${env.ELASTIC_API_KEY}`;
  else if (env.ELASTIC_PASSWORD) headers.authorization = `Basic ${Buffer.from(`${env.ELASTIC_USER || 'elastic'}:${env.ELASTIC_PASSWORD}`).toString('base64')}`;
  return async function request(path, body, allowFail = false, method = body === undefined ? 'GET' : 'POST') {
    if (method === 'DELETE') throw new Error('apply-retention nunca executa DELETE');
    const response = await fetchImpl(baseUrl.replace(/\/$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!response.ok) {
      if (allowFail || response.status === 404) return { ...json, httpStatus: response.status };
      throw new Error(`Elasticsearch ${method} ${path} -> HTTP ${response.status}`);
    }
    return json;
  };
}

export async function main(argv, { fetchImpl = fetch, log = console.log } = {}) {
  const args = parseArgs(argv);
  const envFile = join(root, 'deploy', 'observability', args.target === 'prd' ? '.env.observability.prd' : '.env.observability');
  const env = readEnvFile(envFile);
  const baseUrl = env.ELASTICSEARCH_URL || (args.target === 'dev' ? 'http://localhost:9200' : '');
  if (!baseUrl) throw new Error('ELASTICSEARCH_URL obrigatorio no alvo PRD');
  assertSafeEndpoint(baseUrl, args.target);
  const request = createRequest(baseUrl, env, fetchImpl);
  const specifications = specsForTarget(args.target);
  const inventory = await request('/_data_stream');
  const streams = streamsForTarget((inventory.data_streams ?? []).map((stream) => stream.name), args.target);
  log(JSON.stringify({ target: args.target, mode: args.apply ? 'APPLY' : 'PLAN', policies: specifications.map((spec) => `${spec.name} (${spec.pattern}, delete ${spec.retention}d apos rollover)`), streams, rollover: args.rollover }, null, 2));
  if (!args.apply) return { applied: [], rolledOver: [] };
  const bases = {};
  for (const type of ['logs', 'metrics', 'traces']) {
    const source = await request(`/_index_template/${type}-otel@template`);
    const template = source.index_templates?.[0]?.index_template;
    if (!template?.composed_of?.includes('otel@mappings')) throw new Error(`Managed OTel mappings unavailable: ${type}`);
    bases[type] = template;
  }
  await ensureMetricsFingerprint(request);
  const applied = await applyRetentionTemplates(request, bases, specifications);
  const rolledOver = [];
  if (args.rollover) {
    for (const name of streams) {
      const result = await request(`/${encodeURIComponent(name)}/_rollover`, {}, false, 'POST');
      if (result.acknowledged) rolledOver.push(name);
    }
  }
  log(JSON.stringify({ applied, rolledOver }, null, 2));
  return { applied, rolledOver };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
