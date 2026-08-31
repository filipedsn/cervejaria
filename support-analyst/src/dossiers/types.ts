import type { CorrelationLevel, CorrelationReason, CorrelationSourceFailure } from '../correlation.js';
import type { Incident, IncidentClass, IncidentConfidence, IncidentSeverity, IncidentStatus, NormalizedEvent } from '../types.js';

export const DOSSIER_SCHEMA_VERSION = 1 as const;
export const DOSSIER_LIMITS = {
  timeline: 40,
  facts: 30,
  evidence: 50,
  hypotheses: 5,
  recommendedChecks: 10,
  releases: 10,
  tenants: 20,
  bytes: 1024 * 1024,
  feedbackLineBytes: 4 * 1024
} as const;

export type DossierFactType =
  | 'INCIDENT_CLASS' | 'INCIDENT_SEVERITY' | 'INCIDENT_CONFIDENCE' | 'OCCURRENCE_COUNT'
  | 'FIRST_LAST_SEEN' | 'SERVICE' | 'ROUTE' | 'RELEASE' | 'TENANT_IMPACT'
  | 'HTTP_FAILURES' | 'DB_FAILURES' | 'DB_SLOW' | 'AUTH_FAILURES' | 'REALTIME_FAILURES'
  | 'AVAILABILITY_SIGNAL' | 'CONTEXT_TRUNCATED';

export type DossierRawRef = { index: string; id: string };
export type DossierTimelineItem = {
  eventId: string;
  timestamp: string;
  source: NormalizedEvent['source'];
  eventType?: string;
  action?: string;
  severity?: string;
  http?: { statusCode?: number; route?: string };
  dbCategory?: NonNullable<NormalizedEvent['db']>['category'];
  realtimeReason?: string;
  release?: string;
  tenant?: string;
  relationLevel?: CorrelationLevel;
  relationReasons?: CorrelationReason[];
  rawRef: DossierRawRef;
};

export type DossierContext = {
  schemaVersion: 1;
  incident: Pick<Incident, 'incidentId' | 'status' | 'class' | 'severity' | 'confidence' | 'firstSeen' | 'lastSeen' | 'occurrences' | 'service' | 'route'> & {
    releases: string[];
    affectedTenantCount: number;
    incidentVersion: string;
  };
  timeline: DossierTimelineItem[];
  sourceFailures: CorrelationSourceFailure[];
  normalizationSummary?: { accepted: number; rejected: number; rejectedReasons: string[] };
  contextStats: { totalEvents: number; selectedEvents: number; contextTruncated: boolean };
};

export type DossierFact = { factId: string; type: DossierFactType; statement: string; evidenceRefs: string[] };
export type EvidenceRef = { evidenceId: string; eventId: string; rawRef: DossierRawRef; relationLevel?: CorrelationLevel; relationReasons?: CorrelationReason[] };
export type DossierHypothesis = { hypothesisId: string; statement: string; basedOnFactIds: string[]; supportLevel: 'SUPPORTED' | 'LIMITED' };
export type DossierGap = { gapId: string; statement: string };
export type DossierRecommendedCheck = { checkId: string; statement: string; basedOnFactIds: string[] };

export type DeterministicDossier = {
  schemaVersion: 1;
  dossierId: string;
  incidentId: string;
  incidentVersion: string;
  generatedAt: string;
  contextHash: string;
  status: IncidentStatus;
  class: IncidentClass;
  severity: IncidentSeverity;
  confidence: IncidentConfidence;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  service?: string;
  route?: string;
  releases: string[];
  affectedTenantCount: number;
  facts: DossierFact[];
  evidence: EvidenceRef[];
  timeline: DossierTimelineItem[];
  hypotheses: DossierHypothesis[];
  gaps: DossierGap[];
  recommendedChecks: DossierRecommendedCheck[];
  contextStats: DossierContext['contextStats'];
  analyst: { version: string; llmUsed: false };
};

export type DossierFeedbackFlag = 'CLASSIFICATION_WRONG' | 'SEVERITY_WRONG' | 'CORRELATION_WRONG' | 'DUPLICATE_WRONG' | 'MISSING_CONTEXT' | 'UNSUPPORTED_CLAIM' | 'RECOMMENDED_CHECKS_NOT_USEFUL' | 'OTHER';
export type DossierFeedback = {
  schemaVersion: 1;
  feedbackId: string;
  dossierId: string;
  createdAt: string;
  rating: 'USEFUL' | 'PARTIAL' | 'WRONG';
  flags?: DossierFeedbackFlag[];
  comment?: string;
};
