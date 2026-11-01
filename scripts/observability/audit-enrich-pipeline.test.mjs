import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIT_ENRICH_PIPELINE,
  GEO_DYNAMIC_TEMPLATE,
  buildAuditEnrichPipeline,
  buildLogsCustomComponent,
  parseArgs,
  simulationDocuments,
} from './audit-enrich-pipeline.mjs';
import { applyRetentionTemplates, ensureMetricsFingerprint, ensureTemplateDependencies, retentionSpecifications } from './rebuild-platform.mjs';

test('pipeline: geoip e user_agent sobre copias temporarias e falha nunca descarta o documento', () => {
  const pipeline = buildAuditEnrichPipeline();
  const geoip = pipeline.processors.find((p) => p.geoip)?.geoip;
  assert.equal(geoip.field, '_enrich_ip');
  assert.equal(geoip.target_field, '_enrich_geo');
  assert.equal(geoip.ignore_missing, true);
  assert.deepEqual(geoip.properties, ['city_name', 'region_name', 'country_iso_code', 'country_name', 'location', 'continent_name']);
  const userAgent = pipeline.processors.find((p) => p.user_agent)?.user_agent;
  assert.equal(userAgent.field, '_enrich_ua');
  assert.equal(userAgent.ignore_missing, true);
  const scripts = pipeline.processors.filter((p) => p.script).map((p) => p.script.source).join('\n');
  assert.match(scripts, /a\['client\.address'\]/);
  assert.match(scripts, /a\['client\.geo\.location'\] = \['lat'/);
  assert.match(scripts, /a\['client\.geo\.country_iso_code'\] == null/);
  assert.ok(pipeline.on_failure.length > 0);
  assert.ok(pipeline.on_failure.every((p) => Object.values(p)[0].ignore_failure === true));
  assert.equal(pipeline.on_failure.some((p) => p.drop || p.fail), false);
  assert.equal(pipeline.processors.some((p) => p.drop || p.fail), false);
});

test('mapping geo_point usa dynamic template e preserva o que ja existe no componente', () => {
  const existing = {
    template: {
      mappings: {
        properties: { custom: { type: 'keyword' } },
        dynamic_templates: [{ outro: { match: 'x', mapping: { type: 'keyword' } } }, { [GEO_DYNAMIC_TEMPLATE]: { path_match: 'velho', mapping: { type: 'keyword' } } }],
      },
    },
    _meta: { dono: 'outro' },
  };
  const body = buildLogsCustomComponent(existing);
  assert.equal(body.template.mappings.properties.custom.type, 'keyword');
  assert.equal(body._meta.dono, 'outro');
  assert.equal(body.template.mappings.properties.attributes, undefined, 'nao redeclara o objeto attributes gerenciado');
  const geo = body.template.mappings.dynamic_templates.filter((entry) => entry[GEO_DYNAMIC_TEMPLATE]);
  assert.equal(geo.length, 1);
  assert.deepEqual(geo[0][GEO_DYNAMIC_TEMPLATE], { path_match: 'attributes.client.geo.location', mapping: { type: 'geo_point' } });
  assert.ok(body.template.mappings.dynamic_templates.some((entry) => entry.outro));
  assert.deepEqual(buildLogsCustomComponent(undefined).template.mappings.dynamic_templates.length, 1);
});

test('campos somente leitura do GET (ES 9) nao voltam no PUT dos componentes', async () => {
  const readOnly = { created_date_millis: 1, modified_date_millis: 2 };
  const logs = buildLogsCustomComponent({ template: { mappings: {} }, version: 3, ...readOnly });
  assert.equal(logs.version, 3);
  assert.equal(Object.hasOwn(logs, 'created_date_millis'), false);
  assert.equal(Object.hasOwn(logs, 'modified_date_millis'), false);
  let metrics;
  await ensureMetricsFingerprint(async (_path, body) => {
    if (!body) return { component_templates: [{ component_template: { template: { mappings: { properties: {} } }, ...readOnly } }] };
    metrics = body;
    return { acknowledged: true };
  });
  assert.deepEqual(Object.keys(metrics), ['template']);
});

test('final_pipeline so nos templates de logs dev/prd e na auditoria PRD', () => {
  const withPipeline = retentionSpecifications().filter((spec) => spec.finalPipeline).map((spec) => spec.name).sort();
  assert.deepEqual(withPipeline, ['quiver-tap-audit-prd', 'quiver-tap-logs-dev', 'quiver-tap-logs-prd']);
  assert.ok(retentionSpecifications().every((spec) => !spec.finalPipeline || spec.finalPipeline === AUDIT_ENRICH_PIPELINE));
});

test('templates recebem index.final_pipeline e dependencias sao criadas antes', async () => {
  const calls = [];
  const request = async (path, body, _allowFail, method) => {
    calls.push({ path, method });
    if (path === '/_component_template/logs-otel@custom' && !body) return { httpStatus: 404 };
    return { acknowledged: true };
  };
  const specs = retentionSpecifications().filter((spec) => spec.name === 'quiver-tap-logs-dev' || spec.name === 'quiver-tap-metrics-dev');
  const ensured = await ensureTemplateDependencies(request, specs);
  assert.deepEqual(ensured, [AUDIT_ENRICH_PIPELINE, 'logs-otel@custom']);
  const bodies = {};
  await applyRetentionTemplates(async (path, body, allowFail, method) => {
    if (path.startsWith('/_index_template/')) bodies[path] = body;
    return request(path, body, allowFail, method);
  }, {
    logs: { composed_of: ['otel@mappings'], data_stream: {}, template: { settings: {} } },
    metrics: { composed_of: ['otel@mappings'], data_stream: {}, template: { settings: {} } },
  }, specs);
  assert.equal(bodies['/_index_template/quiver-tap-logs-dev'].template.settings.index.final_pipeline, AUDIT_ENRICH_PIPELINE);
  assert.equal(bodies['/_index_template/quiver-tap-metrics-dev'].template.settings.index.final_pipeline, undefined);
  const pipelinePut = calls.findIndex((c) => c.path === `/_ingest/pipeline/${AUDIT_ENRICH_PIPELINE}` && c.method === 'PUT');
  const templatePut = calls.findIndex((c) => c.path === '/_index_template/quiver-tap-logs-dev');
  assert.ok(pipelinePut >= 0 && pipelinePut < templatePut);
  assert.deepEqual(await ensureTemplateDependencies(async () => { throw new Error('sem rede'); }, specs.filter((s) => !s.finalPipeline)), []);
});

test('argumentos: PRD com --apply exige --confirm-prd', () => {
  assert.throws(() => parseArgs(['--target', 'prd', '--apply']), /confirm-prd/);
  assert.equal(parseArgs(['--target', 'prd', '--simulate']).simulate, true);
  assert.throws(() => parseArgs([]), /--target/);
  assert.throws(() => parseArgs(['--target', 'dev', '--force']), /desconhecido/);
});

test('documentos de simulacao usam o formato real e nenhum IP de usuario', () => {
  const docs = simulationDocuments();
  for (const doc of docs) {
    assert.equal(doc._source.data_stream.dataset, 'audit.otel');
    assert.equal(typeof doc._source.attributes, 'object');
  }
  const ips = docs.map((doc) => doc._source.attributes['client.address']).filter(Boolean);
  assert.deepEqual(ips, ['8.8.8.8', '200.160.2.3', '127.0.0.1']);
});
