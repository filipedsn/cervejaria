#!/usr/bin/env node

/**
 * Validates the future Support Analyst Elasticsearch runtime identity.
 *
 * Safety properties:
 * - accepts only SUPPORT_ANALYST_ES_API_KEY (no password/basic-auth fallback);
 * - uses only metadata, privilege-inspection and bounded search requests;
 * - never prints the credential or document contents;
 * - never calls an Elasticsearch write endpoint.
 */

import { assertElasticTarget } from './elastic-target-guard.mjs';
import {
  CLUSTER_FORBIDDEN_PRIVILEGES,
  INDEX_FORBIDDEN_PRIVILEGES,
  PROD_POSTDEPLOY_REQUIRED_FIELD,
  PROD_SOURCE_ALLOWLIST,
  PROD_STABLE_FIELDS,
  evaluateLegacyFallbackEvidence,
  getPrivilegeScope,
  resolveValidatorPolicy,
  resolveValidationPhase,
  validateProdFieldContract,
} from './validator-policy.mjs';

const MAX_SEARCH_SIZE = 3;
const SEARCH_LOOKBACK_HOURS = 24;
const ELASTIC_SEARCH_TIMEOUT = '5s';

let policy;
try {
  policy = resolveValidatorPolicy(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const { environment, apiKey, baseUrl } = policy;
let phase;
try {
  phase = resolveValidationPhase({ environment, argv: process.argv, env: process.env });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const requestTimeoutMs = boundedInteger(
  process.env.SUPPORT_ANALYST_ES_TIMEOUT_MS,
  10_000,
  1_000,
  15_000,
);
const correlationId = process.env.SUPPORT_ANALYST_TEST_CORRELATION_ID?.trim();

if (process.argv.includes('--help')) {
  process.stdout.write(`Usage: node scripts/support-analyst/validate-elastic-readonly.mjs

Required:
  SUPPORT_ANALYST_ES_API_KEY       Exclusive read-only Analyst API key

Optional:
  --phase=predeploy|postdeploy   Required for PROD; phase contract
  SUPPORT_ANALYST_ES_URL           Elasticsearch URL (default http://127.0.0.1:9200)
  SUPPORT_ANALYST_ENV              dev (default) or prd
  SUPPORT_ANALYST_ALLOW_PRD        Must be true before the script accepts prd
  SUPPORT_ANALYST_CREDENTIAL_ENV   Credential classification (required for prd)
  SUPPORT_ANALYST_ENDPOINT_ENV     Endpoint classification (required for prd)
  SUPPORT_ANALYST_ES_TIMEOUT_MS    HTTP timeout, 1000..15000 (default 10000)
  SUPPORT_ANALYST_TEST_CORRELATION_ID  Exact UUID to test without printing it
`);
  process.exit(0);
}

if (correlationId && !isUuid(correlationId)) {
  fail('SUPPORT_ANALYST_TEST_CORRELATION_ID deve ser UUID válido.');
}
if (environment === 'prd' && correlationId) {
  fail('PROD validator accepts only the bounded technical contract; correlation lookup is not enabled.');
}

const auditPattern = `logs-audit*.otel-${environment}*`;
const technicalPattern = `logs-technical*.otel-${environment}*`;
const alertIndex = environment === 'dev' ? 'quiver-tap-alert-events-dev' : null;
const alertRuleNameExactField = 'ruleName';
const allowedPatterns = environment === 'dev'
  ? [alertIndex, auditPattern, technicalPattern]
  : [technicalPattern];
try {
  assertElasticTarget({ environment, baseUrl, indexPatterns: allowedPatterns });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const privilegeScope = getPrivilegeScope(environment);
const outsidePatterns = privilegeScope.denied;

const sourceAllowlist = [
  '@timestamp',
  'severity_text',
  'data_stream.dataset',
  'data_stream.namespace',
  'resource.attributes.service.name',
  'attributes.correlationId',
  'attributes.requestId',
  'attributes.releaseSha',
  'attributes.service',
  'attributes.environment',
  'attributes.event',
  'attributes.event.action',
  'attributes.event.outcome',
  'attributes.legacy.kind',
  'attributes.http.request.method',
  'attributes.http.route',
  'attributes.http.response.status_code',
  'attributes.durationMs',
  'attributes.category',
  'attributes.reasonCode',
  'attributes.metadata.reasonCode',
  'attributes.cervejaria.id',
  'attributes.cervejaria.slug',
  'attributes.cervejariaId',
  'attributes.cervejariaSlug',
  'attributes.actor.id',
  'attributes.actor.type',
  'attributes.actorId',
  'attributes.actorType',
  'attributes.userId',
  'attributes.role',
  'trace_id',
  'span_id',
];
const querySourceAllowlist = environment === 'prd' ? PROD_SOURCE_ALLOWLIST : sourceAllowlist;

const failures = [];
const warnings = [];
const results = [];

await check('authenticate', async () => {
  const body = await request('/_security/_authenticate');
  if (body.authentication_type !== 'api_key') {
    throw new Error(`authentication_type inesperado: ${body.authentication_type || 'unknown'}`);
  }
  return {
    authenticationType: body.authentication_type,
    apiKeyName: body.api_key?.name || 'unknown',
  };
});

await check('resolve-index', async () => {
  const resolved = {};
  for (const pattern of allowedPatterns) {
    const body = await request(
      `/_resolve/index/${encodeURIComponent(pattern)}?expand_wildcards=all`,
    );
    const logicalNames = [
      ...(body.indices || []).map((item) => item.name),
      ...(body.aliases || []).map((item) => item.name),
      ...(body.data_streams || []).map((item) => item.name),
    ];
    if (!logicalNames.length) throw new Error(`nenhuma fonte resolve para ${pattern}`);
    resolved[pattern] = {
      indices: (body.indices || []).length,
      aliases: (body.aliases || []).length,
      dataStreams: (body.data_streams || []).length,
    };
  }
  return resolved;
});

const fieldCapsResult = await check('field-caps', async () => {
  const fields = environment === 'prd'
    ? [...PROD_STABLE_FIELDS, PROD_POSTDEPLOY_REQUIRED_FIELD, 'attributes.legacy.kind'].join(',')
    : [
    '@timestamp',
    'attributes.correlationId*',
    'attributes.requestId*',
    'attributes.releaseSha*',
    'attributes.service*',
    'attributes.environment*',
    'trace_id*',
    'span_id*',
    'attributes.event*',
    'attributes.legacy.kind*',
    'attributes.http*',
    'attributes.category*',
    'attributes.durationMs*',
    'attributes.reasonCode*',
    'attributes.metadata.reasonCode*',
    'attributes.cervejaria*',
    'attributes.actor*',
    'attributes.userId*',
    'attributes.role*',
  ].join(',');
  const output = {};
  if (alertIndex) {
    const alertBody = await request(
      `/${encodeURIComponent(alertIndex)}/_field_caps?fields=${encodeURIComponent(
        '@timestamp,ruleName*,alertState*,reason*,viewInAppUrl*,environment*',
      )}&include_unmapped=true`,
    );
    output[alertIndex] = summarizeFieldCaps(alertBody.fields || {});
  }
  const logPatterns = environment === 'dev' ? [auditPattern, technicalPattern] : [technicalPattern];
  for (const pattern of logPatterns) {
    const body = await request(
      `/${encodeURIComponent(pattern)}/_field_caps?fields=${encodeURIComponent(fields)}&include_unmapped=true`,
    );
    output[pattern] = summarizeFieldCaps(body.fields || {});
  }

  if (environment === 'dev') {
    requireKeyword(output[auditPattern], 'attributes.correlationId.keyword', auditPattern);
    requireKeyword(output[auditPattern], 'attributes.requestId.keyword', auditPattern);
    requireKeyword(output[auditPattern], 'attributes.releaseSha.keyword', auditPattern);
  }
  if (environment === 'dev') {
    requireKeyword(output[technicalPattern], 'attributes.correlationId.keyword', technicalPattern);
    requireKeyword(output[technicalPattern], 'attributes.requestId.keyword', technicalPattern);
    requireKeyword(output[technicalPattern], 'attributes.releaseSha.keyword', technicalPattern);
  }
  if (environment === 'prd') {
    validateProdFieldContract(output[technicalPattern], phase);
  } else {
    requireKeyword(output[technicalPattern], 'attributes.event.action', technicalPattern);
    requireKeyword(output[technicalPattern], 'attributes.legacy.kind', technicalPattern);
  }
  if (alertIndex) {
    requireKeyword(output[alertIndex], 'ruleName', alertIndex);
    requireKeyword(output[alertIndex], 'alertState', alertIndex);
    requireKeyword(output[alertIndex], 'viewInAppUrl', alertIndex);
    requireKeyword(output[alertIndex], 'environment', alertIndex);
  }
  return output;
});

if (alertIndex) await check('search-alert-events', async () => {
  const alertFilters = [
    recentRange(),
    { wildcard: { [alertRuleNameExactField]: `*-${environment}` } },
  ];
  if (environment === 'dev') alertFilters.push({ term: { environment: 'dev' } });
  const body = await search(alertIndex, {
    bool: {
      filter: alertFilters,
    },
  }, ['@timestamp', 'ruleName', 'alertState', 'reason', 'viewInAppUrl', 'environment']);
  if (!body.hits?.hits?.length) {
    throw new Error(`nenhum alerta ${environment} recente encontrado em ${alertIndex}`);
  }
  return { hits: body.hits?.hits?.length || 0, total: boundedTotal(body.hits?.total) };
});

if (environment === 'dev') await check('search-audit', async () => {
  const query = correlationId
    ? {
        bool: {
          filter: [
            recentRange(),
            { term: { 'attributes.correlationId.keyword': correlationId } },
          ],
        },
      }
    : { bool: { filter: [recentRange()] } };
  const body = await search(auditPattern, query, sourceAllowlist);
  return {
    hits: body.hits?.hits?.length || 0,
    total: boundedTotal(body.hits?.total),
    exactCorrelationTested: Boolean(correlationId),
  };
});

await check('search-technical', async () => {
  const query = correlationId
    ? {
        bool: {
          filter: [
            recentRange(),
            { term: { 'attributes.correlationId.keyword': correlationId } },
          ],
        },
      }
    : { bool: { filter: [recentRange()] } };
  const body = await search(technicalPattern, query, querySourceAllowlist);
  return {
    hits: body.hits?.hits?.length || 0,
    total: boundedTotal(body.hits?.total),
    exactCorrelationTested: Boolean(correlationId),
  };
});

if (environment === 'prd' && phase === 'postdeploy') {
  await check('postdeploy-positive-control', async () => {
    const body = await search(technicalPattern, {
      bool: { filter: [recentRange(), { exists: { field: 'attributes.event.action' } }] },
    }, querySourceAllowlist);
    const hits = body.hits?.hits || [];
    if (!hits.length) throw new Error('positive technical control ausente no PROD');
    return { hits: hits.length, total: boundedTotal(body.hits?.total) };
  });

  await check('legacy-fallback-evidence', async () => {
    const body = await search(technicalPattern, {
      bool: { filter: [recentRange(), { term: { 'attributes.event.action': 'legacy_fallback' } }] },
    }, ['@timestamp', 'attributes.event.action', 'attributes.legacy.kind']);
    const hits = body.hits?.hits || [];
    const kinds = hits.map((hit) => hit?._source?.attributes?.legacy?.kind).filter(Boolean);
    const evidence = evaluateLegacyFallbackEvidence({ hits: hits.length, kinds });
    if (evidence.requiresKind && kinds.length !== hits.length) throw new Error('legacy.kind ausente para fallback existente');
    return evidence;
  });
}

await check('runtime-privileges', async () => {
  const body = await request('/_security/user/_has_privileges', {
    method: 'POST',
    body: JSON.stringify({
      cluster: CLUSTER_FORBIDDEN_PRIVILEGES,
      index: [
        {
          names: allowedPatterns,
          privileges: ['read', 'view_index_metadata', ...INDEX_FORBIDDEN_PRIVILEGES],
        },
        { names: outsidePatterns, privileges: ['read', 'view_index_metadata'] },
      ],
    }),
  });

  for (const privilege of CLUSTER_FORBIDDEN_PRIVILEGES) {
    if (body.cluster?.[privilege] !== false) {
      throw new Error(`cluster privilege inesperado: ${privilege}`);
    }
  }
  for (const pattern of allowedPatterns) {
    const privileges = body.index?.[pattern];
    if (privileges?.read !== true || privileges?.view_index_metadata !== true) {
      throw new Error(`read/view_index_metadata ausente para ${pattern}`);
    }
    for (const privilege of INDEX_FORBIDDEN_PRIVILEGES) {
      if (privileges?.[privilege] !== false) {
        throw new Error(`index privilege inesperado em ${pattern}: ${privilege}`);
      }
    }
  }
  for (const pattern of outsidePatterns) {
    const privileges = body.index?.[pattern];
    if (privileges?.read !== false || privileges?.view_index_metadata !== false) {
      throw new Error(`acesso fora da allowlist em ${pattern}`);
    }
  }

  return {
    clusterPrivileges: [],
    allowedIndexPrivileges: ['read', 'view_index_metadata'],
    forbiddenIndexPrivilegesConfirmed: INDEX_FORBIDDEN_PRIVILEGES,
    outsidePatternsDenied: outsidePatterns,
  };
});

if (!fieldCapsResult) warnings.push('field caps indisponível; contrato de mapping não foi comprovado');

process.stdout.write(
  `${JSON.stringify(
    {
      ok: failures.length === 0,
      environment,
      metricsIncluded: false,
      limits: {
        searchSize: MAX_SEARCH_SIZE,
        lookbackHours: SEARCH_LOOKBACK_HOURS,
        elasticSearchTimeout: ELASTIC_SEARCH_TIMEOUT,
        requestTimeoutMs,
      },
      results,
      warnings,
      failures,
    },
    null,
    2,
  )}\n`,
);

if (failures.length) process.exitCode = 1;

async function search(indexPattern, query, sourceFields) {
  return request(`/${encodeURIComponent(indexPattern)}/_search?ignore_unavailable=true`, {
    method: 'POST',
    body: JSON.stringify({
      size: MAX_SEARCH_SIZE,
      track_total_hits: MAX_SEARCH_SIZE + 1,
      timeout: ELASTIC_SEARCH_TIMEOUT,
      terminate_after: 1000,
      _source: sourceFields,
      sort: [{ '@timestamp': 'desc' }],
      query,
    }),
  });
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      'content-type': 'application/json',
      authorization: `ApiKey ${apiKey}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${safePath(path)}`);
  }
  return response.json();
}

async function check(name, operation) {
  try {
    const detail = await operation();
    results.push({ name, status: 'PASS', detail });
    return detail;
  } catch (error) {
    const message = sanitizeError(error);
    failures.push({ name, message });
    results.push({ name, status: 'FAIL' });
    return null;
  }
}

function summarizeFieldCaps(fields) {
  const output = {};
  for (const [name, types] of Object.entries(fields)) {
    output[name] = Object.fromEntries(
      Object.entries(types)
        .filter(([type]) => type !== 'unmapped')
        .map(([type, value]) => [
          type,
          { searchable: Boolean(value.searchable), aggregatable: Boolean(value.aggregatable) },
        ]),
    );
  }
  return output;
}

function requireKeyword(fields, name, pattern) {
  const types = fields?.[name];
  if (!types?.keyword?.searchable) {
    throw new Error(`${name} keyword pesquisável ausente em ${pattern}`);
  }
}

function requireSearchable(fields, name, pattern) {
  const types = fields?.[name];
  if (!types || !Object.values(types).some((type) => type.searchable)) {
    throw new Error(`${name} pesquisável ausente em ${pattern}`);
  }
}

function recentRange() {
  return { range: { '@timestamp': { gte: `now-${SEARCH_LOOKBACK_HOURS}h`, lte: 'now' } } };
}

function boundedTotal(total) {
  if (typeof total === 'number') return total;
  if (!total || typeof total.value !== 'number') return 0;
  return { value: total.value, relation: total.relation || 'unknown' };
}

function boundedInteger(raw, fallback, min, max) {
  const value = Number.parseInt(raw || '', 10);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function safePath(path) {
  return path.replace(/([?&](?:api_key|authorization|token)=)[^&]+/gi, '$1[REDACTED]');
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/ApiKey\s+\S+/gi, 'ApiKey [REDACTED]').slice(0, 300);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
