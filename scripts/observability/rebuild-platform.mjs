/** Destructive data reset: call only after explicit authorization to discard current OTel history. */
export const isResettableStream = name => /^(logs|metrics|traces)-[a-zA-Z0-9_.-]+\.otel-(dev|prd|infra)$/.test(name);

// Elasticsearch 8.17.0 needs this exporter-documented compatibility mapping.
export async function ensureMetricsFingerprint(request) {
  const existing = await request('/_component_template/metrics-otel@custom');
  const component = existing.component_templates?.[0]?.component_template;
  if (!component && existing.httpStatus !== 404) throw new Error('Cannot inspect metrics custom mappings');
  const body = structuredClone(component ?? { template: {} });
  body.template ??= {};
  body.template.mappings ??= {};
  body.template.mappings.properties = { ...body.template.mappings.properties, _metric_names_hash: { type: 'keyword', time_series_dimension: true } };
  const result = await request('/_component_template/metrics-otel@custom', body, false, 'PUT');
  if (!result.acknowledged) throw new Error('Metrics fingerprint mapping failed');
}

const days = {
  dev: { logs: 7, metrics: 7, traces: 3 },
  prd: { logs: 14, metrics: 30, traces: 7 },
  infra: { logs: 7, metrics: 14, traces: 3 },
};
export function retentionSpecifications() {
  const result = [];
  for (const [namespace, types] of Object.entries(days)) for (const [type, retention] of Object.entries(types)) {
    result.push({ name: `quiver-tap-${type}-${namespace}`, type, namespace, retention, priority: 500, pattern: `${type}-*.otel-${namespace}` });
  }
  result.push({ name: 'quiver-tap-audit-prd', type: 'logs', namespace: 'prd', retention: 30, priority: 510, pattern: 'logs-audit.otel-prd' });
  return result;
}

export async function planPlatformRebuild(request) {
  const inventory = await request('/_data_stream');
  if (!Array.isArray(inventory.data_streams)) throw new Error('Cannot inventory streams');
  const targets = inventory.data_streams.map(stream => stream.name).filter(isResettableStream).sort();
  const bases = {};
  for (const type of ['logs', 'metrics', 'traces']) {
    const source = await request('/_index_template/' + type + '-otel@template');
    const template = source.index_templates?.[0]?.index_template;
    if (!template?.composed_of?.includes('otel@mappings')) throw new Error('Managed OTel mappings unavailable: ' + type);
    bases[type] = template;
  }
  return { targets, bases, specifications: retentionSpecifications(), protected: 'Kibana/security/system indices and application databases are excluded' };
}

/** Non-destructive: ILM policies and index templates only. Shared by rebuildPlatform and apply-retention.mjs. */
export async function applyRetentionTemplates(request, bases, specifications) {
  const applied = [];
  for (const spec of specifications) {
    const policy = { policy: { phases: { hot: { actions: { rollover: { max_age: '1d', max_primary_shard_size: '1gb' } } }, delete: { min_age: spec.retention + 'd', actions: { delete: {} } } } } };
    const policyResult = await request('/_ilm/policy/' + spec.name, policy, false, 'PUT');
    if (!policyResult.acknowledged) throw new Error('Policy failed: ' + spec.name);
    const base = bases[spec.type];
    const template = structuredClone(base.template ?? {});
    template.settings = { ...template.settings, index: { ...(template.settings?.index ?? {}), number_of_shards: 1, number_of_replicas: 0, refresh_interval: '10s', lifecycle: { name: spec.name } } };
    // Preserve managed OTel mappings, TSDB settings and optional components.
    const body = { index_patterns: [spec.pattern], priority: spec.priority, composed_of: base.composed_of, data_stream: base.data_stream ?? {}, template, _meta: { owner: 'TAP-96', purpose: 'single-node bounded retention' }, ...(base.ignore_missing_component_templates ? { ignore_missing_component_templates: base.ignore_missing_component_templates } : {}) };
    const result = await request('/_index_template/' + spec.name, body, false, 'PUT');
    if (!result.acknowledged) throw new Error('Template failed: ' + spec.name);
    applied.push({ name: spec.name, retentionDaysAfterRollover: spec.retention });
  }
  return applied;
}

export async function rebuildPlatform(request, plan, authorization) {
  if (authorization !== 'DISCARD_CURRENT_OTEL_HISTORY') throw new Error('Explicit history-discard authorization required');
  if (!plan.targets.length || !plan.targets.every(isResettableStream)) throw new Error('Invalid exact stream inventory');
  await ensureMetricsFingerprint(request);
  const applied = await applyRetentionTemplates(request, plan.bases, plan.specifications);
  const deleted = [];
  for (let offset = 0; offset < plan.targets.length; offset += 20) {
    const names = plan.targets.slice(offset, offset + 20);
    // Never send a wildcard or system index to DELETE.
    if (!names.every(isResettableStream)) throw new Error('Unsafe target');
    const result = await request('/_data_stream/' + names.map(encodeURIComponent).join(','), undefined, false, 'DELETE');
    if (!result.acknowledged) throw new Error('Stream reset failed for exact inventory batch');
    deleted.push(...names);
  }
  return { applied, deleted, protected: plan.protected, physicalSegregation: 'deferred', replicas: 0, primariesPerIndex: 1 };
}
