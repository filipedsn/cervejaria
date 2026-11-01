export const ANALYST_LIMITS = {
  alerts: 50,
  lookupPerSource: 50,
  fallbackPerSource: 50,
  totalBeforeNormalization: 100,
  elasticTimeout: '5s',
  httpTimeoutMs: 10_000,
  initialAroundMinutes: 5,
  maximumAroundMinutes: 15,
} as const;

/** dockerState só existe no PRD: o DEV não roda o cron docker-state.sh. */
export type AnalystIndices = { alerts: string; audit: string; technical: string; traces: string; appMetrics: string; infraHttpcheck: string; dockerState?: string };

export const DEV_INDICES: AnalystIndices = {
  alerts: 'quiver-tap-alert-events-dev',
  audit: 'logs-audit*.otel-dev*',
  technical: 'logs-technical*.otel-dev*',
  traces: 'traces-*.otel-dev*',
  appMetrics: 'metrics-generic.otel-dev*',
  infraHttpcheck: 'metrics-httpcheckreceiver.otel-infra*',
};

/** PRD: full read of the PRD streams (decision of 2026-11-01); never DEV, never write. */
export const PRD_INDICES: AnalystIndices = {
  alerts: 'quiver-tap-alert-events',
  audit: 'logs-audit*.otel-prd*',
  technical: 'logs-technical*.otel-prd*',
  traces: 'traces-*.otel-prd*',
  appMetrics: 'metrics-generic.otel-prd*',
  infraHttpcheck: 'metrics-httpcheckreceiver.otel-infra*',
  dockerState: 'logs-docker_state.otel-infra*',
};

export function indicesFor(environment: 'dev' | 'prd'): AnalystIndices {
  return environment === 'prd' ? PRD_INDICES : DEV_INDICES;
}

export const ALERT_SOURCE_FIELDS = [
  '@timestamp', 'severity_text', 'ruleName', 'alertState', 'reason', 'viewInAppUrl', 'environment',
] as const;

/** This is also the complete boundary between Elasticsearch hits and RawEventDocument. */
export const SIGNAL_SOURCE_FIELDS = [
  '@timestamp', 'severity_text', 'data_stream.dataset', 'data_stream.namespace',
  'resource.attributes.service.name', 'attributes.correlationId', 'attributes.requestId',
  'attributes.releaseSha', 'attributes.service', 'attributes.environment', 'attributes.event',
  'attributes.event.action', 'attributes.event.outcome', 'attributes.http.request.method',
  'attributes.http.route', 'attributes.http.response.status_code', 'attributes.durationMs',
  'attributes.category', 'attributes.reasonCode', 'attributes.metadata.reasonCode',
  'attributes.cervejaria.id', 'attributes.cervejaria.slug', 'attributes.cervejariaId',
  'attributes.cervejariaSlug', 'attributes.actor.id', 'attributes.actor.type', 'attributes.role',
  'attributes.db.operation', 'attributes.db.model', 'attributes.realtime.action', 'trace_id', 'span_id',
] as const;
