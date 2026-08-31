import type { NormalizationResult, RawEventDocument } from '../types.js';
import { normalizeAlert } from './alert.js';
import { normalizeAudit } from './audit.js';
import { eventIdFor, isRecord, normalizedTimestamp, validRawRef } from './shared.js';
import { normalizeTechnical } from './technical.js';

export function normalizeEvent(raw: RawEventDocument): NormalizationResult {
  if (!validRawRef(raw)) return { ok: false, reason: 'missing_raw_ref' };
  if (!isRecord(raw.source)) return { ok: false, reason: 'invalid_source_document' };
  const timestamp = normalizedTimestamp(raw.source);
  if (!timestamp.value) return { ok: false, reason: timestamp.reason! };
  const event = raw.sourceType === 'alert'
    ? normalizeAlert(raw, raw.source, timestamp.value)
    : raw.sourceType === 'audit'
      ? normalizeAudit(raw, raw.source, timestamp.value)
      : normalizeTechnical(raw, raw.source, timestamp.value);
  event.eventId = eventIdFor(raw);
  return { ok: true, event };
}

export { normalizeAlert } from './alert.js';
export { normalizeAudit } from './audit.js';
export { normalizeTechnical } from './technical.js';
