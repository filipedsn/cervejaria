import { ContextBuilder, DossierStore, buildDeterministicDossier } from '../dossiers/index.js';
import { IncidentGrouper, IncidentStore, emptyHealth, recordDossierHealth, recordProcessingHealth } from '../incidents/index.js';
import { EnrichmentStore, InteractionStore, LocalLlmAnalyzer } from '../local-llm/index.js';
import { normalizeBatch } from '../sources/pipeline.js';
import { CorrelationEngine, type CorrelationRelation } from '../correlation.js';
import type { HealthConfig, LocalLlmConfig, PilotRuntimeConfig } from '../config.js';
import { HealthStore, HealthTracker } from '../health/index.js';
import type { RawEventDocument } from '../types.js';
import { ReviewQueueStore } from './review-queue.js';
import { RuntimeStateStore } from './state.js';

type Clock = { now: () => Date };
export type PilotSourceRead = { from: string; to: string; limit: number };
/** The production adapter is deliberately a read-only bounded source. */
export type PilotSource = { preflight(): Promise<void>; read(input: PilotSourceRead): Promise<RawEventDocument[]> };
export type CycleResult = { outcome: 'COMPLETED' | 'SOURCE_FAILURE' | 'PROCESSING_FAILURE' | 'PERSISTENCE_FAILURE'; from: string; to: string; eventsRead: number; eventsNormalized: number; incidentsCreated: number; incidentsUpdated: number; dossiersGenerated: number; llmAttempts: number; llmEnriched: number; durationMs: number };
export type SupportAnalystRuntimeDependencies = { source: PilotSource; runtimeDir: string; pilot: PilotRuntimeConfig; health: HealthConfig; llm: LocalLlmConfig; clock?: Clock; analyzer?: Pick<LocalLlmAnalyzer, 'analyze'> };

/**
 * Small foreground orchestration layer. Domain decisions stay in the existing
 * pure components; this class only brackets them with bounded I/O and health.
 */
