import { metrics } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { logger } from './logger.js';

export const LEGACY_FALLBACK_METRIC = 'tapquiver.legacy_fallback.hits';
export type LegacyFallbackKind = 'operational_config' | 'direct_sales_compat' | 'cash_capability';
export type LegacyFallbackRecorder = (kind: LegacyFallbackKind) => void;

const counter = metrics.getMeter('tap-quiver-release').createCounter(LEGACY_FALLBACK_METRIC, {
  description: 'Runtime decisions that required a legacy fallback path',
});
const fallbackLogger = logs.getLogger('tap-quiver-release', '1.0.0');

export const recordLegacyFallback: LegacyFallbackRecorder = (kind) => {
  counter.add(1, { kind });
  fallbackLogger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: 'legacy_fallback',
    attributes: { event: 'legacy_fallback', kind },
  });
  logger.info({ event: 'legacy_fallback', kind }, 'legacy_fallback');
};

export function createLegacyFallbackRecorder(add: (value: number, attributes: { kind: LegacyFallbackKind }) => void): LegacyFallbackRecorder {
  return (kind) => add(1, { kind });
}
