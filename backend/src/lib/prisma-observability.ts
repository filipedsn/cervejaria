import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';
import { Prisma } from '@prisma/client';

import { logger } from './logger.js';
import {
  getTelemetryContext,
  runWithTelemetryContext,
  type TelemetryContext,
} from './telemetry-context.js';

const dbMeter = metrics.getMeter('quiver-tap-database-transactions');
const dbTransactionCount = dbMeter.createCounter('quiver.db.transaction.total', {
  description: 'Todas as transações Prisma da aplicação, segmentadas por resultado.',
});
const dbTransactionDuration = dbMeter.createHistogram('quiver.db.transaction.duration_ms', {
  description: 'Duração de todas as transações Prisma da aplicação.',
  unit: 'ms',
});

function recordDbTransaction(outcome: 'success' | 'error', durationMs: number, context?: TelemetryContext): void {
  const attributes = {
    'db.system': 'postgresql',
    'db.operation': 'transaction',
    'outcome': outcome,
    ...(context?.slug ? { 'cervejaria.slug': context.slug } : {}),
  };
  try {
    dbTransactionCount.add(1, attributes);
    dbTransactionDuration.record(durationMs, attributes);
  } catch {
    // Metrics are best-effort and never alter transaction semantics.
  }
}

export type DbErrorCategory =
  | 'CONNECTION'
  | 'TIMEOUT'
  | 'DEADLOCK'
  | 'LOCK_TIMEOUT'
  | 'CONSTRAINT'
  | 'NOT_FOUND'
  | 'TRANSACTION'
  | 'UNKNOWN';

export type DbOperation = {
  model?: string;
  operation: string;
};

type DbLogger = {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

function loggerWithTelemetryContext(targetLogger: DbLogger, context: TelemetryContext | undefined): DbLogger {
  if (!context) return targetLogger;
  return {
    warn(fields, message) {
      runWithTelemetryContext(context, () => targetLogger.warn(fields, message));
    },
    error(fields, message) {
      runWithTelemetryContext(context, () => targetLogger.error(fields, message));
    },
  };
}

const CONNECTION_PRISMA_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1017']);
const TIMEOUT_PRISMA_CODES = new Set(['P1008', 'P2024']);
const CONSTRAINT_PRISMA_CODES = new Set(['P2000', 'P2002', 'P2003', 'P2011', 'P2014']);
const NOT_FOUND_PRISMA_CODES = new Set(['P2025']);
const TRANSACTION_PRISMA_CODES = new Set(['P2034']);
const CONNECTION_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01', '57P01',
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
]);

function recordValue(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function databaseErrorCode(error: unknown): string | undefined {
  const code = recordValue(error, 'code');
  return code && /^(?:P\d{4}|[0-9A-Z]{5,}|E[A-Z_]+)$/.test(code) ? code : undefined;
}

/** Returns a safe Prisma error code only; it never returns an error message. */
export function prismaErrorCode(error: unknown): string | undefined {
  const code = databaseErrorCode(error);
  return code?.startsWith('P') ? code : undefined;
}

function postgresCode(error: unknown): string | undefined {
  const direct = recordValue(error, 'code');
  if (direct && /^(?:40P01|55P03|57014|0[0-9A-Z]{4}|08P01|57P01)$/.test(direct)) {
    return direct;
  }
  const meta = typeof error === 'object' && error !== null ? (error as { meta?: unknown }).meta : undefined;
  const metaCode = recordValue(meta, 'code');
  if (metaCode && /^(?:40P01|55P03|57014|0[0-9A-Z]{4}|08P01|57P01)$/.test(metaCode)) {
    return metaCode;
  }
  return undefined;
}

/**
 * Classifies only documented Prisma codes and explicit PostgreSQL/Node error
 * codes. Message text is deliberately not used as evidence or emitted.
 */
export function classifyDbError(error: unknown): DbErrorCategory {
  if (error instanceof Prisma.PrismaClientInitializationError) return 'CONNECTION';

  const pgCode = postgresCode(error);
  if (pgCode === '40P01') return 'DEADLOCK';
  if (pgCode === '55P03') return 'LOCK_TIMEOUT';
  if (pgCode === '57014') return 'TIMEOUT';
  if (pgCode && (pgCode.startsWith('08') || pgCode === '57P01')) return 'CONNECTION';

  const code = databaseErrorCode(error);
  if (!code) return 'UNKNOWN';
  if (CONNECTION_PRISMA_CODES.has(code) || CONNECTION_CODES.has(code)) return 'CONNECTION';
  if (TIMEOUT_PRISMA_CODES.has(code)) return 'TIMEOUT';
  if (CONSTRAINT_PRISMA_CODES.has(code)) return 'CONSTRAINT';
  if (NOT_FOUND_PRISMA_CODES.has(code)) return 'NOT_FOUND';
  if (TRANSACTION_PRISMA_CODES.has(code)) return 'TRANSACTION';
  return 'UNKNOWN';
}

export function isDbTechnicalError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientRustPanicError
    || databaseErrorCode(error) !== undefined;
}

export function slowDbThresholdMs(raw = process.env.DB_SLOW_OPERATION_MS): number {
  if (!raw) return 500;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 && value <= 3_600_000 ? Math.round(value) : 500;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z0-9_.-]{1,120}$/.test(error.name)
    ? error.name
    : 'DatabaseError';
}

