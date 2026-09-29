import assert from 'node:assert/strict';
import test from 'node:test';
import { getTenantCashEntryPath } from '../src/lib/tenant-entry';

test('CAIXA with an active point of sale resumes in Comandas', () => {
  assert.equal(getTenantCashEntryPath('CAIXA', 1), '/operacao/comandas');
});

test('CAIXA without an active point of sale resumes in cash setup', () => {
  assert.equal(getTenantCashEntryPath('CAIXA', 0), '/operacao/caixa');
});

test('EVENTO and unset modes do not force the cash entry flow', () => {
  assert.equal(getTenantCashEntryPath('EVENTO', 1), null);
  assert.equal(getTenantCashEntryPath(null, 0), null);
});
