type Effect = () => Promise<void> | void;
const pending = new WeakMap<object, Effect[]>();

export function afterTransactionCommit(transaction: object, effect: Effect): boolean {
  const effects = pending.get(transaction);
  if (!effects) return false;
  effects.push(effect);
  return true;
}

/** Only the caller that awaited the database commit may publish success. */
export async function withTransactionEffects<T>(
  execute: (bind: <R>(transaction: object, work: () => Promise<R>) => Promise<R>) => Promise<T>,
): Promise<T> {
  const effects: Effect[] = [];
  const transactions: object[] = [];
  try {
    const result = await execute(async (transaction, work) => {
      transactions.push(transaction); pending.set(transaction, effects);
      return work();
    });
    for (const effect of effects) {
      try { await effect(); } catch { process.stderr.write('post-commit telemetry emission failed\n'); }
    }
    return result;
  } finally { for (const tx of transactions) pending.delete(tx); }
}
