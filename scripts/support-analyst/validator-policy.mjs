/** Resolve the validator safety gate without making any network request. */
export function resolveValidatorPolicy(env = process.env) {
  const environment = normalize(env.SUPPORT_ANALYST_ENV || 'dev');
  if (environment !== 'dev' && environment !== 'prd') {
    throw new Error('SUPPORT_ANALYST_ENV deve ser dev ou prd.');
  }
  const allowPrd = String(env.SUPPORT_ANALYST_ALLOW_PRD || '').trim().toLowerCase() === 'true';
  const credentialEnvironment = optionalEnvironment(env.SUPPORT_ANALYST_CREDENTIAL_ENV);
  const endpointEnvironment = optionalEnvironment(env.SUPPORT_ANALYST_ENDPOINT_ENV);
  if (credentialEnvironment === 'invalid' || endpointEnvironment === 'invalid') {
    throw new Error('classificação de credencial/endpoint deve ser dev ou prd.');
  }
  if (environment === 'prd' && !allowPrd) throw new Error('PROD_ANALYST_EXPLICIT_ALLOW_REQUIRED');
  if (credentialEnvironment && credentialEnvironment !== environment) throw new Error('PROD_DEV_CREDENTIAL_TARGET_MISMATCH');
  if (endpointEnvironment && endpointEnvironment !== environment) throw new Error('PROD_DEV_ENDPOINT_TARGET_MISMATCH');
  if (environment === 'prd' && credentialEnvironment !== 'prd') throw new Error('PROD_ANALYST_CREDENTIAL_CLASSIFICATION_REQUIRED');
  if (environment === 'prd' && endpointEnvironment !== 'prd') throw new Error('PROD_ANALYST_ENDPOINT_CLASSIFICATION_REQUIRED');
  const apiKey = String(env.SUPPORT_ANALYST_ES_API_KEY || '').trim();
  if (!apiKey) throw new Error(environment === 'prd' ? 'PROD_ANALYST_CREDENTIAL_MISSING' : 'SUPPORT_ANALYST_ES_API_KEY é obrigatória; não existe fallback privilegiado.');
  const rawUrl = String(env.SUPPORT_ANALYST_ES_URL || '').trim();
  if (!rawUrl) throw new Error('SUPPORT_ANALYST_ES_URL é obrigatória.');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('SUPPORT_ANALYST_ES_URL deve ser uma URL HTTP(S) válida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('SUPPORT_ANALYST_ES_URL deve ser HTTP(S), sem credenciais embutidas.');
  return { environment, allowPrd, credentialEnvironment, endpointEnvironment, apiKey, baseUrl: rawUrl.replace(/\/$/, '') };
}

export const PROD_SOURCE_ALLOWLIST = Object.freeze([
  '@timestamp',
  'data_stream.dataset',
  'data_stream.namespace',
  'resource.attributes.service.name',
  'attributes.event.action',
  'attributes.legacy.kind',
  'trace_id',
  'span_id',
]);

export const INDEX_FORBIDDEN_PRIVILEGES = Object.freeze([
  'auto_configure', 'write', 'index', 'create', 'create_doc', 'create_index',
  'delete', 'delete_index', 'manage', 'manage_data_stream_lifecycle', 'all',
]);

export const CLUSTER_FORBIDDEN_PRIVILEGES = Object.freeze([
  'monitor', 'manage', 'manage_security', 'manage_api_key', 'manage_own_api_key',
  'manage_ilm', 'manage_index_templates', 'all',
]);

export const VALIDATION_PHASES = Object.freeze(['predeploy', 'postdeploy']);
export const PROD_STABLE_FIELDS = Object.freeze([
  '@timestamp',
  'data_stream.dataset',
  'data_stream.namespace',
  'resource.attributes.service.name',
  'trace_id',
  'span_id',
]);
export const PROD_POSTDEPLOY_REQUIRED_FIELD = 'attributes.event.action';
export const ALLOWED_LEGACY_KINDS = Object.freeze([
  'operational_config',
  'direct_sales_compat',
  'cash_capability',
]);

export function resolveValidationPhase({ environment, argv = [], env = process.env } = {}) {
  const cli = argv.find((arg) => arg.startsWith('--phase='))?.slice('--phase='.length).trim().toLowerCase();
  const configured = String(env.SUPPORT_ANALYST_VALIDATION_PHASE || '').trim().toLowerCase();
  if (cli && configured && cli !== configured) throw new Error('VALIDATION_PHASE_MISMATCH');
  const phase = cli || configured;
  if (phase && !VALIDATION_PHASES.includes(phase)) throw new Error('VALIDATION_PHASE_INVALID');
  if (!phase && normalize(environment) === 'prd') throw new Error('VALIDATION_PHASE_REQUIRED_FOR_PROD');
  return phase || 'postdeploy';
}

export function evaluateLegacyFallbackEvidence({ hits, kinds }) {
  if (!Number.isInteger(hits) || hits < 0) throw new Error('LEGACY_FALLBACK_HITS_INVALID');
  if (hits === 0) return { status: 'PASS', hits: 0, requiresKind: false, kinds: [] };
  if (!Array.isArray(kinds) || kinds.length !== hits) throw new Error('LEGACY_KIND_REQUIRED_FOR_FALLBACK');
  const unknown = kinds.filter((kind) => !ALLOWED_LEGACY_KINDS.includes(kind));
  if (unknown.length) throw new Error('LEGACY_KIND_NOT_ALLOWED');
  return { status: 'PASS', hits, requiresKind: true, kinds };
}

export function validateProdFieldContract(fields, phase) {
  for (const field of PROD_STABLE_FIELDS) {
    const types = fields?.[field];
    if (!types || !Object.values(types).some((type) => type.searchable)) {
      throw new Error(`${field} searchable mapping required`);
    }
  }
  if (phase === 'postdeploy') {
    const types = fields?.[PROD_POSTDEPLOY_REQUIRED_FIELD];
    if (!types || !Object.values(types).some((type) => type.searchable)) {
      throw new Error(`${PROD_POSTDEPLOY_REQUIRED_FIELD} searchable mapping required`);
    }
  }
  return true;
}

export function getPrivilegeScope(environment) {
  const envName = normalize(environment);
  if (envName === 'dev') {
    return {
      allowed: ['quiver-tap-alert-events-dev', 'logs-audit*.otel-dev*', 'logs-technical*.otel-dev*'],
      denied: ['quiver-tap-alert-events', 'logs-audit*.otel-prd*', 'logs-technical*.otel-prd*', 'traces-*', 'logs-generic*', 'metrics-*', '.kibana*'],
    };
  }
  if (envName === 'prd') {
    return {
      allowed: ['logs-technical*.otel-prd*'],
      denied: ['logs-technical*.otel-dev*', 'logs-audit*.otel-dev*', 'quiver-tap-alert-events-dev', 'logs-audit*.otel-prd*', 'quiver-tap-alert-events', 'traces-*', 'logs-generic*', 'metrics-*', '.kibana*'],
    };
  }
  throw new Error('Ambiente Elastic inválido.');
}

function normalize(value) { return String(value).trim().toLowerCase(); }
function optionalEnvironment(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = normalize(value);
  return normalized === 'dev' || normalized === 'prd' ? normalized : 'invalid';
}
