import { logs, SeverityNumber, type Logger } from '@opentelemetry/api-logs';

import { getObservabilityEnv } from './telemetry-context.js';

export const TECHNICAL_TELEMETRY_DATASET = 'technical';
export const LEGACY_FALLBACK_KINDS = [
  'operational_config',
  'direct_sales_compat',
  'cash_capability',
] as const;

export type LegacyFallbackKind = (typeof LEGACY_FALLBACK_KINDS)[number];
export type TechnicalTelemetryEvent =
  | { action: 'legacy_fallback'; legacyKind: LegacyFallbackKind }
  | { action: 'technical_telemetry_probe'; probeId: string };
type TechnicalTelemetryLogger = Pick<Logger, 'emit'>;

function getTechnicalLogger(): TechnicalTelemetryLogger {
  // Reuse the SDK resource/instance and exporter; a second provider can drift
  // from the process identity and bypass coordinated shutdown.
  return logs.getLogger('quiver-tap-technical', '1.0.0');
}

export function initializeTechnicalTelemetry(): void { getTechnicalLogger(); }

export async function forceFlushTechnicalTelemetry(): Promise<void> {
  const provider = logs.getLoggerProvider() as { forceFlush?: () => Promise<void> };
  await provider.forceFlush?.();
}

/** The single SDK owner drains this provider together with metrics/traces. */
export async function shutdownTechnicalTelemetry(): Promise<void> {}

export function isLegacyFallbackKind(value: string): value is LegacyFallbackKind {
  return (LEGACY_FALLBACK_KINDS as readonly string[]).includes(value);
}

/** Builds the small technical-log contract with collector routing on the LogRecord. */
export function buildTechnicalTelemetryRecord(event: TechnicalTelemetryEvent): {
  severityNumber: SeverityNumber;
  severityText: string;
  body: string;
  attributes: Record<string, string>;
} {
  return {
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: event.action,
    attributes: {
      'event.category': 'technical',
      'event.action': event.action,
      'event.outcome': 'success',
      'data_stream.type': 'logs',
      'data_stream.dataset': TECHNICAL_TELEMETRY_DATASET,
      'data_stream.namespace': getObservabilityEnv(),
      ...(event.action === 'legacy_fallback'
        ? { 'legacy.kind': event.legacyKind }
        : { 'probe.id': event.probeId }),
    },
  };
}

/**
 * Canonical OTLP-only transport for technical evidence. Pino remains the
 * application logger and must not duplicate this record.
 */
export function emitTechnicalTelemetry(
  event: TechnicalTelemetryEvent,
  logger: TechnicalTelemetryLogger = getTechnicalLogger(),
): void {
  try {
    logger.emit(buildTechnicalTelemetryRecord(event));
  } catch {
    // Fail open without exposing attributes or other application data.
    process.stderr.write('technical telemetry emission failed\n');
  }
}
