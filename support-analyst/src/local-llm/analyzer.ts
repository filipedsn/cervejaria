import { createHash } from 'node:crypto';
import type { LocalLlmConfig } from '../config.js';
import { chatOllama } from '../llm-benchmark/client.js';
import { LlmInputBuilder } from './input-builder.js';
import { buildLocalLlmPrompt } from './prompt-v1.js';
import { getLoadedModelInfo, getModelInfo } from './client.js';
import { LOCAL_LLM_PROMPT_VERSION, type AnalyzeRequest, type LlmEnrichment, type LlmInteraction, type LocalLlmAnalysisResult, type LocalLlmDependencies, type LlmValidationStatus } from './types.js';
import { validateLlmOutput } from './validator.js';

export type LocalLlmCounters = { llmRequests: number; llmSuccesses: number; llmFallbacks: number; llmTimeouts: number; llmInvalidOutputs: number; llmGuardrailBlocks: number; llmTotalDurationMs: number };
type FallbackReason = Exclude<Extract<LocalLlmAnalysisResult, { status: 'FALLBACK' }>['reason'], 'VALID'>;
const settings = (config: LocalLlmConfig) => ({ numCtx: config.numCtx, temperature: 0.1, seed: 42, numPredict: 800, timeoutMs: config.timeoutMs, think: false as const, keepAlive: config.keepAlive });

