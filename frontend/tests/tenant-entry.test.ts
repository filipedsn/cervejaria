import assert from 'node:assert/strict';
import test from 'node:test';
import { OPERACAO_NO_ACCESS_PATH, getOperacaoEntryPath, getTenantCashEntryPath } from '../src/lib/tenant-entry';

const grants = (...permissions: string[]) => (permission: string) => permissions.includes(permission);
const all = () => true;
const enabled = { kitchenEnabled: true, inventoryEnabled: true };

test('CAIXA with an active point of sale resumes in Comandas for whoever reads commands', () => {
  assert.equal(getTenantCashEntryPath('CAIXA', 1, { can: all, ...enabled }), '/operacao/comandas');
  assert.equal(getTenantCashEntryPath('CAIXA', 1, { can: grants('command.read'), ...enabled }), '/operacao/comandas');
});

test('CAIXA without an active point of sale resumes in cash setup', () => {
  assert.equal(getTenantCashEntryPath('CAIXA', 0, { can: all, ...enabled }), '/operacao/caixa');
});

test('EVENTO and unset modes do not force the cash entry flow', () => {
  assert.equal(getTenantCashEntryPath('EVENTO', 1, { can: all, ...enabled }), null);
  assert.equal(getTenantCashEntryPath(null, 0, { can: all, ...enabled }), null);
});

test('kitchen staff enters the kitchen queue when the PDV has a kitchen', () => {
  const can = grants('kitchen.read', 'kitchen.operate');
  assert.equal(getOperacaoEntryPath({ can, ...enabled }), '/operacao/cozinha');
  assert.equal(getOperacaoEntryPath({ can, kitchenEnabled: false, inventoryEnabled: true }), OPERACAO_NO_ACCESS_PATH);
});

test('cash staff without command access enters the cash screen', () => {
  assert.equal(getOperacaoEntryPath({ can: grants('cash.open'), ...enabled }), '/operacao/caixa');
  assert.equal(getOperacaoEntryPath({ can: grants('cash.values.read'), ...enabled }), '/operacao/caixa');
});

test('inventory staff enters stock only when stock control is enabled', () => {
  const can = grants('inventory.read');
  assert.equal(getOperacaoEntryPath({ can, ...enabled }), '/operacao/estoque');
  assert.equal(getOperacaoEntryPath({ can, kitchenEnabled: true, inventoryEnabled: false }), OPERACAO_NO_ACCESS_PATH);
});

test('users without any operational permission land on the no-access screen', () => {
  assert.equal(getOperacaoEntryPath({ can: grants(), ...enabled }), OPERACAO_NO_ACCESS_PATH);
  assert.equal(getOperacaoEntryPath({ can: grants('clients.manage'), ...enabled }), OPERACAO_NO_ACCESS_PATH);
});

test('priority follows the daily flow: commands, kitchen, cash, stock', () => {
  assert.equal(getOperacaoEntryPath({ can: grants('inventory.read', 'cash.open', 'kitchen.read'), ...enabled }), '/operacao/cozinha');
  assert.equal(getOperacaoEntryPath({ can: grants('inventory.read', 'cash.open'), ...enabled }), '/operacao/caixa');
});
