import { SeverityNumber, type Logger } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';

import { getReleaseContext } from './release-context.js';
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

let technicalProvider: LoggerProvider | undefined;
let technicalLogger: TechnicalTelemetryLogger | undefined;

function getTechnicalLogger(): TechnicalTelemetryLogger {
  if (!technicalLogger) {
    const release = getReleaseContext();
    technicalProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': release.service,
        'service.version': release.releaseSha,
        'deployment.environment.name': release.environment,
        'data_stream.type': 'logs',
        'data_stream.dataset': TECHNICAL_TELEMETRY_DATASET,
        'data_stream.namespace': getObservabilityEnv(),
      }),
      processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    });
    technicalLogger = technicalProvider.getLogger('quiver-tap-technical', '1.0.0');
  }
  return technicalLogger;
}

/** Starts the singleton provider before requests begin. Safe to call repeatedly. */
export function initializeTechnicalTelemetry(): void {
  getTechnicalLogger();
}

/** Explicit flush for bounded diagnostic probes; never used per request. */
export async function forceFlushTechnicalTelemetry(): Promise<void> {
  await technicalProvider?.forceFlush();
}

/** Flushes this dedicated technical transport during the existing app shutdown. */
export async function shutdownTechnicalTelemetry(): Promise<void> {
  await technicalProvider?.shutdown();
}

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