/** A fixed message prevents SQL, bindings and connection URLs from escaping through driver errors. */
export function sanitizedDbErrorMessage(category: DbErrorCategory): string {
  return `Database operation failed (${category})`;
}

function sanitizedError(error: unknown, category: DbErrorCategory): Error {
  const safe = new Error(sanitizedDbErrorMessage(category));
  safe.name = safeErrorName(error);
  return safe;
}

function errorLevel(category: DbErrorCategory): 'warn' | 'error' {
  return category === 'CONNECTION' || category === 'DEADLOCK' || category === 'UNKNOWN'
    ? 'error'
    : 'warn';
}

/** Logging is strictly best-effort: observability cannot change DB behavior. */
function safeLog(
  targetLogger: DbLogger,
  level: 'warn' | 'error',
  fields: Record<string, unknown>,
  message: string,
): void {
  try {
    targetLogger[level](fields, message);
  } catch {
    // Fail open if a local logger/telemetry transport is unavailable.
  }
}

function failureEvent(category: DbErrorCategory): 'db.operation.failed' | 'db.connection.failed' {
  return category === 'CONNECTION' ? 'db.connection.failed' : 'db.operation.failed';
}

function failureFields(operation: DbOperation, durationMs: number, error: unknown, category: DbErrorCategory) {
  return {
    event: failureEvent(category),
    category,
    prismaCode: prismaErrorCode(error),
    model: operation.model,
    operation: operation.operation,
    durationMs,
    'error.name': safeErrorName(error),
    'error.message': sanitizedDbErrorMessage(category),
    err: sanitizedError(error, category),
  };
}

export function logDbOperationFailure(
  operation: DbOperation,
  durationMs: number,
  error: unknown,
  targetLogger: DbLogger = logger,
): void {
  const category = classifyDbError(error);
  const fields = failureFields(operation, durationMs, error, category);
  safeLog(targetLogger, errorLevel(category), fields, fields.event);
}

export async function observeDbOperation<T>(
  operation: DbOperation,
  execute: () => Promise<T>,
  targetLogger: DbLogger = logger,
  now: () => number = Date.now,
  telemetryContext: TelemetryContext | undefined = getTelemetryContext(),
): Promise<T> {
  // Prisma's native engine may continue the query in an async resource that
  // does not retain AsyncLocalStorage. Snapshot it before crossing that boundary.
  const contextLogger = loggerWithTelemetryContext(targetLogger, telemetryContext);
  const start = now();
  try {
    const result = await trace.getTracer('quiver-tap-database').startActiveSpan(`db.${operation.model ?? 'raw'}.${operation.operation}`, async span => {
      span.setAttributes({ 'db.system': 'postgresql', 'db.operation': operation.operation,
        ...(operation.model ? { 'db.collection.name': operation.model } : {}),
        ...(telemetryContext?.slug ? { 'cervejaria.slug': telemetryContext.slug } : {}) });
      try { return await execute(); }
      catch (error) { span.setStatus({ code: SpanStatusCode.ERROR, message: classifyDbError(error) }); throw error; }
      finally { span.end(); }
    });
    const durationMs = Math.max(0, now() - start);
    if (durationMs >= slowDbThresholdMs()) {
      safeLog(contextLogger, 'warn',
        { event: 'db.operation.slow', model: operation.model, operation: operation.operation, durationMs },
        'db.operation.slow',
      );
    }
    return result;
  } catch (error) {
    logDbOperationFailure(operation, Math.max(0, now() - start), error, contextLogger);
    throw error;
  }
}

export async function observeDbTransaction<T>(
  execute: () => Promise<T>,
  targetLogger: DbLogger = logger,
  now: () => number = Date.now,
  telemetryContext: TelemetryContext | undefined = getTelemetryContext(),
): Promise<T> {
  const contextLogger = loggerWithTelemetryContext(targetLogger, telemetryContext);
  const start = now();
  try {
    const result = await trace.getTracer('quiver-tap-database').startActiveSpan('db.transaction', async span => {
      span.setAttributes({ 'db.system': 'postgresql', 'db.operation': 'transaction',
        ...(telemetryContext?.slug ? { 'cervejaria.slug': telemetryContext.slug } : {}) });
      try { return await execute(); }
      catch (error) { span.setStatus({ code: SpanStatusCode.ERROR, message: classifyDbError(error) }); throw error; }
      finally { span.end(); }
    });
    recordDbTransaction('success', Math.max(0, now() - start), telemetryContext);
    return result;
  } catch (error) {
    const durationMs = Math.max(0, now() - start);
    recordDbTransaction('error', durationMs, telemetryContext);
    // Application validation/rollback exceptions do not become DB incidents.
    if (isDbTechnicalError(error)) {
      const category = classifyDbError(error);
      const fields = {
        event: 'db.transaction.failed',
        category,
        prismaCode: prismaErrorCode(error),
        operation: 'transaction',
        durationMs,
        'error.name': safeErrorName(error),
        'error.message': sanitizedDbErrorMessage(category),
        err: sanitizedError(error, category),
      };
      safeLog(contextLogger, errorLevel(category), fields, fields.event);
    }
    throw error;
  }
}
