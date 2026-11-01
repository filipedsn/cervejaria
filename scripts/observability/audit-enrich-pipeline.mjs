#!/usr/bin/env node
// Pipeline de ingestao que enriquece logs com cidade/estado/pais (GeoIP) e navegador/SO (user_agent).
// Uso: node scripts/observability/audit-enrich-pipeline.mjs --target dev|prd [--simulate] [--apply] [--confirm-prd]
// --apply cria o pipeline e o mapping geo_point; os templates que o referenciam sao do apply-retention.mjs.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AUDIT_ENRICH_PIPELINE = 'quiver-tap-audit-enrich';
export const GEO_LOCATION_FIELD = 'client.geo.location';
const TEMP_FIELDS = ['_enrich_ip', '_enrich_ua', '_enrich_geo', '_enrich_ua_parsed', '_enrich_error'];

const COPY_SOURCES = `
def a = ctx.attributes;
if (a instanceof Map) {
  def ip = a['client.address'];
  if (ip instanceof String && !ip.isEmpty()) { ctx._enrich_ip = ip; }
  def ua = a['user_agent.original'];
  if (ua instanceof String && !ua.isEmpty()) { ctx._enrich_ua = ua; }
}`;

const MOVE_RESULTS = `
def a = ctx.attributes;
if (a instanceof Map) {
  def g = ctx._enrich_geo;
  if (g instanceof Map) {
    if (g.city_name != null) { a['client.geo.city_name'] = g.city_name; }
    if (g.region_name != null) { a['client.geo.region_name'] = g.region_name; }
    if (g.country_iso_code != null && a['client.geo.country_iso_code'] == null) { a['client.geo.country_iso_code'] = g.country_iso_code; }
    if (g.country_name != null) { a['client.geo.country_name'] = g.country_name; }
    if (g.continent_name != null) { a['client.geo.continent_name'] = g.continent_name; }
    if (g.location instanceof Map && g.location.lat != null && g.location.lon != null) {
      a['${GEO_LOCATION_FIELD}'] = ['lat': g.location.lat, 'lon': g.location.lon];
    }
  }
  def u = ctx._enrich_ua_parsed;
  if (u instanceof Map) {
    if (u.name != null) { a['user_agent.name'] = u.name; }
    if (u.version != null) { a['user_agent.version'] = u.version; }
    if (u.os instanceof Map && u.os.name != null) { a['user_agent.os.name'] = u.os.name; }
    if (u.device instanceof Map && u.device.name != null) { a['user_agent.device.name'] = u.device.name; }
  }
}
if (ctx.tags instanceof List) {
  def kept = new ArrayList();
  for (def t : ctx.tags) {
    if (t instanceof String && t.startsWith('_geoip_')) {
      if (a instanceof Map) { a['enrich.error'] = t; }
    } else {
      kept.add(t);
    }
  }
  if (kept.isEmpty()) { ctx.remove('tags'); } else { ctx.tags = kept; }
}
for (def f : params.temp) { ctx.remove(f); }`;

const RECORD_FAILURE = `
if (!(ctx.attributes instanceof Map)) { ctx.attributes = new HashMap(); }
ctx.attributes['enrich.error'] = ctx._enrich_error;
for (def f : params.temp) { ctx.remove(f); }`;

export function buildAuditEnrichPipeline() {
  return {
    description: 'TAP-160: GeoIP e user_agent a partir de attributes.client.address / attributes.user_agent.original. Nunca descarta o documento.',
    processors: [
      { script: { tag: 'copy-sources', lang: 'painless', source: COPY_SOURCES } },
      {
        geoip: {
          tag: 'geoip',
          if: 'ctx._enrich_ip != null',
          field: '_enrich_ip',
          target_field: '_enrich_geo',
          ignore_missing: true,
          properties: ['city_name', 'region_name', 'country_iso_code', 'country_name', 'location', 'continent_name'],
        },
      },
      {
        user_agent: {
          tag: 'user-agent',
          if: 'ctx._enrich_ua != null',
          field: '_enrich_ua',
          target_field: '_enrich_ua_parsed',
          ignore_missing: true,
        },
      },
      { script: { tag: 'move-results', lang: 'painless', source: MOVE_RESULTS, params: { temp: TEMP_FIELDS } } },
    ],
    on_failure: [
      { set: { field: '_enrich_error', value: '{{{ _ingest.on_failure_processor_tag }}}: {{{ _ingest.on_failure_message }}}', ignore_failure: true } },
      { script: { lang: 'painless', source: RECORD_FAILURE, params: { temp: TEMP_FIELDS }, ignore_failure: true } },
    ],
    _meta: { owner: 'TAP-160', purpose: 'jornada do usuario: onde e com qual dispositivo' },
  };
}

export const GEO_DYNAMIC_TEMPLATE = 'quiver_tap_client_geo_location';

