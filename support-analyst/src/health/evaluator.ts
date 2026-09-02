import type { HealthCounters, HealthEvaluationInput, HealthReason, HealthStatus, SupportAnalystHealthSnapshot } from './types.js';
import { HEALTH_SCHEMA_VERSION } from './types.js';

const status = (value: HealthStatus, detail?: string) => detail ? { status: value, detail } : { status: value };
const age = (now: Date, at?: string): number | undefined => at && !Number.isNaN(Date.parse(at)) ? now.getTime() - Date.parse(at) : undefined;
const recent = (now: Date, at: string | undefined, max: number) => { const value = age(now, at); return value !== undefined && value <= max; };
export const emptyHealthCounters = (): HealthCounters => ({ cyclesStarted: 0, cyclesCompleted: 0, cyclesFailed: 0, eventsRead: 0, eventsNormalized: 0, incidentsCreated: 0, incidentsUpdated: 0, dossiersGenerated: 0, cycleDurationMsTotal: 0, llmAttempts: 0, llmSuccesses: 0, llmTimeouts: 0, llmFallbacks: 0, llmInvalidOutputs: 0, llmGuardrailBlocks: 0 });

/** Pure, clock-controlled status evaluation.  It deliberately does not make network calls. */
export class HealthEvaluator {
  evaluate(input: HealthEvaluationInput): SupportAnalystHealthSnapshot {
    const reasons: HealthReason[] = [];
    let process: HealthStatus = 'HEALTHY';
    if (!input.startedAt) { process = 'UNHEALTHY'; reasons.push({ code: 'PROCESS_NOT_STARTED' }); }
    else if (input.fatalError) { process = 'UNHEALTHY'; reasons.push({ code: 'PROCESS_FATAL_ERROR' }); }
    else if (input.cleanShutdown) { process = 'UNHEALTHY'; reasons.push({ code: 'PROCESS_CLEAN_SHUTDOWN' }); }
    else if (!input.heartbeatAt) { process = 'UNHEALTHY'; reasons.push({ code: 'HEARTBEAT_MISSING' }); }
    else if (!recent(input.now, input.heartbeatAt, input.heartbeatStaleMs)) { process = 'UNHEALTHY'; reasons.push({ code: 'HEARTBEAT_STALE' }); }

    let elastic: HealthStatus = 'HEALTHY';
    if (!input.elasticConfigured) { elastic = 'UNHEALTHY'; reasons.push({ code: 'ELASTIC_NOT_CONFIGURED' }); }
    else if (!input.lastElasticReadSucceededAt) { elastic = 'UNHEALTHY'; reasons.push({ code: 'ELASTIC_UNREACHABLE' }); }
    else if (!recent(input.now, input.lastElasticReadSucceededAt, input.processingStaleMs)) { elastic = 'UNHEALTHY'; reasons.push({ code: 'ELASTIC_READ_STALE' }); }
    else if (input.lastElasticReadAt && input.lastElasticError) { elastic = 'DEGRADED'; reasons.push({ code: 'ELASTIC_UNREACHABLE', detail: input.lastElasticError }); }

    let processing: HealthStatus = 'HEALTHY';
    // A completed empty cycle is healthy/idle. Only a started, non-completing cycle is stuck.
    if (!input.lastCycleCompletedAt && input.counters.cyclesStarted > 0) { processing = 'UNHEALTHY'; reasons.push({ code: 'PROCESSING_STALLED' }); }
    else if (input.lastCycleStartedAt && (!input.lastCycleCompletedAt || Date.parse(input.lastCycleStartedAt) > Date.parse(input.lastCycleCompletedAt)) && !recent(input.now, input.lastCycleStartedAt, input.processingStaleMs)) { processing = 'UNHEALTHY'; reasons.push({ code: 'PROCESSING_STALLED' }); }
    else if (input.counters.cyclesFailed > 0 && input.counters.cyclesCompleted === 0) { processing = 'DEGRADED'; reasons.push({ code: 'PROCESSING_CYCLE_FAILED' }); }

    let llm: HealthStatus = 'HEALTHY';
    if (!input.llmEnabled) reasons.push({ code: 'LLM_DISABLED' });
    else if (input.llmReachable === false) { llm = 'UNHEALTHY'; reasons.push({ code: 'LLM_UNREACHABLE' }); }
    else if (input.llmModelAvailable === false) { llm = 'UNHEALTHY'; reasons.push({ code: 'LLM_MODEL_UNAVAILABLE' }); }
    const attempts = input.counters.llmAttempts;
    let quality: HealthStatus = attempts === 0 ? 'UNKNOWN' : 'HEALTHY';
    if (attempts === 0) reasons.push({ code: 'QUALITY_INSUFFICIENT_DATA' });
    else {
      const rate = (value: number) => value / attempts;
      if (rate(input.counters.llmTimeouts) >= 0.25) { quality = 'DEGRADED'; reasons.push({ code: 'LLM_TIMEOUT_RATE_HIGH' }); }
      if (rate(input.counters.llmFallbacks) >= 0.50) { quality = 'DEGRADED'; reasons.push({ code: 'LLM_FALLBACK_RATE_HIGH' }); }
      if (rate(input.counters.llmInvalidOutputs) >= 0.20) { quality = 'DEGRADED'; reasons.push({ code: 'LLM_INVALID_OUTPUT_RATE_HIGH' }); }
      if (rate(input.counters.llmGuardrailBlocks) >= 0.20) { quality = 'DEGRADED'; reasons.push({ code: 'LLM_GUARDRAIL_BLOCK_RATE_HIGH' }); }
    }
    const coreUnhealthy = [process, elastic, processing].includes('UNHEALTHY');
    const overall: HealthStatus = coreUnhealthy ? 'UNHEALTHY' : (llm === 'UNHEALTHY' || quality === 'DEGRADED' || elastic === 'DEGRADED' || processing === 'DEGRADED' ? 'DEGRADED' : 'HEALTHY');
    const deterministicShadowReady = process === 'HEALTHY' && elastic === 'HEALTHY' && processing === 'HEALTHY';
    const llmShadowReady = deterministicShadowReady && input.llmEnabled && llm === 'HEALTHY' && quality !== 'DEGRADED';
    return { schemaVersion: HEALTH_SCHEMA_VERSION, generatedAt: input.now.toISOString(), process: status(process), elastic: status(elastic), processing: status(processing), llm: status(llm, input.llmEnabled ? undefined : 'disabled'), quality: status(quality, attempts === 0 ? 'not_enough_data' : undefined), overall, reasons, counters: { ...input.counters }, lastProgressAt: input.lastProgressAt, lastIncidentAt: input.lastIncidentAt, lastDossierAt: input.lastDossierAt, lastLlmAttemptAt: input.lastLlmAttemptAt, lastLlmSuccessAt: input.lastLlmSuccessAt, deterministicShadowReady, llmShadowReady, shadowReadiness: deterministicShadowReady ? (overall === 'HEALTHY' ? 'READY' : 'DEGRADED') : 'NOT_READY' };
  }
}
