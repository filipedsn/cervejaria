import type { LlmInteraction, LlmValidationStatus } from '../local-llm/types.js';
import type { ScenarioName } from '../llm-benchmark/types.js';

export const QUALITY_SCHEMA_VERSION = 1 as const;
export const GOLDEN_SET_VERSION = 'golden-set-v1' as const;
export const GOLDEN_SCENARIOS: readonly ScenarioName[] = ['DATABASE_FAILURE', 'DATABASE_SLOW', 'APPLICATION_ERROR', 'AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE', 'TELEMETRY_FAILURE', 'UNKNOWN', 'SOURCE_FAILURE', 'TRUNCATED_CONTEXT', 'MULTIPLE_TENANTS', 'MULTIPLE_RELEASES'];
export type DeterministicBrief = { summary: string; hypotheses: string[]; gaps: string[]; recommendedChecks: string[] };
export type Variant = 'A' | 'B';
export type HiddenSource = 'DETERMINISTIC' | 'LLM';
export type BlindMapping = Record<ScenarioName, Record<Variant, HiddenSource>>;
export type QualityEvaluationRun = {
  schemaVersion: 1; runId: string; timestamp: string; gitSha?: string; model: string; digest?: string; quantization?: string;
  promptVersion: 'prompt-v1'; settings: LlmInteraction['settings']; goldenSetVersion: typeof GOLDEN_SET_VERSION;
  scenarioCount: number; repeats: number; reviewSeed: number; status: 'TECHNICAL_RUN_COMPLETE_HUMAN_REVIEW_REQUIRED';
};
export type QualityInteraction = { scenario: ScenarioName; repetition: number; status: 'ENRICHED' | 'LLM_VARIANT_UNAVAILABLE'; interactionId?: string; fallbackReason?: string; validationFlags: LlmValidationStatus[]; metrics?: Pick<LlmInteraction, 'totalDurationMs' | 'loadDurationMs' | 'inputTokenCount' | 'outputTokenCount' | 'tokensPerSecond' | 'processor' | 'sizeVram' | 'modelDigest' | 'quantization'>; analysis?: { executiveSummary: string; hypotheses: Array<{ statement: string; supportingFactIds: string[] }>; gaps: string[]; recommendedChecks: string[] } };
export type QualityReview = {
  schemaVersion: 1; evaluationRunId: string; scenario: ScenarioName; variant: Variant; hiddenSource?: HiddenSource;
  usefulness: 'USEFUL' | 'PARTIAL' | 'WRONG' | 'NOT_REVIEWED'; factualFidelity: number | 'NOT_REVIEWED'; summaryQuality: number | 'NOT_REVIEWED'; hypothesisQuality: number | 'NOT_REVIEWED'; checkQuality: number | 'NOT_REVIEWED'; clarity: number | 'NOT_REVIEWED'; investigationValue: number | 'NOT_REVIEWED'; nextActionHelp: 'YES' | 'PARTIALLY' | 'NO' | 'NOT_REVIEWED'; timeSaving: 'YES' | 'MAYBE' | 'NO' | 'NOT_REVIEWED'; pairwisePreference: 'A_MUCH_BETTER' | 'A_SLIGHTLY_BETTER' | 'EQUIVALENT' | 'B_SLIGHTLY_BETTER' | 'B_MUCH_BETTER' | 'NOT_REVIEWED'; incrementalValue: 'MATERIAL_ANALYTICAL_VALUE' | 'SMALL_ANALYTICAL_VALUE' | 'PRESENTATION_ONLY' | 'NO_VALUE' | 'NEGATIVE_VALUE' | 'NOT_REVIEWED'; comment?: string;
};
