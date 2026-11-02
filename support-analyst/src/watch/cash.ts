import { formatBrasilia } from '../notify/format.js';
import { readDotted } from '../journey/normalize.js';
import type { WatchState } from './types.js';

/** Operation cash register only (decision of 2026-11-01): the legacy event cash is not announced. */
export const CASH_ACTIONS = {
  'transacao.cash_register_opened': { title: '🟢 Caixa aberto', when: 'abertoEm' },
  'transacao.cash_register_closed': { title: '🔴 Caixa fechado', when: 'fechadoEm' },
  'transacao.cash_register_administrative_closed': { title: '🟠 Caixa encerrado administrativamente', when: 'fechadoEm' },
} as const;
type CashAction = keyof typeof CASH_ACTIONS;

const PAGE_SIZE = 50;
/** Audit events reach Elastic after the OTel batch; re-read this much before the watermark. */
const OVERLAP_MS = 10 * 60_000;
/** After a long outage only the last day is announced. */
const MAX_CATCH_UP_MS = 24 * 60 * 60_000;

export type CashNoticeSearch = { searchRaw(index: string, body: unknown): Promise<unknown> };
export type CashNoticeSender = { send(kind: string, text: string): Promise<void>; flushPending(): Promise<void> };
export type CashNotice = { id: string; timestamp: string; text: string };

function text(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function buildCashQuery(from: Date, to: Date): Record<string, unknown> {
  return {
    size: PAGE_SIZE,
    timeout: '5s',
    track_total_hits: false,
    sort: [{ '@timestamp': 'asc' }],
    _source: ['@timestamp', 'attributes'],
    query: {
      bool: {
        filter: [
          { range: { '@timestamp': { gte: from.toISOString(), lte: to.toISOString() } } },
          { terms: { 'attributes.event.action': Object.keys(CASH_ACTIONS) } },
          { term: { 'attributes.event.outcome': 'success' } },
        ],
        must_not: [{ term: { 'attributes.test.synthetic': true } }],
      },
    },
  };
}

/**
 * The only fields read from the audit document: action, company, sales point, operator name and time.
 * The operator name is personal data, allowed in [CAIXA] by explicit decision of the owner (TAP-174).
 */
export function cashNoticeFromHit(source: Record<string, unknown>): CashNotice | undefined {
  const timestamp = text(source['@timestamp']);
  const a = source.attributes;
  const action = text(readDotted(a, 'event.action')) as CashAction | undefined;
  if (!timestamp || !action || !(action in CASH_ACTIONS)) return undefined;
  const spec = CASH_ACTIONS[action];
  const metadata = metadataOf(a);
  const empresa = text(metadata.empresaNome) ?? text(readDotted(a, 'cervejaria.slug')) ?? 'empresa não identificada';
  const unidade = text(metadata.pontoVendaNome);
  const operador = text(readDotted(a, 'user.name'));
  const when = text(metadata[spec.when]) ?? timestamp;
  const id = text(readDotted(a, 'event.id'), 100) ?? `${timestamp}|${action}|${text(readDotted(a, 'cervejaria.id')) ?? empresa}`;
  const lines = [`[CAIXA] ${spec.title}`, `Empresa: ${empresa}`];
  if (unidade) lines.push(`Unidade: ${unidade}`);
  if (operador) lines.push(`Por: ${operador}`);
  lines.push(`Quando: ${formatBrasilia(when)} (Brasília)`);
  return { id, timestamp, text: lines.join('\n') };
}

/** The OTLP exporter turns nested objects into JSON text (`attributes.metadata`); accept both shapes. */
function metadataOf(attributes: unknown): Record<string, unknown> {
  let value = readDotted(attributes, 'metadata');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hitSources(response: unknown): Array<Record<string, unknown>> {
  const hits = (response as { hits?: { hits?: unknown } } | undefined)?.hits?.hits;
  return (Array.isArray(hits) ? hits : [])
    .map((hit) => (hit && typeof hit === 'object' ? (hit as { _source?: unknown })._source : undefined))
    .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === 'object' && !Array.isArray(source));
}

/** Announces every operation cash open/close once. The first run only sets the watermark (no history). */
export class CashNotices {
  constructor(private readonly deps: { elastic: CashNoticeSearch; auditIndex: string; sender: CashNoticeSender }) {}

  async run(state: WatchState, now: Date): Promise<string[]> {
    if (!state.cash) {
      state.cash = { since: now.toISOString(), seen: {} };
      return [];
    }
    await this.deps.sender.flushPending();
    const since = Date.parse(state.cash.since);
    const from = new Date(Math.max((Number.isNaN(since) ? now.getTime() : since) - OVERLAP_MS, now.getTime() - MAX_CATCH_UP_MS));
    const sources = hitSources(await this.deps.elastic.searchRaw(this.deps.auditIndex, buildCashQuery(from, now)));
    const notified: string[] = [];
    for (const source of sources) {
      const notice = cashNoticeFromHit(source);
      if (!notice || state.cash.seen[notice.id]) continue;
      await this.deps.sender.send('CAIXA', notice.text);
      state.cash.seen[notice.id] = notice.timestamp;
      notified.push(`CAIXA:${notice.id}`);
    }
    const last = sources.at(-1)?.['@timestamp'];
    state.cash.since = sources.length === PAGE_SIZE && typeof last === 'string' ? last : now.toISOString();
    const keepAfter = Date.parse(state.cash.since) - 2 * OVERLAP_MS;
    for (const [id, timestamp] of Object.entries(state.cash.seen)) {
      if (Date.parse(timestamp) < keepAfter) delete state.cash.seen[id];
    }
    return notified;
  }
}
