import { ANALYST_LIMITS } from './constants.js';

export class ElasticSourceError extends Error {
  constructor(
    public readonly kind: 'unauthorized' | 'forbidden' | 'rate_limited' | 'timeout' | 'malformed_response' | 'request_failed',
    message: string,
  ) {
    super(message);
    this.name = 'ElasticSourceError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ElasticReadOnlyClient {
  private readonly baseUrl: string;

  constructor(
    url: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = ANALYST_LIMITS.httpTimeoutMs,
  ) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  async search(index: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${encodeURIComponent(index)}/_search?ignore_unavailable=true`, {
        method: 'POST',
        headers: { authorization: `ApiKey ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ElasticSourceError('timeout', 'Elasticsearch request timed out');
      }
      throw new ElasticSourceError('request_failed', 'Elasticsearch request failed');
    }
    if (response.status === 401) throw new ElasticSourceError('unauthorized', 'Elasticsearch authentication failed');
    if (response.status === 403) throw new ElasticSourceError('forbidden', 'Elasticsearch access was denied');
    if (response.status === 429) throw new ElasticSourceError('rate_limited', 'Elasticsearch rate limit reached');
    if (!response.ok) throw new ElasticSourceError('request_failed', `Elasticsearch request failed with HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new ElasticSourceError('malformed_response', 'Elasticsearch returned malformed JSON');
    }
  }
}
