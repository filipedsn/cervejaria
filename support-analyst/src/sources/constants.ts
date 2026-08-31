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

export const DEV_INDICES = {
  alerts: 'quiver-tap-alert-events-dev',
  audit: 'logs-audit*.otel-dev*',
  technical: 'logs-technical*.otel-dev*',
} as const;

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
