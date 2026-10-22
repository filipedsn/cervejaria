import assert from 'node:assert/strict';
import test from 'node:test';
import { logs } from '@opentelemetry/api-logs';
import type { Prisma } from '@prisma/client';
import { registrarTransacao } from './transacao-log.js';
import { runWithTelemetryContext } from './telemetry-context.js';
import { afterTransactionCommit, withTransactionEffects } from './transaction-effects.js';

test('a successful log insert inside an uncommitted transaction is not a committed business event', async () => {
  const emitted: unknown[] = [];
  logs.setGlobalLoggerProvider({ getLogger: () => ({ emit: record => { emitted.push(record); }, enabled: () => true }) });
  const tx = { transacaoLog: { create: async () => ({ id: 'uncommitted-row' }) } } as unknown as Prisma.TransactionClient;
  await runWithTelemetryContext({ slug: 'qa-commit', env: 'dev', cervejariaId: 'qa-commit', actor: { type: 'system' } },
    () => registrarTransacao({ cervejariaId: 'qa-commit', tipo: 'COMANDA_CRIADA' }, tx));
  assert.equal(emitted.length, 0, 'transaction can still roll back after registrarTransacao returns');
  logs.disable();
});

test('commit effects run after confirmation and are discarded on rollback', async () => {
  const emitted: string[] = [];
  const tx = {};
  await assert.rejects(withTransactionEffects(async bind => {
    await bind(tx, async () => { afterTransactionCommit(tx, () => { emitted.push('false success'); }); });
    throw new Error('rollback after audit insert');
  }), /rollback/);
  assert.equal(emitted.length, 0);
  await withTransactionEffects(async bind => {
    await bind(tx, async () => { afterTransactionCommit(tx, () => { emitted.push('committed'); }); });
    assert.equal(emitted.length, 0);
    return 'database committed';
  });
  assert.deepEqual(emitted, ['committed']);
});
