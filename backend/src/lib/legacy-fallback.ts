import { metrics } from '@opentelemetry/api';
import { emitTechnicalTelemetry, type LegacyFallbackKind } from './technical-telemetry-logger.js';

export const LEGACY_FALLBACK_METRIC = 'tapquiver.legacy_fallback.hits';
export type { LegacyFallbackKind } from './technical-telemetry-logger.js';
export type LegacyFallbackRecorder = (kind: LegacyFallbackKind) => void;

const counter = metrics.getMeter('tap-quiver-release').createCounter(LEGACY_FALLBACK_METRIC, {
  description: 'Runtime decisions that required a legacy fallback path',
});
export const recordLegacyFallback: LegacyFallbackRecorder = (kind) => {
  counter.add(1, { kind });
  emitTechnicalTelemetry({ action: 'legacy_fallback', legacyKind: kind });
};

export function createLegacyFallbackRecorder(add: (value: number, attributes: { kind: LegacyFallbackKind }) => void): LegacyFallbackRecorder {
  return (kind) => add(1, { kind });
}
