import { emitAuditEvent } from './audit/emit-audit-event.js';
import { getTelemetryContext } from './telemetry-context.js';

export function registerProcessErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    try {
      emitAuditEvent({
        action: 'process.uncaught_exception',
        message: `Excecao nao tratada: ${err.message}`,
        outcome: 'failure',
        metadata: { stack: err.stack?.slice(0, 2000) },
      });
    } catch {
      console.error('[process] uncaughtException (audit falhou):', err);
    }
    console.error('[process] uncaughtException:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    try {
      emitAuditEvent({
        action: 'process.unhandled_rejection',
        message: `Promise rejeitada: ${msg}`,
        outcome: 'failure',
        metadata: { stack: stack?.slice(0, 2000) },
      });
    } catch {
      console.error('[process] unhandledRejection (audit falhou):', reason);
    }
    console.error('[process] unhandledRejection:', reason);
  });
}

/** Audit de falha quando nao ha contexto HTTP (ex.: startup). */
export function emitProcessAuditFailure(action: string, message: string, meta?: Record<string, unknown>): void {
  const ctx = getTelemetryContext();
  if (!ctx) {
    console.error(`[audit] ${action}: ${message}`, meta);
    return;
  }
  emitAuditEvent({
    action,
    message,
    outcome: 'failure',
    metadata: meta,
  });
}
