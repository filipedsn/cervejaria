import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './quiosque/capacidades.js';
import { updateOperationalConfig } from './operational-config.js';

function database(current: Record<string, boolean | null> | null, activeOrder = false) {
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
