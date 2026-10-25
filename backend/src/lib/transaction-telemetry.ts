import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type TransactionScope = {
  id: string;
  state: 'pending' | 'committed' | 'rolled_back' | 'not_confirmed';
  effects: Array<() => void>;
};
const storage = new AsyncLocalStorage<TransactionScope>();

export function currentTransactionTelemetry() {
  const scope = storage.getStore();
  return scope ? { id: scope.id, state: scope.state } : undefined;
}

/** Success telemetry is published only after Prisma confirms the commit. */
export function afterTransactionCommit(effect: () => void): void {
  const scope = storage.getStore();
  if (!scope) { effect(); return; }
  if (scope.state === 'pending') scope.effects.push(effect);
  // A continuation of a finished callback must not create a late success.
}

export async function withTransactionTelemetry<T>(
  execute: () => Promise<T>,
  completed: (id: string, state: 'committed' | 'rolled_back' | 'not_confirmed', durationMs: number, discarded: number) => void,
  rollbackKnown: () => boolean = () => false,
): Promise<T> {
  const scope: TransactionScope = { id: randomUUID(), state: 'pending', effects: [] };
  const started = Date.now();
  let result: T;
  try {
    result = await storage.run(scope, execute);
  } catch (error) {
    // A lost connection during COMMIT is not proof that the database rolled back.
    scope.state = rollbackKnown() ? 'rolled_back' : 'not_confirmed';
    const discarded = scope.effects.length;
    scope.effects.length = 0;
    try { completed(scope.id, scope.state, Date.now() - started, discarded); } catch { /* fail open */ }
    throw error;
  }
  scope.state = 'committed';
  for (const effect of scope.effects) {
    try { effect(); } catch { /* Never turn a committed write into an application error. */ }
  }
  scope.effects.length = 0;
  try { completed(scope.id, scope.state, Date.now() - started, 0); } catch { /* fail open */ }
  return result;
}
