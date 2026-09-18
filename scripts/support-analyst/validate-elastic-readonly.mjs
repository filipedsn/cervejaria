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

import { assertDevElasticTarget } from './elastic-target-guard.mjs';

const SHARED_ALERT_INDEX = 'quiver-tap-alert-events';
const MAX_SEARCH_SIZE = 3;
const SEARCH_LOOKBACK_HOURS = 24;
const ELASTIC_SEARCH_TIMEOUT = '5s';

const environment = (process.env.SUPPORT_ANALYST_ENV || 'dev').trim().toLowerCase();
const apiKey = process.env.SUPPORT_ANALYST_ES_API_KEY?.trim();
const baseUrl = (process.env.SUPPORT_ANALYST_ES_URL || 'http://127.0.0.1:9200').replace(
  /\/$/,
  '',
);
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
  SUPPORT_ANALYST_ES_URL           Elasticsearch URL (default http://127.0.0.1:9200)
  SUPPORT_ANALYST_ENV              dev (default) or prd
  SUPPORT_ANALYST_ALLOW_PRD        Must be true before the script accepts prd
  SUPPORT_ANALYST_ES_TIMEOUT_MS    HTTP timeout, 1000..15000 (default 10000)
  SUPPORT_ANALYST_TEST_CORRELATION_ID  Exact UUID to test without printing it
`);
  process.exit(0);
}

if (environment !== 'dev' && environment !== 'prd') {
  fail('SUPPORT_ANALYST_ENV deve ser dev ou prd.');
}
if (environment === 'prd' && !allowPrd) {
  fail('Validação PRD bloqueada: defina SUPPORT_ANALYST_ALLOW_PRD=true após autorização explícita.');
}
if (!apiKey) {
  fail('SUPPORT_ANALYST_ES_API_KEY é obrigatória; não existe fallback privilegiado.');
}
if (correlationId && !isUuid(correlationId)) {
  fail('SUPPORT_ANALYST_TEST_CORRELATION_ID deve ser UUID válido.');
}

const auditPattern = `logs-audit*.otel-${environment}*`;
const technicalPattern = `logs-technical*.otel-${environment}*`;
const alertIndex = 'quiver-tap-alert-events-dev';
const alertRuleNameExactField = 'ruleName';
const allowedPatterns = [alertIndex, auditPattern, technicalPattern];
try {
  assertDevElasticTarget({ environment, baseUrl, indexPatterns: allowedPatterns });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const outsidePatterns = [
  ...(environment === 'dev'
    ? [SHARED_ALERT_INDEX, 'logs-audit*.otel-prd*', 'logs-technical*.otel-prd*']
    : []),
  'traces-*',
  'logs-generic*',
  'metrics-*',
  '.kibana*',
];

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
  const fields = [
    '@timestamp',
    'attributes.correlationId*',
    'attributes.requestId*',
    'attributes.releaseSha*',
    'attributes.service*',
    'attributes.environment*',
    'trace_id*',
    'span_id*',
    'attributes.event*',
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
  const alertBody = await request(
    `/${encodeURIComponent(alertIndex)}/_field_caps?fields=${encodeURIComponent(
      '@timestamp,ruleName*,alertState*,reason*,viewInAppUrl*,environment*',
    )}&include_unmapped=true`,
  );
  output[alertIndex] = summarizeFieldCaps(alertBody.fields || {});
  for (const pattern of [auditPattern, technicalPattern]) {
    const body = await request(
      `/${encodeURIComponent(pattern)}/_field_caps?fields=${encodeURIComponent(fields)}&include_unmapped=true`,
    );
    output[pattern] = summarizeFieldCaps(body.fields || {});
  }

  requireKeyword(output[auditPattern], 'attributes.correlationId.keyword', auditPattern);
  requireKeyword(output[auditPattern], 'attributes.requestId.keyword', auditPattern);
  requireKeyword(output[auditPattern], 'attributes.releaseSha.keyword', auditPattern);
  requireKeyword(output[technicalPattern], 'attributes.correlationId.keyword', technicalPattern);
  requireKeyword(output[technicalPattern], 'attributes.requestId.keyword', technicalPattern);
  requireKeyword(output[technicalPattern], 'attributes.releaseSha.keyword', technicalPattern);
  requireKeyword(output[alertIndex], 'ruleName', alertIndex);
  requireKeyword(output[alertIndex], 'alertState', alertIndex);
  requireKeyword(output[alertIndex], 'viewInAppUrl', alertIndex);
  requireKeyword(output[alertIndex], 'environment', alertIndex);
  return output;
});

await check('search-alert-events', async () => {
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

await check('search-audit', async () => {
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
  const body = await search(technicalPattern, query, sourceAllowlist);
  return {
    hits: body.hits?.hits?.length || 0,
    total: boundedTotal(body.hits?.total),
    exactCorrelationTested: Boolean(correlationId),
  };
});

await check('runtime-privileges', async () => {
  const clusterForbidden = [
    'monitor',
    'manage',
    'manage_security',
    'manage_api_key',
    'manage_own_api_key',
    'manage_ilm',
    'manage_index_templates',
    'all',
  ];
  const indexForbidden = [
    'auto_configure',
    'write',
    'index',
    'create',
    'create_doc',
    'create_index',
    'delete',
    'delete_index',
    'manage',
    'manage_data_stream_lifecycle',
    'all',
  ];
  const body = await request('/_security/user/_has_privileges', {
    method: 'POST',
    body: JSON.stringify({
      cluster: clusterForbidden,
      index: [
        {
          names: allowedPatterns,
          privileges: ['read', 'view_index_metadata', ...indexForbidden],
        },
        { names: outsidePatterns, privileges: ['read', 'view_index_metadata'] },
      ],
    }),
  });

  for (const privilege of clusterForbidden) {
    if (body.cluster?.[privilege] !== false) {
      throw new Error(`cluster privilege inesperado: ${privilege}`);
    }
  }
  for (const pattern of allowedPatterns) {
    const privileges = body.index?.[pattern];
    if (privileges?.read !== true || privileges?.view_index_metadata !== true) {
      throw new Error(`read/view_index_metadata ausente para ${pattern}`);
    }
    for (const privilege of indexForbidden) {
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
    forbiddenIndexPrivilegesConfirmed: indexForbidden,
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
