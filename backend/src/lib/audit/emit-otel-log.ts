import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { redactLogValue } from '../logger.js';

type OtelAttr = string | number | boolean;

/** Converte payload de audit para atributos OTLP (sem objetos aninhados). */
export function auditPayloadToOtelAttributes(
  payload: Record<string, unknown>,
): Record<string, OtelAttr> {
  const out: Record<string, OtelAttr> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    out[key] = JSON.stringify(value);
  }
  return out;
}

function getAuditOtelLogger() {
  return logs.getLogger('quiver-tap-audit', '1.0.0');
}

/** Authoritative audit transport; sanitizes even callers outside emitAuditEvent. */
export function emitAuditLogRecord(
  payload: Record<string, unknown>,
  message: string,
  outcome: 'success' | 'failure' = 'success',
): void {
  getAuditOtelLogger().emit({
    severityNumber: outcome === 'failure' ? SeverityNumber.WARN : SeverityNumber.INFO,
    severityText: outcome === 'failure' ? 'WARN' : 'INFO',
    body: redactLogValue(message) as string,
    attributes: auditPayloadToOtelAttributes(redactLogValue(payload) as Record<string, unknown>),
  });
}
