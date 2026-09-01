import type { DeterministicDossier } from '../dossiers/types.js';

export const LLM_BENCHMARK_SCHEMA_VERSION = 1 as const;
export const PROMPT_VERSION = 'prompt-v1' as const;
export const OUTPUT_SCHEMA_VERSION = 1 as const;

export const CANDIDATES = ['qwen3.5:9b-q4_K_M', 'gemma4:12b', 'phi4:14b'] as const;
export type CandidateModel = typeof CANDIDATES[number];
export type ScenarioName = 'DATABASE_FAILURE' | 'DATABASE_SLOW' | 'APPLICATION_ERROR' | 'AUTH_FAILURE' | 'AUTHORIZATION_DENIED' | 'REALTIME_AUTH_FAILURE' | 'TELEMETRY_FAILURE' | 'UNKNOWN' | 'SOURCE_FAILURE' | 'TRUNCATED_CONTEXT' | 'MULTIPLE_TENANTS' | 'MULTIPLE_RELEASES';
export type ValidationFlag = 'MALFORMED_RESPONSE' | 'SCHEMA_INVALID' | 'UNKNOWN_FACT_ID' | 'UNSUPPORTED_HYPOTHESIS' | 'AUTHORITY_VIOLATION' | 'CAUSAL_LANGUAGE' | 'VULNERABILITY_CLAIM' | 'REMEDIATION' | 'PRIVACY_VIOLATION' | 'UNSUPPORTED_REFERENCE';

export type LlmBenchmarkOutput = {
  executiveSummary: string;
  analysis: string;
  hypotheses: Array<{ statement: string; supportingFactIds: string[] }>;
  gaps: string[];
  recommendedChecks: string[];
};

export type LlmBenchmarkSettings = { numCtx: number; temperature: number; seed: number; numPredict: number; timeoutMs: number; think: false };
export type LlmBenchmarkInteraction = {
  schemaVersion: 1;
  runId: string;
  interactionId: string;
  timestamp: string;
  scenario: ScenarioName;
  model: CandidateModel;
  modelDigest?: string;
  quantization?: string;
  promptVersion: typeof PROMPT_VERSION;
  contextHash: string;
  settings: LlmBenchmarkSettings;
  inputTokenCount?: number;
  outputTokenCount?: number;
  totalDurationMs?: number;
  loadDurationMs?: number;
  promptEvalDurationMs?: number;
  evalDurationMs?: number;
  tokensPerSecond?: number;
  processor?: string;
  sizeVram?: number;
  output?: LlmBenchmarkOutput;
  schemaValid: boolean;
  validationFlags: ValidationFlag[];
  status: 'OK' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'ERROR' | 'UNSAFE_OUTPUT';
};

export type BenchmarkScenario = { name: ScenarioName; dossier: DeterministicDossier };
