import { requireRuntimeElasticsearchConfig, type AnalystConfig } from '../config.js';
import type { RawEventDocument } from '../types.js';
import { ALERT_SOURCE_FIELDS, ANALYST_LIMITS, DEV_INDICES, SIGNAL_SOURCE_FIELDS } from './constants.js';
import { ElasticReadOnlyClient, ElasticSourceError, type FetchLike } from './elastic.js';
import type { AlertSource, AroundOptions, FindAlertsOptions, LookupOptions, ReleaseServiceOptions, SignalSource, TimeRange } from './types.js';

type SourceType = RawEventDocument['sourceType'];

export { ANALYST_LIMITS, DEV_INDICES } from './constants.js';
export { ElasticReadOnlyClient, ElasticSourceError } from './elastic.js';
export type * from './types.js';

export class ElasticsearchSources implements AlertSource, SignalSource {
  constructor(private readonly client: ElasticReadOnlyClient) {}

  static fromConfig(config: AnalystConfig, env: Record<string, string | undefined>, fetchImpl?: FetchLike): ElasticsearchSources {
    const runtime = requireRuntimeElasticsearchConfig(config, env);
    if (!runtime.ok) throw new ElasticSourceError('request_failed', runtime.reason);
    return new ElasticsearchSources(new ElasticReadOnlyClient(runtime.config.elasticsearchUrl!, runtime.config.elasticsearchApiKey!, fetchImpl));
  }

  findAlertEvents(options: FindAlertsOptions): Promise<RawEventDocument[]> {
    const limit = boundedLimit(options.limit, ANALYST_LIMITS.alerts);
    const body: Record<string, unknown> = searchBody(rangeFilter(options.range), ALERT_SOURCE_FIELDS, limit);
    // DEV disables fielddata on _id; use the timestamp component of the local
    // cursor rather than requesting an unsafe _id sort from Elasticsearch.
    if (options.cursor) body.search_after = [options.cursor[0]];
    return this.find(DEV_INDICES.alerts, 'alert', body);
  }

  findByCorrelationId(correlationId: string, options: LookupOptions): Promise<RawEventDocument[]> {
    return this.findExact('attributes.correlationId.keyword', correlationId, options);
  }

  findByRequestId(requestId: string, options: LookupOptions): Promise<RawEventDocument[]> {
    return this.findExact('attributes.requestId.keyword', requestId, options);
  }

  findByTraceId(traceId: string, options: LookupOptions): Promise<RawEventDocument[]> {
    return this.findExact('trace_id.keyword', traceId, options);
  }

  findAuditAround(options: AroundOptions): Promise<RawEventDocument[]> {
    return this.findAround(DEV_INDICES.audit, 'audit', options);
  }

  findTechnicalAround(options: AroundOptions): Promise<RawEventDocument[]> {
    return this.findAround(DEV_INDICES.technical, 'technical', options);
  }

  async findByReleaseAndService(options: ReleaseServiceOptions): Promise<RawEventDocument[]> {
    validateIdentifier(options.releaseSha, 'releaseSha');
    validateIdentifier(options.service, 'service');
    const body = searchBody({ bool: { filter: [rangeFilter(options.range), { term: { 'attributes.releaseSha.keyword': options.releaseSha } }, { term: { 'attributes.service.keyword': options.service } }] } }, SIGNAL_SOURCE_FIELDS, boundedLimit(options.limit, ANALYST_LIMITS.fallbackPerSource));
    const [audit, technical] = await Promise.all([
      this.find(DEV_INDICES.audit, 'audit', body), this.find(DEV_INDICES.technical, 'technical', body),
    ]);
    return capTotal([...audit, ...technical]);
  }

  private async findExact(field: string, value: string, options: LookupOptions): Promise<RawEventDocument[]> {
    validateIdentifier(value, 'identifier');
    const body = searchBody({ bool: { filter: [rangeFilter(options.range), { term: { [field]: value } }] } }, SIGNAL_SOURCE_FIELDS, boundedLimit(options.limit, ANALYST_LIMITS.lookupPerSource));
    const [audit, technical] = await Promise.all([
      this.find(DEV_INDICES.audit, 'audit', body), this.find(DEV_INDICES.technical, 'technical', body),
    ]);
    return capTotal([...audit, ...technical]);
  }

  private findAround(index: string, sourceType: SourceType, options: AroundOptions): Promise<RawEventDocument[]> {
    const timestamp = Date.parse(options.timestamp);
    const windowMinutes = options.windowMinutes ?? ANALYST_LIMITS.initialAroundMinutes;
    if (Number.isNaN(timestamp) || windowMinutes < 1 || windowMinutes > ANALYST_LIMITS.maximumAroundMinutes) throw new ElasticSourceError('request_failed', 'Invalid bounded time window');
    const range: TimeRange = { from: new Date(timestamp - windowMinutes * 60_000).toISOString(), to: new Date(timestamp + windowMinutes * 60_000).toISOString() };
    return this.find(index, sourceType, searchBody(rangeFilter(range), SIGNAL_SOURCE_FIELDS, boundedLimit(options.limit, ANALYST_LIMITS.fallbackPerSource)));
  }

  private async find(index: string, sourceType: SourceType, body: unknown): Promise<RawEventDocument[]> {
    return rawDocuments(await this.client.search(index, body), sourceType);
  }
}

function searchBody(query: unknown, source: readonly string[], size: number): Record<string, unknown> {
  return { size, timeout: ANALYST_LIMITS.elasticTimeout, track_total_hits: false, _source: source, sort: [{ '@timestamp': 'asc' }], query };
}

function rangeFilter(range: TimeRange): unknown {
  if (Number.isNaN(Date.parse(range.from)) || Number.isNaN(Date.parse(range.to)) || Date.parse(range.from) > Date.parse(range.to)) throw new ElasticSourceError('request_failed', 'A valid bounded time range is required');
  return { range: { '@timestamp': { gte: range.from, lte: range.to } } };
}

function boundedLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new ElasticSourceError('request_failed', `Requested limit must be between 1 and ${maximum}`);
  return value;
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new ElasticSourceError('request_failed', `Invalid ${name}`);
}

function rawDocuments(response: unknown, sourceType: SourceType): RawEventDocument[] {
  if (!response || typeof response !== 'object' || !('hits' in response) || !response.hits || typeof response.hits !== 'object' || !('hits' in response.hits) || !Array.isArray(response.hits.hits)) throw new ElasticSourceError('malformed_response', 'Elasticsearch response has no valid hits array');
  return response.hits.hits.map((hit): RawEventDocument => {
    if (!hit || typeof hit !== 'object' || typeof hit._index !== 'string' || typeof hit._id !== 'string' || !hit._source || typeof hit._source !== 'object' || Array.isArray(hit._source)) throw new ElasticSourceError('malformed_response', 'Elasticsearch response contains an invalid hit');
    return { index: hit._index, id: hit._id, sourceType, source: hit._source };
  });
}

function capTotal(documents: RawEventDocument[]): RawEventDocument[] {
  return documents.sort((a, b) => `${a.index}\u0000${a.id}`.localeCompare(`${b.index}\u0000${b.id}`)).slice(0, ANALYST_LIMITS.totalBeforeNormalization);
}
