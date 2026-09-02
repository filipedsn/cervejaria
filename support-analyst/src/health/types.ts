export const HEALTH_SCHEMA_VERSION = 1 as const;
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type HealthReasonCode =
  | 'HEARTBEAT_MISSING' | 'HEARTBEAT_STALE' | 'HEALTH_SNAPSHOT_MISSING' | 'HEALTH_SNAPSHOT_STALE'
  | 'PROCESS_NOT_STARTED' | 'PROCESS_FATAL_ERROR' | 'PROCESS_CLEAN_SHUTDOWN'
  | 'ELASTIC_NOT_CONFIGURED' | 'ELASTIC_UNREACHABLE' | 'ELASTIC_READ_STALE'
  | 'PROCESSING_NOT_STARTED' | 'PROCESSING_STALLED' | 'PROCESSING_CYCLE_FAILED'
  | 'LLM_DISABLED' | 'LLM_UNREACHABLE' | 'LLM_MODEL_UNAVAILABLE'
  | 'LLM_TIMEOUT_RATE_HIGH' | 'LLM_FALLBACK_RATE_HIGH' | 'LLM_INVALID_OUTPUT_RATE_HIGH'
  | 'LLM_GUARDRAIL_BLOCK_RATE_HIGH' | 'QUALITY_INSUFFICIENT_DATA' | 'HEALTH_PERSISTENCE_FAILED';
export type HealthReason = { code: HealthReasonCode; detail?: string };
export type HealthDomain = { status: HealthStatus; detail?: string };
export type HealthCounters = {
  cyclesStarted: number; cyclesCompleted: number; cyclesFailed: number;
  eventsRead: number; eventsNormalized: number; incidentsCreated: number; incidentsUpdated: number; dossiersGenerated: number;
  cycleDurationMsTotal: number; lastCycleDurationMs?: number;
  llmAttempts: number; llmSuccesses: number; llmTimeouts: number; llmFallbacks: number; llmInvalidOutputs: number; llmGuardrailBlocks: number;
};
export type SupportAnalystHealthSnapshot = {
  schemaVersion: typeof HEALTH_SCHEMA_VERSION; generatedAt: string;
  process: HealthDomain; elastic: HealthDomain; processing: HealthDomain; llm: HealthDomain; quality: HealthDomain; overall: HealthStatus;
  reasons: HealthReason[]; counters: HealthCounters;
  lastProgressAt?: string; lastIncidentAt?: string; lastDossierAt?: string; lastLlmAttemptAt?: string; lastLlmSuccessAt?: string;
  shadowReadiness: 'READY' | 'DEGRADED' | 'NOT_READY'; deterministicShadowReady: boolean; llmShadowReady: boolean;
};
export type Heartbeat = { schemaVersion: typeof HEALTH_SCHEMA_VERSION; processStartedAt: string; heartbeatAt: string; version: string; gitSha?: string };
export type HealthEvaluationInput = {
  now: Date; startedAt?: string; heartbeatAt?: string; cleanShutdown?: boolean; fatalError?: boolean;
  elasticConfigured: boolean; lastElasticReadAt?: string; lastElasticReadSucceededAt?: string; lastElasticError?: 'unreachable' | 'timeout' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'malformed_response' | 'request_failed';
  lastCycleCompletedAt?: string; lastCycleStartedAt?: string; lastProgressAt?: string; lastIncidentAt?: string; lastDossierAt?: string;
  lastLlmAttemptAt?: string; lastLlmSuccessAt?: string; llmEnabled: boolean; llmReachable?: boolean; llmModelAvailable?: boolean;
  counters: HealthCounters; heartbeatStaleMs: number; processingStaleMs: number;
};