export class LocalLlmAnalyzer {
  private readonly counters: LocalLlmCounters = { llmRequests: 0, llmSuccesses: 0, llmFallbacks: 0, llmTimeouts: 0, llmInvalidOutputs: 0, llmGuardrailBlocks: 0, llmTotalDurationMs: 0 };
  constructor(private readonly config: LocalLlmConfig, private readonly dependencies: LocalLlmDependencies = {}, private readonly inputBuilder = new LlmInputBuilder()) {}
  healthCounters(): Readonly<LocalLlmCounters> { return { ...this.counters }; }
  async analyze(request: AnalyzeRequest): Promise<LocalLlmAnalysisResult> {
    if (!this.config.enabled) return this.fallback('DISABLED');
    this.dependencies.healthObserver?.attempt();
    let input;
    try { input = this.inputBuilder.build(request.dossier); } catch { this.dependencies.healthObserver?.result({ fallback: true, invalid: true }); return this.fallback('INPUT_REJECTED'); }
    const interactionId = id('llmi1', `${request.dossier.dossierId}|${request.generatedAt}|${this.config.model}|${input.contextHash}`);
    const base = (status: LlmValidationStatus | 'DISABLED', llmStatus: LlmInteraction['llmStatus']): LlmInteraction => ({ schemaVersion: 1, interactionId, dossierId: request.dossier.dossierId, incidentId: request.dossier.incidentId, contextHash: request.dossier.contextHash, inputContextHash: input.contextHash, timestamp: request.generatedAt, model: this.config.model, promptVersion: LOCAL_LLM_PROMPT_VERSION, settings: settings(this.config), inputBytes: input.inputBytes, validationStatus: status, validationFlags: status === 'VALID' || status === 'DISABLED' ? [] : [status], llmStatus, inputTruncated: input.inputTruncated });
    this.counters.llmRequests += 1;
    let model;
    try { model = await getModelInfo(this.config.endpoint, this.config.model, this.dependencies.fetchImpl); }
    catch { this.dependencies.healthObserver?.result({ reachable: false, fallback: true }); return this.recordFallback(base('OLLAMA_UNAVAILABLE', 'UNAVAILABLE'), 'OLLAMA_UNAVAILABLE'); }
    if (!model) { this.dependencies.healthObserver?.result({ reachable: true, modelAvailable: false, fallback: true }); return this.recordFallback(base('MODEL_UNAVAILABLE', 'MODEL_UNAVAILABLE'), 'MODEL_UNAVAILABLE'); }
    const started = Date.now();
    try {
      const response = await chatOllama(this.config.endpoint, this.config.model, buildLocalLlmPrompt(input.context), settings(this.config), this.dependencies.fetchImpl);
      const loaded = await getLoadedModelInfo(this.config.endpoint, this.config.model, this.dependencies.fetchImpl).catch(() => ({}));
      const metrics = response.metrics; const totalDurationMs = ms(metrics.totalDuration); this.counters.llmTotalDurationMs += totalDurationMs ?? Date.now() - started;
      const validated = validateLlmOutput(response.content, request.dossier);
      const interaction = { ...base(validated.status, validated.status === 'VALID' ? 'OK' : 'INVALID'), modelDigest: model.digest, quantization: model.quantization, inputTokenCount: metrics.promptEvalCount, outputTokenCount: metrics.evalCount, totalDurationMs, loadDurationMs: ms(metrics.loadDuration), promptEvalDurationMs: ms(metrics.promptEvalDuration), evalDurationMs: ms(metrics.evalDuration), tokensPerSecond: metrics.evalCount && metrics.evalDuration ? Number((metrics.evalCount / (metrics.evalDuration / 1e9)).toFixed(3)) : undefined, ...loaded };
      if (validated.status !== 'VALID' || !validated.output) {
        if (validated.status === 'CAUSAL_LANGUAGE' || validated.status === 'UNSUPPORTED_REFERENCE' || validated.status === 'VULNERABILITY_CLAIM') this.counters.llmGuardrailBlocks += 1; else this.counters.llmInvalidOutputs += 1;
        this.dependencies.healthObserver?.result({ reachable: true, modelAvailable: true, fallback: true, invalid: !['CAUSAL_LANGUAGE', 'UNSUPPORTED_REFERENCE', 'VULNERABILITY_CLAIM'].includes(validated.status), guardrailBlock: ['CAUSAL_LANGUAGE', 'UNSUPPORTED_REFERENCE', 'VULNERABILITY_CLAIM'].includes(validated.status) });
        const safeForEvaluation = validated.output && !validated.flags.some((flag) => ['PRIVACY_VIOLATION', 'AUTHORITY_VIOLATION', 'REMEDIATION_VIOLATION', 'INVALID_SCHEMA', 'INVALID_RESPONSE'].includes(flag)) && validated.flags.some((flag) => flag === 'CAUSAL_LANGUAGE' || flag === 'UNSUPPORTED_REFERENCE');
        const safeOutput = safeForEvaluation ? { output: validated.output } : {};
        return this.recordFallback({ ...interaction, ...safeOutput }, validated.status as FallbackReason);
      }
      const enrichmentId = id('llme1', `${interactionId}|${request.generatedAt}`);
      const enrichment: LlmEnrichment = { schemaVersion: 1, enrichmentId, dossierId: request.dossier.dossierId, contextHash: request.dossier.contextHash, model: this.config.model, promptVersion: LOCAL_LLM_PROMPT_VERSION, generatedAt: request.generatedAt, status: 'VALID', content: validated.output, interactionId };
      try { await this.dependencies.saveEnrichment?.(enrichment); await this.dependencies.record?.({ ...interaction, enrichmentId, input: input.context, output: validated.output }); }
      catch { this.dependencies.healthObserver?.result({ reachable: true, modelAvailable: true, fallback: true }); return this.fallback('INTERACTION_STORE_FAILURE', interactionId); }
      this.counters.llmSuccesses += 1;
      this.dependencies.healthObserver?.result({ success: true, reachable: true, modelAvailable: true });
      return { status: 'ENRICHED', analysis: validated.output, interactionId, enrichmentId };
    } catch (error) {
      const timeout = error instanceof Error && error.name === 'AbortError'; if (timeout) this.counters.llmTimeouts += 1;
      this.dependencies.healthObserver?.result({ reachable: !timeout, modelAvailable: true, timeout, fallback: true });
      return this.recordFallback(base(timeout ? 'TIMEOUT' : 'OLLAMA_UNAVAILABLE', timeout ? 'TIMEOUT' : 'UNAVAILABLE'), timeout ? 'TIMEOUT' : 'OLLAMA_UNAVAILABLE');
    }
  }
  private async recordFallback(interaction: LlmInteraction, reason: FallbackReason): Promise<LocalLlmAnalysisResult> { try { await this.dependencies.record?.(interaction); } catch { return this.fallback('INTERACTION_STORE_FAILURE', interaction.interactionId); } return this.fallback(reason, interaction.interactionId); }
  private fallback(reason: FallbackReason, interactionId?: string): LocalLlmAnalysisResult { this.counters.llmFallbacks += 1; return { status: 'FALLBACK', reason, ...(interactionId ? { interactionId } : {}) }; }
}
function id(prefix: string, content: string): string { return `${prefix}:${createHash('sha256').update(content).digest('hex')}`; }
function ms(value: number | undefined): number | undefined { return value === undefined ? undefined : Number((value / 1_000_000).toFixed(3)); }
