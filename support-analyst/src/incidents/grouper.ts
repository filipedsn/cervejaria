import type { CorrelationConflict, CorrelationRelation, CorrelationSourceFailure } from '../correlation.js';
import { assessConfidence, assessSeverity } from './engines.js';
import { classifyEvent } from './classifier.js';
import { fingerprintFor, incidentIdFor, normalizeIncidentRoute } from './fingerprint.js';
import type { Incident, IncidentReason, IncidentSignals, NormalizedEvent } from '../types.js';

export const INCIDENT_GROUP_WINDOW_MS = 30 * 60_000;
export const INCIDENT_CLOSE_WINDOW_MS = 60 * 60_000;

export type GroupingDecision = { eventId: string; incidentId?: string; code: string };
export type GroupingInput = {
  events: readonly NormalizedEvent[];
  relations: readonly CorrelationRelation[];
  existingIncidents: readonly Incident[];
  referenceTime: string;
  conflicts?: readonly CorrelationConflict[];
  sourceFailures?: readonly CorrelationSourceFailure[];
};
export type GroupingResult = { incidents: Incident[]; created: Incident[]; updated: Incident[]; ungroupedEventIds: string[]; decisions: GroupingDecision[] };

/** Deterministic and replay-safe: all time comes from the caller or events. */
export class IncidentGrouper {
  group(input: GroupingInput): GroupingResult {
    const uniqueEvents = new Map<string, NormalizedEvent>();
    for (const event of input.events) if (!uniqueEvents.has(event.eventId)) uniqueEvents.set(event.eventId, event);
    const incidents = input.existingIncidents.map((incident) => structuredClone(incident));
    const before = new Map(incidents.map((incident) => [incident.incidentId, JSON.stringify(incident)]));
    const referenceTime = parseTime(input.referenceTime);
    for (const incident of incidents) closeEligible(incident, referenceTime);
    const eventToIncident = new Map<string, string>();
    for (const incident of incidents) for (const eventId of incident.eventIds) eventToIncident.set(eventId, incident.incidentId);
    const decisions: GroupingDecision[] = [];
    const conflicts = input.conflicts ?? [];
    const failures = input.sourceFailures ?? [];
    const relationsByEvent = relationIndex(input.relations);
    for (const event of [...uniqueEvents.values()].sort(compareEvent)) {
      const classification = classifyEvent(event);
      const fingerprint = fingerprintFor(event, classification.class);
      const knownIncidentId = eventToIncident.get(event.eventId);
      if (knownIncidentId) { decisions.push({ eventId: event.eventId, incidentId: knownIncidentId, code: 'DUPLICATE_EVENT_ID' }); continue; }
      const deterministic = deterministicCandidate(event.eventId, relationsByEvent, eventToIncident, incidents, event, classification.class);
      const candidate = deterministic ?? fingerprintCandidate(incidents, fingerprint, event.timestamp);
      if (candidate) {
        addEvent(candidate, event, classification.reasons, input.relations, conflicts, failures);
        eventToIncident.set(event.eventId, candidate.incidentId);
        decisions.push({ eventId: event.eventId, incidentId: candidate.incidentId, code: deterministic ? 'DETERMINISTIC_RELATION_EXISTING_INCIDENT' : 'SAME_INCIDENT_FINGERPRINT' });
      } else {
        const created = createIncident(event, classification, fingerprint, input.relations, conflicts, failures);
        incidents.push(created); eventToIncident.set(event.eventId, created.incidentId);
        decisions.push({ eventId: event.eventId, incidentId: created.incidentId, code: 'NEW_INCIDENT' });
      }
    }
    for (const incident of incidents) recalculate(incident);
    const created = incidents.filter((incident) => !before.has(incident.incidentId));
    const updated = incidents.filter((incident) => before.has(incident.incidentId) && before.get(incident.incidentId) !== JSON.stringify(incident));
    return { incidents: incidents.sort((a, b) => a.incidentId.localeCompare(b.incidentId)), created, updated, ungroupedEventIds: [], decisions };
  }
}

function createIncident(event: NormalizedEvent, classification: ReturnType<typeof classifyEvent>, fingerprint: string, relations: readonly CorrelationRelation[], conflicts: readonly CorrelationConflict[], failures: readonly CorrelationSourceFailure[]): Incident {
  const signals = signalsFor(event, relations, conflicts, failures);
  const incident: Incident = {
    schemaVersion: 1, incidentId: incidentIdFor(fingerprint, event.timestamp), fingerprint, status: 'NEW', class: classification.class,
    severity: 'SEV4', confidence: 'LOW', firstSeen: event.timestamp, lastSeen: event.timestamp, occurrences: 1, eventIds: [event.eventId],
    affectedTenantIds: event.tenantId ? [event.tenantId] : [], affectedTenantCount: event.tenantId ? 1 : 0,
    affectedReleaseShas: event.releaseSha ? [event.releaseSha] : [], service: event.service, route: normalizeIncidentRoute(event.http?.route), signals,
    reasons: [...classification.reasons, { code: 'NEW_INCIDENT' }], createdAt: event.timestamp, updatedAt: event.timestamp
  };
  recalculate(incident); return incident;
}

