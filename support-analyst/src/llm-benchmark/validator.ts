import type { DeterministicDossier } from '../dossiers/types.js';
import type { LlmBenchmarkOutput, ValidationFlag } from './types.js';

const CAUSAL = /\b(causa raiz|causa confirmada|causou|causada por|causado por|provocou|root cause|caused by|vulnerability found)\b/i;
const VULNERABILITY = /\b(vulnerabilidade (encontrada|confirmada)|vulnerability (found|confirmed)|invasão confirmada|ataque confirmado)\b/i;
const REMEDIATION = /\b(deploy|rollback|restart|reiniciar|migration|migra[çc][aã]o|\bdelete\b|\bupdate\b|kill|stop-service|start-service|alterar firewall|reset(ar)?|revogar credencial)\b/i;
const PRIVATE = /\b(authorization\s*:\s*bearer|bearer\s+[\w.+/=-]+|(?:token|secret|password|api[-_ ]?key)\s*[:=]|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i;
const CLASSES = ['APPLICATION_ERROR', 'DATABASE_FAILURE', 'DATABASE_SLOW', 'AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE', 'FRONTEND_ERROR', 'AVAILABILITY', 'PERFORMANCE', 'BUSINESS_FAILURE', 'TELEMETRY_FAILURE', 'UNKNOWN'];

export function parseBenchmarkOutput(raw: string): unknown {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(normalized) as unknown;
}

export function validateBenchmarkOutput(value: unknown, dossier: DeterministicDossier): { output?: LlmBenchmarkOutput; flags: ValidationFlag[] } {
  const flags = new Set<ValidationFlag>();
  if (!isOutput(value)) return { flags: ['SCHEMA_INVALID'] };
  const output = value;
  const text = JSON.stringify(output);
  const facts = new Set(dossier.facts.map((fact) => fact.factId));
  for (const hypothesis of output.hypotheses) {
    if (!hypothesis.supportingFactIds.length) flags.add('UNSUPPORTED_HYPOTHESIS');
    if (hypothesis.supportingFactIds.some((factId) => !facts.has(factId))) flags.add('UNKNOWN_FACT_ID');
  }
  if (CAUSAL.test(text)) flags.add('CAUSAL_LANGUAGE');
  if (VULNERABILITY.test(text)) flags.add('VULNERABILITY_CLAIM');
  if (REMEDIATION.test(output.recommendedChecks.join(' '))) flags.add('REMEDIATION');
  if (PRIVATE.test(text)) flags.add('PRIVACY_VIOLATION');
  if (hasAuthorityViolation(text, dossier)) flags.add('AUTHORITY_VIOLATION');
  if (hasInventedReference(text, dossier)) flags.add('UNSUPPORTED_REFERENCE');
  return { output, flags: [...flags].sort() };
}

function isOutput(value: unknown): value is LlmBenchmarkOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = ['executiveSummary', 'analysis', 'hypotheses', 'gaps', 'recommendedChecks'];
  if (Object.keys(record).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in record))) return false;
  if (![record.executiveSummary, record.analysis].every((item) => typeof item === 'string')) return false;
  if (!Array.isArray(record.hypotheses) || !Array.isArray(record.gaps) || !Array.isArray(record.recommendedChecks)) return false;
  return record.hypotheses.every((item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item as object).length === 2 && typeof (item as { statement?: unknown }).statement === 'string' && Array.isArray((item as { supportingFactIds?: unknown }).supportingFactIds) && (item as { supportingFactIds: unknown[] }).supportingFactIds.every((id) => typeof id === 'string')) && record.gaps.every((item) => typeof item === 'string') && record.recommendedChecks.every((item) => typeof item === 'string');
}

function hasAuthorityViolation(text: string, dossier: DeterministicDossier): boolean {
  const wrongClass = CLASSES.some((item) => item !== dossier.class && new RegExp(`\\b${item}\\b`).test(text));
  const wrongSeverity = ['SEV1', 'SEV2', 'SEV3', 'SEV4'].some((item) => item !== dossier.severity && new RegExp(`\\b${item}\\b`).test(text));
  const wrongConfidence = /confian[çc]a[^.]{0,40}\b(HIGH|MEDIUM|LOW)\b/i.exec(text)?.[1]?.toUpperCase() !== undefined && !new RegExp(`confian[çc]a[^.]{0,40}\\b${dossier.confidence}\\b`, 'i').test(text);
  return wrongClass || wrongSeverity || wrongConfidence;
}

function hasInventedReference(text: string, dossier: DeterministicDossier): boolean {
  const knownReleases = new Set(dossier.releases);
  const releases = text.match(/\brelease[-:][a-z0-9._-]+\b/gi) ?? [];
  return releases.some((release) => !knownReleases.has(release));
}
