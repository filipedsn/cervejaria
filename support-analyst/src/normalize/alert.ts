import { sanitizeFreeText } from '../privacy/sanitize.js';
import type { NormalizedEvent, RawEventDocument } from '../types.js';
import { firstString, type SourceRecord } from './shared.js';

export function normalizeAlert(raw: RawEventDocument, source: SourceRecord, timestamp: string): NormalizedEvent {
  const reason = firstString(source, 'reason');
  return {
    schemaVersion: 1,
    eventId: '',
    timestamp,
    source: 'alert',
    environment: firstString(source, 'environment') === 'prd' ? 'prd' : firstString(source, 'environment') === 'dev' ? 'dev' : undefined,
    severityText: firstString(source, 'severity_text'),
    alert: {
      ruleName: firstString(source, 'ruleName'),
      state: firstString(source, 'alertState', 'state'),
      reason: reason ? sanitizeFreeText(reason) : undefined,
      url: firstString(source, 'viewInAppUrl', 'url')
    },
    rawRef: { index: raw.index, id: raw.id }
  };
}