function addEvent(incident: Incident, event: NormalizedEvent, classificationReasons: IncidentReason[], relations: readonly CorrelationRelation[], conflicts: readonly CorrelationConflict[], failures: readonly CorrelationSourceFailure[]): void {
  if (incident.eventIds.includes(event.eventId)) return;
  incident.eventIds = sorted([...incident.eventIds, event.eventId]);
  incident.occurrences = incident.eventIds.length;
  incident.lastSeen = maxTime(incident.lastSeen, event.timestamp);
  incident.status = 'OBSERVING';
  incident.affectedTenantIds = sorted([...incident.affectedTenantIds, ...(event.tenantId ? [event.tenantId] : [])]);
  incident.affectedTenantCount = incident.affectedTenantIds.length;
  incident.affectedReleaseShas = sorted([...incident.affectedReleaseShas, ...(event.releaseSha ? [event.releaseSha] : [])]);
  mergeSignals(incident.signals, signalsFor(event, relations, conflicts, failures));
  incident.reasons = uniqueReasons([...incident.reasons, ...classificationReasons, { code: 'INCIDENT_OCCURRENCE_ADDED' }]);
  incident.updatedAt = incident.lastSeen;
}

function recalculate(incident: Incident): void {
  const severity = assessSeverity(incident); const confidence = assessConfidence(incident);
  incident.severity = severity.severity; incident.confidence = confidence.confidence;
  incident.reasons = uniqueReasons([...incident.reasons, ...severity.reasons, ...confidence.reasons]);
}

function deterministicCandidate(eventId: string, indexed: Map<string, CorrelationRelation[]>, eventToIncident: Map<string, string>, incidents: Incident[], event: NormalizedEvent, incidentClass: Incident['class']): Incident | undefined {
  for (const relation of indexed.get(eventId) ?? []) {
    if (relation.level !== 'DETERMINISTIC') continue;
    const other = relation.anchorEventId === eventId ? relation.relatedEventId : relation.anchorEventId;
    const candidate = incidents.find((incident) => incident.incidentId === eventToIncident.get(other));
    if (candidate && candidate.class === incidentClass && releaseCompatible(candidate, event) && candidate.status !== 'CLOSED') return candidate;
  }
  return undefined;
}
function fingerprintCandidate(incidents: Incident[], fingerprint: string, timestamp: string): Incident | undefined {
  return incidents.filter((incident) => incident.fingerprint === fingerprint && incident.status !== 'CLOSED' && withinWindow(incident.lastSeen, timestamp)).sort((a, b) => a.incidentId.localeCompare(b.incidentId))[0];
}
function releaseCompatible(incident: Incident, event: NormalizedEvent): boolean { return incident.affectedReleaseShas.length === 0 || !event.releaseSha || incident.affectedReleaseShas.includes(event.releaseSha); }
function withinWindow(lastSeen: string, timestamp: string): boolean { return Math.abs(parseTime(lastSeen) - parseTime(timestamp)) <= INCIDENT_GROUP_WINDOW_MS; }
function closeEligible(incident: Incident, reference: number): void { if (incident.status !== 'CLOSED' && reference - parseTime(incident.lastSeen) >= INCIDENT_CLOSE_WINDOW_MS) { incident.status = 'CLOSED'; incident.updatedAt = new Date(reference).toISOString(); incident.reasons = uniqueReasons([...incident.reasons, { code: 'CLOSED_INACTIVE_WINDOW' }]); } }
function relationIndex(relations: readonly CorrelationRelation[]): Map<string, CorrelationRelation[]> { const result = new Map<string, CorrelationRelation[]>(); for (const relation of relations) for (const id of [relation.anchorEventId, relation.relatedEventId]) result.set(id, [...(result.get(id) ?? []), relation]); return result; }
function signalsFor(event: NormalizedEvent, relations: readonly CorrelationRelation[], conflicts: readonly CorrelationConflict[], failures: readonly CorrelationSourceFailure[]): IncidentSignals {
  const related = relations.filter((relation) => relation.anchorEventId === event.eventId || relation.relatedEventId === event.eventId);
  const eventConflicts = conflicts.filter((conflict) => conflict.anchorEventId === event.eventId || conflict.relatedEventId === event.eventId);
  return { sources: [event.source], dbCategories: event.db?.category ? [event.db.category] : [], maxHttpStatus: event.http?.statusCode,
    hasAvailabilitySignal: classifyEvent(event).class === 'AVAILABILITY', deterministicRelationCount: related.filter((r) => r.level === 'DETERMINISTIC').length,
    nonWeakRelationCount: related.filter((r) => r.level !== 'WEAK').length, weakRelationCount: related.filter((r) => r.level === 'WEAK').length,
    conflictCount: eventConflicts.length, sourceFailureCount: failures.length };
}
function mergeSignals(target: IncidentSignals, source: IncidentSignals): void { target.sources = sorted([...target.sources, ...source.sources]); target.dbCategories = sorted([...target.dbCategories, ...source.dbCategories]); target.maxHttpStatus = Math.max(target.maxHttpStatus ?? 0, source.maxHttpStatus ?? 0) || undefined; target.hasAvailabilitySignal ||= source.hasAvailabilitySignal; target.deterministicRelationCount += source.deterministicRelationCount; target.nonWeakRelationCount += source.nonWeakRelationCount; target.weakRelationCount += source.weakRelationCount; target.conflictCount += source.conflictCount; target.sourceFailureCount += source.sourceFailureCount; }
function sorted<T extends string>(values: T[]): T[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function uniqueReasons(reasons: IncidentReason[]): IncidentReason[] { const seen = new Set<string>(); return reasons.filter((reason) => { const key = `${reason.code}:${reason.detail ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => `${a.code}:${a.detail ?? ''}`.localeCompare(`${b.code}:${b.detail ?? ''}`)); }
function compareEvent(a: NormalizedEvent, b: NormalizedEvent): number { return a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId); }
function parseTime(value: string): number { const time = Date.parse(value); if (Number.isNaN(time)) throw new Error('Incident grouping requires valid ISO timestamps'); return time; }
function maxTime(a: string, b: string): string { return parseTime(a) >= parseTime(b) ? a : b; }
