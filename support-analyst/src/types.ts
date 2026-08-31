export type AnalystEnvironment = 'dev' | 'prd';

export type RawEventDocument = {
  index: string;
  id: string;
  sourceType: 'alert' | 'audit' | 'technical';
  source: unknown;
};

export type NormalizedEvent = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  source: 'alert' | 'audit' | 'technical' | 'metric';
  dataset?: string;
  environment?: 'dev' | 'prd' | 'infra';
  service?: string;
  releaseSha?: string;
  correlationId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  tenantSlug?: string;
  actorId?: string;
  actorType?: 'usuario' | 'cliente' | 'system' | 'anonymous';
  role?: string;
  eventType?: string;
  action?: string;
  /** Audit/auth reason code from the producer contract; not free-form text. */
  reasonCode?: string;
  outcome?: 'success' | 'failure';
  severityText?: string;
  http?: {
    method?: string;
    route?: string;
    statusCode?: number;
    durationMs?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
  db?: {
    category?: 'CONNECTION' | 'TIMEOUT' | 'DEADLOCK' | 'LOCK_TIMEOUT' | 'CONSTRAINT' | 'NOT_FOUND' | 'TRANSACTION' | 'UNKNOWN';
    durationMs?: number;
    operation?: string;
    model?: string;
  };
  realtime?: {
    action?: string;
    reasonCode?: string;
  };
  alert?: {
    ruleName?: string;
    state?: string;
    reason?: string;
    url?: string;
  };
  rawRef: {
    index: string;
    id: string;
  };
};

export type NormalizationFailure =
  | 'missing_raw_ref'
  | 'invalid_source_document'
  | 'missing_timestamp'
  | 'invalid_timestamp';

export type NormalizationResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; reason: NormalizationFailure };
