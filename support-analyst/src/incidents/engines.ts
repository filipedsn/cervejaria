import type { Incident, IncidentConfidence, IncidentReason, IncidentSeverity } from '../types.js';

export type SeverityResult = { severity: IncidentSeverity; ruleId: string; reasons: IncidentReason[] };
export type ConfidenceResult = { confidence: IncidentConfidence; ruleId: string; reasons: IncidentReason[] };

export function assessSeverity(incident: Pick<Incident, 'class' | 'occurrences' | 'affectedTenantCount' | 'signals'>): SeverityResult {
  const s = incident.signals;
  const authOnly = ['AUTH_FAILURE', 'AUTHORIZATION_DENIED', 'REALTIME_AUTH_FAILURE'].includes(incident.class) && !s.hasAvailabilitySignal && !s.dbCategories.includes('CONNECTION') && (s.maxHttpStatus ?? 0) < 500;
  if (s.hasAvailabilitySignal && incident.affectedTenantCount >= 3 && incident.occurrences >= 3) return result('SEV1', 'SEV1_CONFIRMED_BROAD_AVAILABILITY');
  if (s.hasAvailabilitySignal && s.dbCategories.includes('CONNECTION') && incident.occurrences >= 3) return result('SEV1', 'SEV1_RECURRING_DB_CONNECTION_AVAILABILITY');
  if ((incident.class === 'DATABASE_FAILURE' && incident.occurrences >= 2) || ((s.maxHttpStatus ?? 0) >= 500 && incident.occurrences >= 2) || (s.hasAvailabilitySignal && incident.affectedTenantCount >= 2)) return capAuth(result('SEV2', 'SEV2_RECURRING_TECHNICAL_OR_MULTI_TENANT'), authOnly);
  if (incident.class === 'TELEMETRY_FAILURE' || incident.class === 'UNKNOWN' || incident.occurrences === 1 && s.nonWeakRelationCount === 0 && !authOnly) return result('SEV4', 'SEV4_ISOLATED_OR_WEAK');
  return capAuth(result('SEV3', 'SEV3_LIMITED_CONFIRMED_IMPACT'), authOnly);
}

export function assessConfidence(incident: Pick<Incident, 'class' | 'occurrences' | 'service' | 'affectedReleaseShas' | 'signals'>): ConfidenceResult {
  const s = incident.signals;
  if (s.sourceFailureCount || s.conflictCount || incident.class === 'UNKNOWN' || (s.weakRelationCount > 0 && s.nonWeakRelationCount === 0)) return confidence('LOW', 'CONFIDENCE_PENALTY_INCOMPLETE_OR_CONFLICTING');
  if (s.deterministicRelationCount > 0 && s.sources.length >= 2) return confidence('HIGH', 'CONFIDENCE_DETERMINISTIC_CROSS_SOURCE');
  if (incident.occurrences >= 3 && Boolean(incident.service) && incident.affectedReleaseShas.length > 0) return confidence('HIGH', 'CONFIDENCE_REPEATED_STABLE_SIGNATURE');
  if (incident.occurrences >= 2 || (Boolean(incident.service) && incident.affectedReleaseShas.length > 0)) return confidence('MEDIUM', 'CONFIDENCE_CONSISTENT_CONTEXT');
  return confidence('LOW', 'CONFIDENCE_ISOLATED_EVENT');
}

function result(severity: IncidentSeverity, ruleId: string): SeverityResult { return { severity, ruleId, reasons: [{ code: ruleId }] }; }
function confidence(value: IncidentConfidence, ruleId: string): ConfidenceResult { return { confidence: value, ruleId, reasons: [{ code: ruleId }] }; }
function capAuth(value: SeverityResult, authOnly: boolean): SeverityResult { return authOnly && value.severity === 'SEV2' ? result('SEV3', 'SEV3_AUTH_SIGNAL_CAP') : value; }
