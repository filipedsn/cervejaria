import type { HealthConfig, LocalLlmConfig } from '../config.js';
import { HealthEvaluator, emptyHealthCounters } from './evaluator.js';
import { HealthStore } from './store.js';
import { HEALTH_SCHEMA_VERSION, type HealthCounters, type SupportAnalystHealthSnapshot } from './types.js';

type Clock = { now: () => Date };
export class HealthTracker {
  private readonly evaluator = new HealthEvaluator(); private readonly counters = emptyHealthCounters();
  private startedAt?: string; private heartbeatAt?: string; private lastElasticReadAt?: string; private lastElasticReadSucceededAt?: string;
  private lastElasticError?: 'unreachable' | 'timeout' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'malformed_response' | 'request_failed';
  private lastCycleStartedAt?: string; private lastCycleCompletedAt?: string; private lastProgressAt?: string; private lastIncidentAt?: string; private lastDossierAt?: string; private lastLlmAttemptAt?: string; private lastLlmSuccessAt?: string;
  private llmReachable?: boolean; private llmModelAvailable?: boolean; private cleanShutdown = false; private fatalError = false; private timer?: NodeJS.Timeout;
  constructor(private readonly store: HealthStore, private readonly config: HealthConfig, private readonly llmConfig: LocalLlmConfig, private readonly elasticConfigured: boolean, private readonly clock: Clock = { now: () => new Date() }, private readonly version = '0.1.0', private readonly gitSha = safeGitSha(process.env.GIT_SHA)) {}
  async start(): Promise<void> { if (!this.config.enabled) return; this.startedAt = this.now(); await this.persist(); this.timer = setInterval(() => { void this.persist(); }, this.config.heartbeatIntervalMs); this.timer.unref(); }
  async stop(clean = true): Promise<void> { this.cleanShutdown = clean; if (this.timer) clearInterval(this.timer); await this.persist(); }
  markFatalError(): void { this.fatalError = true; void this.persist(); }
  cycleStarted(): void { this.counters.cyclesStarted++; this.lastCycleStartedAt = this.now(); }
  cycleCompleted(update: { eventsRead: number; eventsNormalized: number; incidentsCreated?: number; incidentsUpdated?: number; dossiersGenerated?: number; durationMs: number }): void { const at = this.now(); this.counters.cyclesCompleted++; this.counters.eventsRead += update.eventsRead; this.counters.eventsNormalized += update.eventsNormalized; this.counters.incidentsCreated += update.incidentsCreated ?? 0; this.counters.incidentsUpdated += update.incidentsUpdated ?? 0; this.counters.dossiersGenerated += update.dossiersGenerated ?? 0; this.counters.cycleDurationMsTotal += update.durationMs; this.counters.lastCycleDurationMs = update.durationMs; this.lastCycleCompletedAt = at; this.lastProgressAt = at; if ((update.incidentsCreated ?? 0) + (update.incidentsUpdated ?? 0) > 0) this.lastIncidentAt = at; if (update.dossiersGenerated) this.lastDossierAt = at; void this.persist(); }
  cycleFailed(): void { this.counters.cyclesFailed++; void this.persist(); }
  elasticReadSucceeded(): void { this.lastElasticReadAt = this.now(); this.lastElasticReadSucceededAt = this.lastElasticReadAt; this.lastElasticError = undefined; }
  elasticReadFailed(kind: NonNullable<HealthTracker['lastElasticError']>): void { this.lastElasticReadAt = this.now(); this.lastElasticError = kind; }
  llmAttempt(): void { this.counters.llmAttempts++; this.lastLlmAttemptAt = this.now(); }
  llmResult(result: { success?: boolean; reachable?: boolean; modelAvailable?: boolean; timeout?: boolean; fallback?: boolean; invalid?: boolean; guardrailBlock?: boolean }): void { if (result.success) { this.counters.llmSuccesses++; this.lastLlmSuccessAt = this.now(); } if (result.timeout) this.counters.llmTimeouts++; if (result.fallback) this.counters.llmFallbacks++; if (result.invalid) this.counters.llmInvalidOutputs++; if (result.guardrailBlock) this.counters.llmGuardrailBlocks++; if (result.reachable !== undefined) this.llmReachable = result.reachable; if (result.modelAvailable !== undefined) this.llmModelAvailable = result.modelAvailable; void this.persist(); }
  snapshot(): SupportAnalystHealthSnapshot { return this.evaluator.evaluate({ now: this.clock.now(), startedAt: this.startedAt, heartbeatAt: this.heartbeatAt, cleanShutdown: this.cleanShutdown, fatalError: this.fatalError, elasticConfigured: this.elasticConfigured, lastElasticReadAt: this.lastElasticReadAt, lastElasticReadSucceededAt: this.lastElasticReadSucceededAt, lastElasticError: this.lastElasticError, lastCycleStartedAt: this.lastCycleStartedAt, lastCycleCompletedAt: this.lastCycleCompletedAt, lastProgressAt: this.lastProgressAt, lastIncidentAt: this.lastIncidentAt, lastDossierAt: this.lastDossierAt, lastLlmAttemptAt: this.lastLlmAttemptAt, lastLlmSuccessAt: this.lastLlmSuccessAt, llmEnabled: this.llmConfig.enabled, llmReachable: this.llmReachable, llmModelAvailable: this.llmModelAvailable, counters: this.counters, heartbeatStaleMs: this.config.heartbeatStaleMs, processingStaleMs: this.config.processingStaleMs }); }
  healthCounters(): Readonly<HealthCounters> { return { ...this.counters }; }
  private async persist(): Promise<void> { if (!this.config.enabled || !this.startedAt) return; try { this.heartbeatAt = this.now(); await this.store.writeHeartbeat({ schemaVersion: HEALTH_SCHEMA_VERSION, processStartedAt: this.startedAt, heartbeatAt: this.heartbeatAt, version: this.version, ...(this.gitSha ? { gitSha: this.gitSha } : {}) }); await this.store.writeSnapshot(this.snapshot()); } catch { /* Health must never terminate deterministic processing. */ } }
  private now(): string { return this.clock.now().toISOString(); }
}
function safeGitSha(value: string | undefined): string | undefined { return value && /^[a-f0-9]{7,64}$/i.test(value) ? value : undefined; }
