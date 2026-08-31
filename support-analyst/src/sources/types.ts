import type { NormalizationFailure, RawEventDocument } from '../types.js';

export type TimeRange = { from: string; to: string };

export type AlertCursor = readonly [string, string];

export type FindAlertsOptions = {
  range: TimeRange;
  limit?: number;
  cursor?: AlertCursor;
};

export type LookupOptions = { range: TimeRange; limit?: number };

export type AroundOptions = { timestamp: string; windowMinutes?: number; limit?: number };

export type ReleaseServiceOptions = {
  releaseSha: string;
  service: string;
  range: TimeRange;
  limit?: number;
};

export interface AlertSource {
  findAlertEvents(options: FindAlertsOptions): Promise<RawEventDocument[]>;
}

export interface SignalSource {
  findByCorrelationId(correlationId: string, options: LookupOptions): Promise<RawEventDocument[]>;
  findByRequestId(requestId: string, options: LookupOptions): Promise<RawEventDocument[]>;
  findByTraceId(traceId: string, options: LookupOptions): Promise<RawEventDocument[]>;
  findAuditAround(options: AroundOptions): Promise<RawEventDocument[]>;
  findTechnicalAround(options: AroundOptions): Promise<RawEventDocument[]>;
  findByReleaseAndService(options: ReleaseServiceOptions): Promise<RawEventDocument[]>;
}

export type NormalizationSummary = {
  received: number;
  normalized: number;
  rejected: number;
  rejectedReasons: Partial<Record<NormalizationFailure, number>>;
};

export type NormalizedBatch = NormalizationSummary & { events: import('../types.js').NormalizedEvent[] };
