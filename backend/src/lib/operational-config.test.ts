import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './quiosque/capacidades.js';
import { OperationalModeTransitionBlockedError, updateOperationalConfig } from './operational-config.js';

function database(current: Record<string, boolean | null> | null, activeOrder = false, openCash = false, activeEvent = false) {
  const updates: unknown[] = [];
  return {
    updates,
    configuracaoOperacional: {
      findUnique: async () => current,
      upsert: async ({ create, update }: any) => {
        updates.push({ create, update });
        return { ...create, ...update };
      },
    },
    pedidoQuiosque: { findFirst: async () => (activeOrder ? { id: 'pedido-aberto' } : null) },
    sessaoCaixaQuiosque: { findFirst: async () => (openCash ? { id: 'caixa-aberto' } : null) },
    evento: { findFirst: async () => (activeEvent ? { id: 'evento-ativo' } : null) },
  };
}

test('persists only the requested operational capability', async () => {
  const db = database({ directSalesEnabled: false, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false });
  await updateOperationalConfig(db as any, 'tenant-a', { tapsEnabled: false });
  assert.deepEqual(db.updates, [{
    create: { cervejariaId: 'tenant-a', tapsEnabled: false },
    update: { tapsEnabled: false },
  }]);
});

test('maps one operation mode to mutually exclusive compatibility fields', async () => {
  const db = database({ directSalesEnabled: true, plannedOperationsEnabled: false });
  await updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'EVENTO' });
  assert.deepEqual(db.updates, [{
    create: { cervejariaId: 'tenant-a', plannedOperationsEnabled: true, directSalesEnabled: false },
    update: { plannedOperationsEnabled: true, directSalesEnabled: false },
  }]);
});

test('requires explicit confirmation for an inventory change', async () => {
  const db = database({ inventoryEnabled: false });
  await assert.rejects(
    updateOperationalConfig(db as any, 'tenant-a', { inventoryEnabled: true }),
    ConfirmacaoEstoqueObrigatoriaError,
  );
  assert.equal(db.updates.length, 0);
});

test('does not turn off kitchen with active preparation orders', async () => {
  const db = database({ kitchenEnabled: true }, true);
  await assert.rejects(
    updateOperationalConfig(db as any, 'tenant-a', { kitchenEnabled: false }),
    CozinhaComPedidosAtivosError,
  );
  assert.equal(db.updates.length, 0);
});

test('blocks CAIXA to EVENTO while a cash session is open', async () => {
  const db = database({ directSalesEnabled: true, plannedOperationsEnabled: false }, false, true);
  await assert.rejects(
    updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'EVENTO' }),
    (error: unknown) => error instanceof OperationalModeTransitionBlockedError && error.reason === 'OPEN_CASH_REGISTER',
  );
  assert.equal(db.updates.length, 0);
});

test('blocks EVENTO to CAIXA while an event is active', async () => {
  const db = database({ directSalesEnabled: false, plannedOperationsEnabled: true }, false, false, true);
  await assert.rejects(
    updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'CAIXA' }),
    (error: unknown) => error instanceof OperationalModeTransitionBlockedError && error.reason === 'ACTIVE_EVENT',
  );
  assert.equal(db.updates.length, 0);
});

test('allows EVENTO to CAIXA when only a scheduled/closed event exists', async () => {
  const db = database({ directSalesEnabled: false, plannedOperationsEnabled: true });
  await updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'CAIXA' });
  assert.equal(db.updates.length, 1);
});

test('concurrent CAIXA to EVENTO attempts are both rejected while cash remains open', async () => {
  const db = database({ directSalesEnabled: true, plannedOperationsEnabled: false }, false, true);
  const results = await Promise.allSettled([
    updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'EVENTO' }),
    updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'EVENTO' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 2);
  assert.equal(db.updates.length, 0);
});

test('static configuration matrix covers all 16 mode and capability combinations', async () => {
  let cases = 0;
  for (const operationMode of ['CAIXA', 'EVENTO'] as const) {
    for (const tapsEnabled of [false, true]) {
      for (const inventoryEnabled of [false, true]) {
        for (const kitchenEnabled of [false, true]) {
          const db = database({
            directSalesEnabled: operationMode === 'CAIXA',
            plannedOperationsEnabled: operationMode === 'EVENTO',
            tapsEnabled,
            inventoryEnabled,
            kitchenEnabled,
          });
          await updateOperationalConfig(db as any, 'tenant-matrix', {
            operationMode,
            tapsEnabled,
            inventoryEnabled,
            kitchenEnabled,
            confirmacaoEstoque: true,
          });
          assert.equal(db.updates.length, 1);
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 16);
});
