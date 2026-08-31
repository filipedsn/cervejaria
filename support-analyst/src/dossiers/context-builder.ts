import { createHash } from 'node:crypto';
import type { CorrelationRelation, CorrelationSourceFailure } from '../correlation.js';
import type { Incident, NormalizedEvent } from '../types.js';
import { sanitizeFreeText } from '../privacy/sanitize.js';
import { DOSSIER_LIMITS, type DossierContext, type DossierTimelineItem } from './types.js';

export type ContextBuilderInput = {
  incident: Incident;
  events: readonly NormalizedEvent[];
  relations: readonly CorrelationRelation[];
  sourceFailures?: readonly CorrelationSourceFailure[];
  normalizationSummary?: { accepted: number; rejected: number; rejectedReasons?: readonly string[] };
};

/** Pure projection of incident evidence. It reads neither stores, clocks, nor network. */
export class ContextBuilder {
  build(input: ContextBuilderInput): DossierContext {
    const events = uniqueEvents(input.events);
    const related = relationIndex(input.relations);
    const firstLast = new Set([input.incident.firstSeen, input.incident.lastSeen]);
    const selected = [...events]
      .sort((a, b) => priority(b, related.get(b.eventId) ?? [], firstLast) - priority(a, related.get(a.eventId) ?? [], firstLast) || compareEvent(a, b))
      .slice(0, DOSSIER_LIMITS.timeline)
      .map((event) => project(event, bestRelation(related.get(event.eventId) ?? [])))
      .sort(compareTimeline);
    return {
      schemaVersion: 1,
      incident: {
        incidentId: input.incident.incidentId, status: input.incident.status, class: input.incident.class,
        severity: input.incident.severity, confidence: input.incident.confidence, firstSeen: input.incident.firstSeen,
        lastSeen: input.incident.lastSeen, occurrences: input.incident.occurrences, ...(safe(input.incident.service) ? { service: safe(input.incident.service) } : {}),
        ...(safe(input.incident.route) ? { route: safe(input.incident.route) } : {}), releases: input.incident.affectedReleaseShas.map(safe).filter(isString).sort().slice(0, DOSSIER_LIMITS.releases),
        affectedTenantCount: Math.min(input.incident.affectedTenantCount, DOSSIER_LIMITS.tenants),
        incidentVersion: snapshotHash(input.incident)
      },
      timeline: selected,
      sourceFailures: [...(input.sourceFailures ?? [])].map((item) => ({ ...item })).sort((a, b) => `${a.source}:${a.kind}`.localeCompare(`${b.source}:${b.kind}`)),
      normalizationSummary: input.normalizationSummary ? {
        accepted: input.normalizationSummary.accepted, rejected: input.normalizationSummary.rejected,
        rejectedReasons: [...(input.normalizationSummary.rejectedReasons ?? [])].map(safe).filter(isString).sort()
      } : undefined,
      contextStats: { totalEvents: events.length, selectedEvents: selected.length, contextTruncated: events.length > selected.length }
    };
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function contextHash(context: DossierContext): string { return `ctx1:${sha256(canonicalJson(context))}`; }
export function snapshotHash(incident: Incident): string { return `inc1:${sha256(canonicalJson({ incidentId: incident.incidentId, status: incident.status, class: incident.class, severity: incident.severity, confidence: incident.confidence, firstSeen: incident.firstSeen, lastSeen: incident.lastSeen, occurrences: incident.occurrences, eventIds: [...incident.eventIds].sort(), releases: [...incident.affectedReleaseShas].sort(), tenants: [...incident.affectedTenantIds].sort(), service: incident.service, route: incident.route, signals: incident.signals, reasons: incident.reasons }))}`; }
export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function uniqueEvents(events: readonly NormalizedEvent[]): NormalizedEvent[] { return [...new Map(events.map((event) => [event.eventId, event])).values()]; }
function relationIndex(relations: readonly CorrelationRelation[]): Map<string, CorrelationRelation[]> { const result = new Map<string, CorrelationRelation[]>(); for (const relation of relations) for (const id of [relation.anchorEventId, relation.relatedEventId]) result.set(id, [...(result.get(id) ?? []), relation]); return result; }
function priority(event: NormalizedEvent, relations: readonly CorrelationRelation[], firstLast: Set<string>): number { let score = 0; if (event.source === 'alert') score += 1000; if (event.db?.category) score += 900; if ((event.http?.statusCode ?? 0) >= 500) score += 800; if (event.alert?.state || /availability/i.test(event.eventType ?? '')) score += 700; if (/auth/i.test(`${event.eventType ?? ''} ${event.action ?? ''} ${event.reasonCode ?? ''}`)) score += 600; if (event.realtime) score += 550; if (relations.some((relation) => relation.level === 'DETERMINISTIC')) score += 500; if (firstLast.has(event.timestamp)) score += 400; return score; }
function bestRelation(relations: readonly CorrelationRelation[]): CorrelationRelation | undefined { const order = { DETERMINISTIC: 0, STRONG: 1, PROBABLE: 2, WEAK: 3 }; return [...relations].sort((a, b) => order[a.level] - order[b.level] || `${a.anchorEventId}:${a.relatedEventId}`.localeCompare(`${b.anchorEventId}:${b.relatedEventId}`))[0]; }
function project(event: NormalizedEvent, relation?: CorrelationRelation): DossierTimelineItem { return compact({ eventId: safe(event.eventId) ?? 'unknown', timestamp: event.timestamp, source: event.source, eventType: safe(event.eventType), action: safe(event.action), severity: safe(event.severityText), http: event.http ? compact({ statusCode: event.http.statusCode, route: safe(event.http.route) }) : undefined, dbCategory: event.db?.category, realtimeReason: safe(event.realtime?.reasonCode), release: safe(event.releaseSha), tenant: safe(event.tenantId), relationLevel: relation?.level, relationReasons: relation?.reasons.map((reason) => ({ ...reason })).sort((a, b) => `${a.code}:${a.windowMinutes ?? ''}`.localeCompare(`${b.code}:${b.windowMinutes ?? ''}`)), rawRef: { index: safe(event.rawRef.index) ?? 'unknown', id: safe(event.rawRef.id) ?? 'unknown' } }) as DossierTimelineItem; }
function safe(value: string | undefined): string | undefined { if (!value) return undefined; const normalized = sanitizeFreeText(value, 240).replace(/[\r\n\t]/g, ' ').replace(/[<>]/g, '').trim(); return normalized || undefined; }
function isString(value: string | undefined): value is string { return typeof value === 'string'; }
function compact(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined)); }
function compareEvent(a: NormalizedEvent, b: NormalizedEvent): number { return a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId); }
function compareTimeline(a: DossierTimelineItem, b: DossierTimelineItem): number { return a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId); }
