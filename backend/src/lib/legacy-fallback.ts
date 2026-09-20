import { metrics } from '@opentelemetry/api';
import { logger } from './logger.js';
import { getTelemetryContextOrDefault } from './telemetry-context.js';

export const LEGACY_FALLBACK_METRIC = 'tapquiver.legacy_fallback.hits';
export type LegacyFallbackKind = 'operational_config' | 'direct_sales_compat' | 'cash_capability';
export type LegacyFallbackRecorder = (kind: LegacyFallbackKind) => void;

const counter = metrics.getMeter('tap-quiver-release').createCounter(LEGACY_FALLBACK_METRIC, {
  description: 'Runtime decisions that required a legacy fallback path',
});
export const recordLegacyFallback: LegacyFallbackRecorder = (kind) => {
  counter.add(1, { kind });
  const { env } = getTelemetryContextOrDefault();
  logger.info({
    'event.category': 'technical',
    'event.action': 'legacy_fallback',
    'event.outcome': 'success',
    'legacy.kind': kind,
    'data_stream.type': 'logs',
    'data_stream.dataset': 'technical',
    'data_stream.namespace': env,
    message: 'legacy_fallback',
  }, 'legacy_fallback');
};

export function createLegacyFallbackRecorder(add: (value: number, attributes: { kind: LegacyFallbackKind }) => void): LegacyFallbackRecorder {
  return (kind) => add(1, { kind });
}
