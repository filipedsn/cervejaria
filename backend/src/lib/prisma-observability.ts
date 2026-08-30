import { Prisma } from '@prisma/client';

import { logger } from './logger.js';

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
): Promise<T> {
  const start = now();
  try {
    const result = await execute();
    const durationMs = Math.max(0, now() - start);
    if (durationMs >= slowDbThresholdMs()) {
      safeLog(targetLogger, 'warn',
        { event: 'db.operation.slow', model: operation.model, operation: operation.operation, durationMs },
        'db.operation.slow',
      );
    }
    return result;
  } catch (error) {
    logDbOperationFailure(operation, Math.max(0, now() - start), error, targetLogger);
    throw error;
  }
}

export async function observeDbTransaction<T>(
  execute: () => Promise<T>,
  targetLogger: DbLogger = logger,
  now: () => number = Date.now,
): Promise<T> {
  const start = now();
  try {
    return await execute();
  } catch (error) {
    // Application validation/rollback exceptions do not become DB incidents.
    if (isDbTechnicalError(error)) {
      const category = classifyDbError(error);
      const durationMs = Math.max(0, now() - start);
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
      safeLog(targetLogger, errorLevel(category), fields, fields.event);
    }
    throw error;
  }
}

export function createPrismaObservabilityExtension() {
  return Prisma.defineExtension({
    name: 'db-observability',
    query: {
      $allModels: {
        $allOperations({ model, operation, query, args }) {
          return observeDbOperation({ model, operation }, () => query(args));
        },
      },
      $queryRaw({ query, args }) {
        return observeDbOperation({ operation: 'queryRaw' }, () => query(args));
      },
      $executeRaw({ query, args }) {
        return observeDbOperation({ operation: 'executeRaw' }, () => query(args));
      },
    },
  });
}