export class SupportAnalystRuntime {
  private readonly clock: Clock; private readonly incidents: IncidentStore; private readonly dossiers: DossierStore; private readonly state: RuntimeStateStore; private readonly reviews: ReviewQueueStore; private readonly tracker: HealthTracker; private readonly grouper = new IncidentGrouper(); private readonly context = new ContextBuilder(); private readonly correlation = new CorrelationEngine(); private readonly analyzer: Pick<LocalLlmAnalyzer, 'analyze'>;
  private stopping = false; private initialized = false; private runningCycle = false;
  constructor(private readonly dependencies: SupportAnalystRuntimeDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() };
    this.incidents = new IncidentStore(dependencies.runtimeDir); this.dossiers = new DossierStore(dependencies.runtimeDir); this.state = new RuntimeStateStore(dependencies.runtimeDir); this.reviews = new ReviewQueueStore(dependencies.runtimeDir);
    this.tracker = new HealthTracker(new HealthStore(dependencies.runtimeDir), dependencies.health, dependencies.llm, true, this.clock);
    this.analyzer = dependencies.analyzer ?? new LocalLlmAnalyzer(dependencies.llm, { saveEnrichment: (item) => new EnrichmentStore(dependencies.runtimeDir).save(item), record: (item) => new InteractionStore(dependencies.runtimeDir).append(item), healthObserver: { attempt: () => this.tracker.llmAttempt(), result: (value) => this.tracker.llmResult(value) } });
  }
  async validateStartup(): Promise<void> {
    if (!this.dependencies.runtimeDir.trim()) throw new Error('SUPPORT_ANALYST_RUNTIME_DIR is required for the pilot runtime.');
    if (this.dependencies.pilot.maxEvents > 100) throw new Error('Pilot max events exceeds the bounded source limit.');
    await this.sourcePreflight();
  }
  async start(): Promise<void> {
    if (this.initialized) return;
    await this.validateStartup();
    await this.incidents.acquireLock();
    try { await this.tracker.start(); this.initialized = true; }
    catch (error) { await this.incidents.releaseLock(); throw error; }
  }
  async stop(clean = true): Promise<void> { this.stopping = true; if (this.initialized) { await this.tracker.stop(clean); await this.incidents.releaseLock(); this.initialized = false; } }
  requestStop(): void { this.stopping = true; }
  healthTracker(): HealthTracker { return this.tracker; }
  async runOnce(): Promise<CycleResult> {
    if (!this.initialized) throw new Error('Runtime must be started before running a cycle.');
    if (this.runningCycle) throw new Error('A Support Analyst cycle is already running.');
    this.runningCycle = true;
    const started = this.clock.now().getTime(); const to = this.clock.now().toISOString(); let from = to;
    let eventsRead = 0; let eventsNormalized = 0; let incidentsCreated = 0; let incidentsUpdated = 0; let dossiersGenerated = 0; let llmAttempts = 0; let llmEnriched = 0;
    this.tracker.cycleStarted();
    try {
      const watermark = await this.state.loadWatermark();
      from = this.windowStart(watermark?.latestEventAt, this.clock.now()).toISOString();
      let raw: RawEventDocument[];
      try { raw = await this.dependencies.source.read({ from, to, limit: this.dependencies.pilot.maxEvents }); this.tracker.elasticReadSucceeded(); }
      catch (error) { this.tracker.elasticReadFailed(sourceKind(error)); this.tracker.cycleFailed(); return result('SOURCE_FAILURE'); }
      eventsRead = raw.length;
      const normalized = normalizeBatch(raw); eventsNormalized = normalized.normalized;
      try {
        const current = await this.incidents.loadIncidents(); const persisted = await this.incidents.loadState();
        const relations = allRelations(normalized.events, this.correlation);
        const grouped = this.grouper.group({ events: normalized.events, relations, existingIncidents: current.incidents, referenceTime: to });
        incidentsCreated = grouped.created.length; incidentsUpdated = grouped.updated.length;
        // Dossiers first: if their persistence fails, incident membership is not
        // committed and the next overlapping cycle can rebuild the same context.
        for (const incident of [...grouped.created, ...grouped.updated].sort((a, b) => a.incidentId.localeCompare(b.incidentId))) {
          const eventMap = new Map(normalized.events.map((event) => [event.eventId, event]));
          const incidentEvents = incident.eventIds.map((eventId) => eventMap.get(eventId)).filter((event): event is NonNullable<typeof event> => Boolean(event));
          const dossier = buildDeterministicDossier({ context: this.context.build({ incident, events: incidentEvents, relations, normalizationSummary: { accepted: normalized.normalized, rejected: normalized.rejected, rejectedReasons: Object.keys(normalized.rejectedReasons) } }), generatedAt: to });
          await this.dossiers.save(dossier); dossiersGenerated++;
          let enriched = false;
          if (this.dependencies.llm.enabled) {
            llmAttempts++;
            try { const analysis = await this.analyzer.analyze({ dossier, generatedAt: to }); enriched = analysis.status === 'ENRICHED'; if (enriched) llmEnriched++; }
            catch { this.tracker.llmResult({ fallback: true, reachable: false }); }
          }
          await this.reviews.enqueue(dossier, enriched);
        }
        await this.incidents.saveIncidents(grouped.incidents);
        const updatedHealth = recordDossierHealth(recordProcessingHealth(persisted.health ?? emptyHealth(), { referenceTime: to, eventsProcessed: normalized.normalized, eventsRejected: normalized.rejected, incidentsCreated, incidentsUpdated }), { dossierGenerated: dossiersGenerated > 0 });
        await this.incidents.saveState(updatedHealth);
      } catch (error) {
        this.tracker.cycleFailed();
        return result(isPersistenceError(error) ? 'PERSISTENCE_FAILURE' : 'PROCESSING_FAILURE');
      }
      // Commit only after incident, dossier, review queue, and local state writes succeeded.
      const latestEventAt = normalized.events.map((event) => event.timestamp).filter((timestamp) => timestamp <= to).sort().at(-1);
      await this.state.saveWatermark({ schemaVersion: 1, source: 'alerts', committedAt: to, ...(latestEventAt ? { latestEventAt } : {}) });
      this.tracker.cycleCompleted({ eventsRead, eventsNormalized, incidentsCreated, incidentsUpdated, dossiersGenerated, durationMs: this.clock.now().getTime() - started });
      return result('COMPLETED');
    } catch (error) { this.tracker.cycleFailed(); return result(isPersistenceError(error) ? 'PERSISTENCE_FAILURE' : 'PROCESSING_FAILURE'); }
    finally { this.runningCycle = false; }

    function result(outcome: CycleResult['outcome']): CycleResult { return { outcome, from, to, eventsRead, eventsNormalized, incidentsCreated, incidentsUpdated, dossiersGenerated, llmAttempts, llmEnriched, durationMs: Math.max(0, Date.now() - started) }; }
  }
  /** Foreground loop: a slow cycle delays the next one; ticks never queue or overlap. */
  async run(): Promise<void> {
    if (!this.initialized) await this.start();
    while (!this.stopping) { await this.runOnce(); if (!this.stopping) await wait(this.dependencies.pilot.pollIntervalMs); }
  }
  private windowStart(latestEventAt: string | undefined, now: Date): Date {
    const fallback = new Date(now.getTime() - this.dependencies.pilot.initialWindowMs);
    if (!latestEventAt || Number.isNaN(Date.parse(latestEventAt))) return fallback;
    return new Date(Math.max(fallback.getTime(), Date.parse(latestEventAt) - this.dependencies.pilot.overlapMs));
  }
  private async sourcePreflight(): Promise<void> { await this.dependencies.source.preflight(); }
}

function allRelations(events: readonly import('../types.js').NormalizedEvent[], engine: CorrelationEngine): CorrelationRelation[] {
  const unique = new Map<string, CorrelationRelation>();
  for (const anchor of events) for (const relation of engine.correlate(anchor, events).relations) { const key = [relation.anchorEventId, relation.relatedEventId].sort().join('|'); if (!unique.has(key)) unique.set(key, relation); }
  return [...unique.values()].sort((a, b) => `${a.anchorEventId}|${a.relatedEventId}`.localeCompare(`${b.anchorEventId}|${b.relatedEventId}`));
}
function sourceKind(error: unknown): 'unreachable' | 'timeout' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'malformed_response' | 'request_failed' { const kind = error && typeof error === 'object' && 'kind' in error ? (error as { kind?: string }).kind : undefined; return kind === 'unauthorized' || kind === 'forbidden' || kind === 'rate_limited' || kind === 'timeout' || kind === 'malformed_response' || kind === 'request_failed' ? kind : 'unreachable'; }
function isPersistenceError(error: unknown): boolean { return error instanceof Error && /(store|dossier|watermark|queue|file|directory|lock|corrupt|snapshot|ENOSPC|EACCES)/i.test(error.message); }
function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
