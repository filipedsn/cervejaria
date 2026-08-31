import { normalizeEvent } from '../normalize/index.js';
import type { RawEventDocument } from '../types.js';
import { ANALYST_LIMITS } from './constants.js';
import type { NormalizedBatch } from './types.js';

export function normalizeBatch(rawEvents: readonly RawEventDocument[]): NormalizedBatch {
  const boundedEvents = [...rawEvents]
    .sort((a, b) => `${a.index}\u0000${a.id}`.localeCompare(`${b.index}\u0000${b.id}`))
    .slice(0, ANALYST_LIMITS.totalBeforeNormalization);
  const events = [] as NormalizedBatch['events'];
  const rejectedReasons: NormalizedBatch['rejectedReasons'] = {};
  for (const raw of boundedEvents) {
    const result = normalizeEvent(raw);
    if (result.ok) events.push(result.event);
    else rejectedReasons[result.reason] = (rejectedReasons[result.reason] ?? 0) + 1;
  }
  return { received: boundedEvents.length, normalized: events.length, rejected: boundedEvents.length - events.length, rejectedReasons, events };
}
