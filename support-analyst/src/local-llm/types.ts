import type { DeterministicDossier } from '../dossiers/types.js';

export const LOCAL_LLM_PROMPT_VERSION = 'prompt-v1' as const;
export type LlmAnalysis = {
  schemaVersion: 1;
  executiveSummary: string;
  analysis: string;
  hypotheses: Array<{ statement: string; supportingFactIds: string[] }>;
  gaps: string[];
  recommendedChecks: string[];
};
export type LlmValidationStatus = 'VALID' | 'INVALID_SCHEMA' | 'AUTHORITY_VIOLATION' | 'UNSUPPORTED_REFERENCE' | 'CAUSAL_LANGUAGE' | 'VULNERABILITY_CLAIM' | 'PRIVACY_VIOLATION' | 'REMEDIATION_VIOLATION' | 'TIMEOUT' | 'OLLAMA_UNAVAILABLE' | 'MODEL_UNAVAILABLE' | 'INVALID_RESPONSE' | 'INPUT_REJECTED';
export type LocalLlmAnalysisResult =
  | { status: 'ENRICHED'; analysis: LlmAnalysis; interactionId: string; enrichmentId: string }
  | { status: 'FALLBACK'; reason: Exclude<LlmValidationStatus, 'VALID'> | 'DISABLED' | 'INTERACTION_STORE_FAILURE'; interactionId?: string };
export type LlmEnrichment = { schemaVersion: 1; enrichmentId: string; dossierId: string; contextHash: string; model: string; promptVersion: typeof LOCAL_LLM_PROMPT_VERSION; generatedAt: string; status: 'VALID'; content: LlmAnalysis; interactionId: string };
export type LlmInteraction = {
  schemaVersion: 1; interactionId: string; dossierId: string; incidentId: string; contextHash: string; inputContextHash: string; timestamp: string;
  model: string; modelDigest?: string; quantization?: string; promptVersion: typeof LOCAL_LLM_PROMPT_VERSION;
  settings: { numCtx: number; temperature: number; seed: number; numPredict: number; timeoutMs: number; think: false; keepAlive: string };
  inputBytes: number; inputTokenCount?: number; outputTokenCount?: number; totalDurationMs?: number; loadDurationMs?: number; promptEvalDurationMs?: number; evalDurationMs?: number; tokensPerSecond?: number; processor?: string; sizeVram?: number;
  validationStatus: LlmValidationStatus | 'DISABLED'; validationFlags: LlmValidationStatus[]; llmStatus: 'DISABLED' | 'OK' | 'TIMEOUT' | 'UNAVAILABLE' | 'MODEL_UNAVAILABLE' | 'INVALID'; inputTruncated: boolean; enrichmentId?: string;
  input?: unknown; output?: LlmAnalysis;
};
export type LocalLlmDependencies = { fetchImpl?: typeof fetch; now?: () => Date; record?: (interaction: LlmInteraction) => Promise<void>; saveEnrichment?: (value: LlmEnrichment) => Promise<void> };
export type AnalyzeRequest = { dossier: DeterministicDossier; generatedAt: string };
