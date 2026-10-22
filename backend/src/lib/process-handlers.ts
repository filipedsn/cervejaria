import { emitAuditEvent } from './audit/emit-audit-event.js';
import { getTelemetryContext } from './telemetry-context.js';
import { logger } from './logger.js';

export function registerProcessErrorHandlers(shutdown: () => Promise<void> = async () => { process.exit(1); }): void {
  process.on('uncaughtException', (err) => {
    try {
      emitAuditEvent({
        action: 'process.uncaught_exception',
        message: `Excecao nao tratada: ${err.message}`,
        outcome: 'failure',
        metadata: { stack: err.stack?.slice(0, 2000) },
      });
    } catch {
      logger.error({ err }, 'process audit failed');
    }
    logger.error({ err }, 'uncaught exception');
    void shutdown();
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
      logger.error({ err: reason }, 'process audit failed');
    }
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

/** Audit de falha quando nao ha contexto HTTP (ex.: startup). */
export function emitProcessAuditFailure(action: string, message: string, meta?: Record<string, unknown>): void {
  const ctx = getTelemetryContext();
  if (!ctx) {
    logger.error({ action, metadata: meta }, message);
    return;
  }
  emitAuditEvent({
    action,
    message,
    outcome: 'failure',
    metadata: meta,
  });
}
