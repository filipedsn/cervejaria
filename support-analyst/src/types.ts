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

export type IncidentStatus = 'NEW' | 'OBSERVING' | 'ASSESSED' | 'CLOSED';
export type IncidentClass =
  | 'APPLICATION_ERROR' | 'DATABASE_FAILURE' | 'DATABASE_SLOW' | 'AUTH_FAILURE'
  | 'AUTHORIZATION_DENIED' | 'REALTIME_AUTH_FAILURE' | 'FRONTEND_ERROR'
  | 'AVAILABILITY' | 'PERFORMANCE' | 'BUSINESS_FAILURE' | 'TELEMETRY_FAILURE' | 'UNKNOWN';
export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
export type IncidentConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** Small, allowlisted evidence used by deterministic incident rules. */
export type IncidentSignals = {
  sources: Array<NormalizedEvent['source']>;
  dbCategories: Array<Exclude<NonNullable<NormalizedEvent['db']>['category'], undefined>>;
  maxHttpStatus?: number;
  hasAvailabilitySignal: boolean;
  deterministicRelationCount: number;
  nonWeakRelationCount: number;
  weakRelationCount: number;
  conflictCount: number;
  sourceFailureCount: number;
};

export type IncidentReason = { code: string; detail?: string };

export type Incident = {
  schemaVersion: 1;
  incidentId: string;
  fingerprint: string;
  status: IncidentStatus;
  class: IncidentClass;
  severity: IncidentSeverity;
  confidence: IncidentConfidence;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  eventIds: string[];
  affectedTenantIds: string[];
  affectedTenantCount: number;
  affectedReleaseShas: string[];
  service?: string;
  route?: string;
  signals: IncidentSignals;
  reasons: IncidentReason[];
  createdAt: string;
  updatedAt: string;
  duplicateOfIncidentId?: string;
};

export type ProcessingHealth = {
  schemaVersion: 1;
  processStartedAt?: string;
  lastProcessingAt?: string;
  lastProcessingSuccessAt?: string;
  eventsProcessed: number;
  eventsRejected: number;
  incidentsCreated: number;
  incidentsUpdated: number;
  processingFailures: number;
  dossiersGenerated: number;
  dossierFailures: number;
  feedbackRecorded: number;
  feedbackFailures: number;
};
