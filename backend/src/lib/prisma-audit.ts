import { Prisma } from '@prisma/client';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import { describeSqlAction } from './audit/describe.js';
import { summarizePrismaArgs } from './audit/redact.js';

function auditSqlEnabled(): boolean {
  const flag = process.env.AUDIT_SQL;
  if (flag === 'false' || flag === '0') return false;
  return true;
}

function sampleRate(): number {
  const raw = process.env.AUDIT_SQL_SAMPLE_RATE;
  if (!raw) return 1;
  const n = Number(raw);
  if (Number.isNaN(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function shouldEmitSql(): boolean {
  if (!auditSqlEnabled()) return false;
  const rate = sampleRate();
  if (rate >= 1) return true;
  return Math.random() < rate;
}

export function createPrismaAuditExtension() {
  return Prisma.defineExtension({
    name: 'audit-sql',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = Date.now();
          try {
            const result = await query(args);
            const durationMs = Date.now() - start;
            if (shouldEmitSql()) {
              const queryText = summarizePrismaArgs(model, operation, args);
              emitAuditEvent({
                action: `db.${operation.toLowerCase()}`,
                message: describeSqlAction(model, operation, durationMs),
                outcome: 'success',
                entityType: model,
                db: {
                  operation,
                  model,
                  query: queryText,
                  durationMs,
                },
              });
            }
            return result;
          } catch (err) {
            const durationMs = Date.now() - start;
            if (shouldEmitSql()) {
              emitAuditEvent({
                action: `db.${operation.toLowerCase()}`,
                message: `${describeSqlAction(model, operation, durationMs)} — erro`,
                outcome: 'failure',
                entityType: model,
                db: {
                  operation,
                  model,
                  query: summarizePrismaArgs(model, operation, args),
                  durationMs,
                },
                metadata: { error: err instanceof Error ? err.message : String(err) },
              });
            }
            throw err;
          }
        },
      },
    },
  });
}
