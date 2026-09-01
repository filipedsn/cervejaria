import { parseBenchmarkOutput, validateBenchmarkOutput } from '../llm-benchmark/validator.js';
import type { DeterministicDossier } from '../dossiers/types.js';
import type { LlmAnalysis, LlmValidationStatus } from './types.js';

export function validateLlmOutput(raw: string, dossier: DeterministicDossier): { output?: LlmAnalysis; flags: LlmValidationStatus[]; status: LlmValidationStatus } {
  let value: unknown;
  try { value = parseBenchmarkOutput(raw); } catch { return { flags: ['INVALID_RESPONSE'], status: 'INVALID_RESPONSE' }; }
  const result = validateBenchmarkOutput(value, dossier);
  const mapping: Record<string, LlmValidationStatus> = { SCHEMA_INVALID: 'INVALID_SCHEMA', UNKNOWN_FACT_ID: 'UNSUPPORTED_REFERENCE', UNSUPPORTED_HYPOTHESIS: 'UNSUPPORTED_REFERENCE', AUTHORITY_VIOLATION: 'AUTHORITY_VIOLATION', CAUSAL_LANGUAGE: 'CAUSAL_LANGUAGE', VULNERABILITY_CLAIM: 'VULNERABILITY_CLAIM', REMEDIATION: 'REMEDIATION_VIOLATION', PRIVACY_VIOLATION: 'PRIVACY_VIOLATION', UNSUPPORTED_REFERENCE: 'UNSUPPORTED_REFERENCE', MALFORMED_RESPONSE: 'INVALID_RESPONSE' };
  const flags = result.flags.map((flag): LlmValidationStatus => mapping[flag]!);
  const status = flags[0] ?? 'VALID';
  return { output: result.output ? { schemaVersion: 1, ...result.output } : undefined, flags: [...new Set(flags)].sort(), status };
}