/** ES 9 GET adds read-only fields (created_date_millis, modified_date_millis) that PUT rejects. */
export function writableComponentTemplate(component) {
  const writable = {};
  for (const key of ['template', 'version', '_meta', 'deprecated']) {
    if (component?.[key] !== undefined) writable[key] = structuredClone(component[key]);
  }
  return writable;
}

/**
 * geo_point for the dotted OTel attribute, preserving other custom mappings.
 * ES 9.5 replaces (not merges) an `attributes` object redeclared in a later component,
 * dropping the managed OTel properties, so this uses a dynamic template instead.
 */
export function buildLogsCustomComponent(existing) {
  const body = writableComponentTemplate(existing);
  body.template ??= {};
  body.template.mappings ??= {};
  const others = (body.template.mappings.dynamic_templates ?? []).filter((entry) => !Object.hasOwn(entry, GEO_DYNAMIC_TEMPLATE));
  body.template.mappings.dynamic_templates = [
    ...others,
    { [GEO_DYNAMIC_TEMPLATE]: { path_match: `attributes.${GEO_LOCATION_FIELD}`, mapping: { type: 'geo_point' } } },
  ];
  return body;
}

export async function ensureAuditEnrichPipeline(request) {
  const result = await request(`/_ingest/pipeline/${AUDIT_ENRICH_PIPELINE}`, buildAuditEnrichPipeline(), false, 'PUT');
  if (!result.acknowledged) throw new Error(`Pipeline failed: ${AUDIT_ENRICH_PIPELINE}`);
}

export async function ensureLogsGeoMapping(request) {
  const existing = await request('/_component_template/logs-otel@custom');
  const component = existing.component_templates?.[0]?.component_template;
  if (!component && existing.httpStatus !== 404) throw new Error('Cannot inspect logs custom mappings');
  const result = await request('/_component_template/logs-otel@custom', buildLogsCustomComponent(component), false, 'PUT');
  if (!result.acknowledged) throw new Error('Logs geo_point mapping failed');
}

/** Synthetic documents in the real OTel shape (dotted keys inside attributes); documentation IPs only. */
export function simulationDocuments() {
  const base = (ip, ua) => ({
    _index: 'logs-audit.otel-dev',
    _source: {
      '@timestamp': new Date().toISOString(),
      data_stream: { type: 'logs', dataset: 'audit.otel', namespace: 'dev' },
      attributes: {
        'event.action': 'ui.page_view',
        'actor.type': 'usuario',
        ...(ip ? { 'client.address': ip, 'client.ip_source': 'cloudflare' } : {}),
        ...(ua ? { 'user_agent.original': ua } : {}),
      },
      body: { text: 'simulacao TAP-160' },
    },
  });
  return [
    base('8.8.8.8', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'),
    base('200.160.2.3', 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'),
    base('127.0.0.1', undefined),
    base(undefined, undefined),
  ];
}

export function parseArgs(argv) {
  const args = { target: undefined, apply: false, simulate: false, confirmPrd: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') { args.target = argv[i + 1]; i += 1; }
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--simulate') args.simulate = true;
    else if (arg === '--confirm-prd') args.confirmPrd = true;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (args.target !== 'dev' && args.target !== 'prd') throw new Error('Use --target dev ou --target prd');
  if (args.target === 'prd' && args.apply && !args.confirmPrd) throw new Error('Mutacao em PRD exige --confirm-prd (e GATE autorizado)');
  return args;
}

export async function main(argv, { fetchImpl = fetch, log = console.log } = {}) {
  const args = parseArgs(argv);
  const { assertSafeEndpoint, createRequest, readEnvFile } = await import('./apply-retention.mjs');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const env = readEnvFile(join(root, 'deploy', 'observability', args.target === 'prd' ? '.env.observability.prd' : '.env.observability'));
  const baseUrl = env.ELASTICSEARCH_URL || (args.target === 'dev' ? 'http://localhost:9200' : '');
  if (!baseUrl) throw new Error('ELASTICSEARCH_URL obrigatorio no alvo PRD');
  assertSafeEndpoint(baseUrl, args.target);
  const request = createRequest(baseUrl, env, fetchImpl);
  const summary = { target: args.target, mode: args.apply ? 'APPLY' : 'PLAN', pipeline: AUDIT_ENRICH_PIPELINE, geoPointField: `attributes.${GEO_LOCATION_FIELD}` };
  if (args.simulate) {
    const result = await request('/_ingest/pipeline/_simulate', { pipeline: buildAuditEnrichPipeline(), docs: simulationDocuments() });
    summary.simulation = (result.docs ?? []).map((doc) => {
      const attributes = doc.doc?._source?.attributes ?? {};
      return Object.fromEntries(Object.entries(attributes).filter(([key]) => /^(client\.geo|user_agent|enrich)/.test(key)));
    });
  }
  if (args.apply) {
    await ensureAuditEnrichPipeline(request);
    await ensureLogsGeoMapping(request);
    summary.applied = [AUDIT_ENRICH_PIPELINE, 'logs-otel@custom'];
  }
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
