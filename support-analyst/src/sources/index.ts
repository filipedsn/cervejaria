import { requireRuntimeElasticsearchConfig, type AnalystConfig } from '../config.js';
import { toSafeErrorContext } from '../notify/privacy.js';
import type { RawEventDocument } from '../types.js';
import type { ErrorContext } from '../watch/types.js';
import { ALERT_SOURCE_FIELDS, ANALYST_LIMITS, DEV_INDICES, indicesFor, SIGNAL_SOURCE_FIELDS, type AnalystIndices } from './constants.js';
import { ElasticReadOnlyClient, ElasticSourceError, type FetchLike } from './elastic.js';
import type { AlertSource, AroundOptions, FindAlertsOptions, LookupOptions, ReleaseServiceOptions, SignalSource, TimeRange } from './types.js';

type SourceType = RawEventDocument['sourceType'];

export { ANALYST_LIMITS, DEV_INDICES, PRD_INDICES, indicesFor } from './constants.js';
export type { AnalystIndices } from './constants.js';
export { ElasticReadOnlyClient, ElasticSourceError } from './elastic.js';
export type * from './types.js';

export class ElasticsearchSources implements AlertSource, SignalSource {
  constructor(private readonly client: ElasticReadOnlyClient, private readonly indices: AnalystIndices = DEV_INDICES) {}

  static fromConfig(config: AnalystConfig, env: Record<string, string | undefined>, fetchImpl?: FetchLike): ElasticsearchSources {
    const runtime = requireRuntimeElasticsearchConfig(config, env);
    if (!runtime.ok) throw new ElasticSourceError('request_failed', runtime.reason);
    return new ElasticsearchSources(new ElasticReadOnlyClient(runtime.config.elasticsearchUrl!, runtime.config.elasticsearchApiKey!, fetchImpl), indicesFor(runtime.config.environment));
  }

  findAlertEvents(options: FindAlertsOptions): Promise<RawEventDocument[]> {
    const limit = boundedLimit(options.limit, ANALYST_LIMITS.alerts);
    const body: Record<string, unknown> = searchBody(rangeFilter(options.range), ALERT_SOURCE_FIELDS, limit);
    // DEV disables fielddata on _id; use the timestamp component of the local
    // cursor rather than requesting an unsafe _id sort from Elasticsearch.
    if (options.cursor) body.search_after = [options.cursor[0]];
    return this.find(this.indices.alerts, 'alert', body);
  }

  /** Strict bounded read used only by pilot startup to detect a missing approved index. */
  async preflightAlertSource(range: TimeRange): Promise<void> {
    await this.client.search(this.indices.alerts, searchBody(rangeFilter(range), ALERT_SOURCE_FIELDS, 1), { ignoreUnavailable: false });
  }

  findByCorrelationId(correlationId: string, options: LookupOptions): Promise<RawEventDocument[]> {
    return this.findExact('attributes.correlationId', correlationId, options);
  }

  findByRequestId(requestId: string, options: LookupOptions): Promise<RawEventDocument[]> {
    return this.findExact('attributes.requestId', requestId, options);
  }

  findByTraceId(traceId: string, options: LookupOptions): Promise<RawEventDocument[]> {
    return this.findExact('trace_id', traceId, options);
  }

  findAuditAround(options: AroundOptions): Promise<RawEventDocument[]> {
    return this.findAround(this.indices.audit, 'audit', options);
  }

  findTechnicalAround(options: AroundOptions): Promise<RawEventDocument[]> {
    return this.findAround(this.indices.technical, 'technical', options);
  }

  async findByReleaseAndService(options: ReleaseServiceOptions): Promise<RawEventDocument[]> {
    validateIdentifier(options.releaseSha, 'releaseSha');
    validateIdentifier(options.service, 'service');
    const body = searchBody({ bool: { filter: [rangeFilter(options.range), { term: { 'attributes.releaseSha': options.releaseSha } }, { term: { 'attributes.service': options.service } }] } }, SIGNAL_SOURCE_FIELDS, boundedLimit(options.limit, ANALYST_LIMITS.fallbackPerSource));
    const [audit, technical] = await Promise.all([
      this.find(this.indices.audit, 'audit', body), this.find(this.indices.technical, 'technical', body),
    ]);
    return capTotal([...audit, ...technical]);
  }

  private async findExact(field: string, value: string, options: LookupOptions): Promise<RawEventDocument[]> {
    validateIdentifier(value, 'identifier');
    const body = searchBody({ bool: { filter: [rangeFilter(options.range), { term: { [field]: value } }] } }, SIGNAL_SOURCE_FIELDS, boundedLimit(options.limit, ANALYST_LIMITS.lookupPerSource));
    const [audit, technical] = await Promise.all([
      this.find(this.indices.audit, 'audit', body), this.find(this.indices.technical, 'technical', body),
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

  /** Watch read: newest @timestamp in the last 6h, or undefined. */
  async latestTimestamp(index: string): Promise<string | undefined> {
    const response = await this.client.search(index, { size: 1, timeout: ANALYST_LIMITS.elasticTimeout, track_total_hits: false, _source: ['@timestamp'], sort: [{ '@timestamp': 'desc' }], query: { range: { '@timestamp': { gte: 'now-6h' } } } }) as { hits?: { hits?: Array<{ _source?: { '@timestamp'?: unknown } }> } };
    const value = response.hits?.hits?.[0]?._source?.['@timestamp'];
    return typeof value === 'string' ? value : undefined;
  }

  /** Watch read: bounded count over the last N minutes (1..1440). */
  async countLastMinutes(index: string, minutes: number, filters: unknown[]): Promise<number> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new ElasticSourceError('request_failed', 'Invalid bounded window');
    const response = await this.client.search(index, { size: 0, timeout: ANALYST_LIMITS.elasticTimeout, track_total_hits: true, query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutes}m` } } }, ...filters] } } }) as { hits?: { total?: { value?: unknown } } };
    const value = response.hits?.total?.value;
    return typeof value === 'number' ? value : 0;
  }

  /** Watch read: top route templates and correlation ids among ERROR logs (technical fields only). */
  async errorContext(index: string, minutes: number): Promise<ErrorContext> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new ElasticSourceError('request_failed', 'Invalid bounded window');
    const response = await this.client.search(index, {
      size: 0, timeout: ANALYST_LIMITS.elasticTimeout, track_total_hits: false,
      query: { bool: { filter: [{ range: { '@timestamp': { gte: `now-${minutes}m` } } }, { term: { severity_text: 'ERROR' } }] } },
      aggs: { routes: { terms: { field: 'attributes.http.route', size: 3 } }, correlations: { terms: { field: 'attributes.correlationId', size: 3 } } },
    }) as { aggregations?: { routes?: { buckets?: Array<{ key?: unknown; doc_count?: unknown }> }; correlations?: { buckets?: Array<{ key?: unknown }> } } };
    return toSafeErrorContext({
      routes: (response.aggregations?.routes?.buckets ?? []).map((bucket) => ({ route: bucket.key, count: bucket.doc_count })),
      correlationIds: (response.aggregations?.correlations?.buckets ?? []).map((bucket) => bucket.key),
    });
  }

  /** Raw bounded search for the journey command; the caller builds a capped body. */
  searchRaw(index: string, body: unknown): Promise<unknown> {
    return this.client.search(index, body);
  }

  indexNames(): AnalystIndices { return this.indices; }

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
