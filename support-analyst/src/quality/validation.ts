import { GOLDEN_SCENARIOS, type QualityReview } from './types.js';

const fields = new Set(['schemaVersion', 'evaluationRunId', 'scenario', 'variant', 'hiddenSource', 'usefulness', 'factualFidelity', 'summaryQuality', 'hypothesisQuality', 'checkQuality', 'clarity', 'investigationValue', 'nextActionHelp', 'timeSaving', 'pairwisePreference', 'incrementalValue', 'comment']);
const score = (value: unknown): number | 'NOT_REVIEWED' => value === 'NOT_REVIEWED' ? value : typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5 ? value : fail('Scores must be 0–5 or NOT_REVIEWED.');
const choice = <T extends string>(value: unknown, allowed: readonly T[]): T => typeof value === 'string' && allowed.includes(value as T) ? value as T : fail(`Invalid review choice: ${String(value)}`);
function fail(message: string): never { throw new Error(message); }
export function sanitizeReviewComment(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') fail('Comment must be a string.');
  const text = value.replace(/[\r\n\t]+/g, ' ').replace(/\b(?:https?:\/\/|authorization|bearer\s+|token\s*[=:]|password\s*[=:]|secret\s*[=:]|api[-_ ]?key\s*[=:]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\S*/gi, '[REDACTED]').replace(/\s+/g, ' ').trim();
  if (text.length > 1_000) fail('Comment exceeds 1000 characters.');
  return text || undefined;
}
export function validateQualityReview(value: unknown, runId: string): QualityReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Review must be an object.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.has(key))) fail('Reviewer identity or unknown field is not accepted.');
  if (row.schemaVersion !== 1 || row.evaluationRunId !== runId) fail('Review schemaVersion or evaluationRunId is invalid.');
  const scenario = choice(row.scenario, GOLDEN_SCENARIOS); const variant = choice(row.variant, ['A', 'B'] as const);
  const hiddenSource = row.hiddenSource === undefined ? undefined : choice(row.hiddenSource, ['DETERMINISTIC', 'LLM'] as const);
  return { schemaVersion: 1, evaluationRunId: runId, scenario, variant, ...(hiddenSource ? { hiddenSource } : {}), usefulness: choice(row.usefulness, ['USEFUL', 'PARTIAL', 'WRONG', 'NOT_REVIEWED'] as const), factualFidelity: score(row.factualFidelity), summaryQuality: score(row.summaryQuality), hypothesisQuality: score(row.hypothesisQuality), checkQuality: score(row.checkQuality), clarity: score(row.clarity), investigationValue: score(row.investigationValue), nextActionHelp: choice(row.nextActionHelp, ['YES', 'PARTIALLY', 'NO', 'NOT_REVIEWED'] as const), timeSaving: choice(row.timeSaving, ['YES', 'MAYBE', 'NO', 'NOT_REVIEWED'] as const), pairwisePreference: choice(row.pairwisePreference, ['A_MUCH_BETTER', 'A_SLIGHTLY_BETTER', 'EQUIVALENT', 'B_SLIGHTLY_BETTER', 'B_MUCH_BETTER', 'NOT_REVIEWED'] as const), incrementalValue: choice(row.incrementalValue, ['MATERIAL_ANALYTICAL_VALUE', 'SMALL_ANALYTICAL_VALUE', 'PRESENTATION_ONLY', 'NO_VALUE', 'NEGATIVE_VALUE', 'NOT_REVIEWED'] as const), ...(sanitizeReviewComment(row.comment) ? { comment: sanitizeReviewComment(row.comment) } : {}) };
}
