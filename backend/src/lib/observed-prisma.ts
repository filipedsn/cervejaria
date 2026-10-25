import { Prisma, type PrismaClient } from '@prisma/client';
import { emitAuditEvent } from './audit/emit-audit-event.js';
import { observeDbOperation, observeDbTransaction } from './prisma-observability.js';
import { getTelemetryContext, runWithTelemetryContext } from './telemetry-context.js';
import { withTransactionTelemetry } from './transaction-telemetry.js';

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);

/** Query extensions retain PrismaPromise semantics, including $transaction([...]). */
export function observePrismaClient(client: PrismaClient): PrismaClient {
  const extended = client.$extends(Prisma.defineExtension({
    name: 'quiver-observability',
    query: {
      async $allOperations({ model, operation, args, query }) {
        const context = getTelemetryContext();
        const started = Date.now();
        const result = await observeDbOperation({ model, operation }, () => query(args));
        // Never capture SQL/arguments/results wholesale. TransacaoLog already has
        // a semantic event; raw SQL remains a technical signal, not a write receipt.
        if (model && model !== 'TransacaoLog' && WRITES.has(operation) && context) {
          const row = result && typeof result === 'object' && !Array.isArray(result)
            ? result as Record<string, unknown> : undefined;
          const entityId = typeof row?.id === 'string' ? row.id : undefined;
          runWithTelemetryContext(context, () => emitAuditEvent({
            action: 'db.write.completed',
            message: `Persistência ${model}.${operation} concluída`,
            entityType: model,
            entityId,
            targetCervejariaId: model === 'Cervejaria' ? entityId : typeof row?.cervejariaId === 'string' ? row.cervejariaId : undefined,
            db: { model, operation, durationMs: Math.max(0, Date.now() - started) },
            metadata: {
              persistence: 'query_completed',
              ...(typeof row?.count === 'number' ? { affectedCount: row.count } : {}),
            },
          }));
        }
        return result;
      },
    },
  }));
  return new Proxy(extended, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== '$transaction' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const context = getTelemetryContext();
        let callbackRejected = false;
        const callback = args[0];
        if (typeof callback === 'function') {
          args[0] = async (...callbackArgs: unknown[]) => {
            try { return await callback(...callbackArgs); }
            catch (error) { callbackRejected = true; throw error; }
          };
        }
        const execute = () => observeDbTransaction(() => value.apply(target, args));
        return withTransactionTelemetry(execute, (id, state, durationMs, discarded) => {
          const publish = () => emitAuditEvent({
            action: `db.transaction.${state}`,
            message: state === 'committed' ? 'Transação confirmada' : state === 'rolled_back' ? 'Callback rejeitado; transação revertida' : 'Conclusão da transação não confirmada',
            outcome: state === 'committed' ? 'success' : 'failure',
            db: { operation: 'transaction', durationMs, transactionId: id, transactionState: state },
            metadata: { transactionId: id, persistence: state, discardedSuccessEvents: discarded },
          });
          if (context) runWithTelemetryContext(context, publish);
          else publish();
        }, () => callbackRejected);
      };
    },
  }) as unknown as PrismaClient;
}
