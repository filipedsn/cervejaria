import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CozinhaComPedidosAtivosError,
  ConfirmacaoEstoqueObrigatoriaError,
} from './operacao/capacidades.js';
import {
  CanonicalPdvModeChangeUnsupportedError,
  OperationalModeTransitionBlockedError,
  PendingKitchenCloseDependencyError,
  readOperationalConfig,
  updateOperationalConfig,
} from './operational-config.js';

function database(current: Record<string, boolean | null> | null, activeOrder = false, openCash = false, activeEvent = false) {
  const updates: unknown[] = [];
  const cashQueries: unknown[] = [];
  return {
    updates,
    cashQueries,
    configuracaoOperacional: {
      findUnique: async () => current,
      upsert: async ({ create, update }: any) => {
        updates.push({ create, update });
        return { ...create, ...update };
      },
    },
    pedidoOperacao: { findFirst: async () => (activeOrder ? { id: 'pedido-aberto' } : null) },
    sessaoCaixaOperacao: { findFirst: async (query: unknown) => { cashQueries.push(query); return openCash ? { id: 'caixa-aberto' } : null; } },
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
    create: { cervejariaId: 'tenant-a', plannedOperationsEnabled: true },
    update: { plannedOperationsEnabled: true },
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

test('allows CAIXA to EVENTO when no cash session is open', async () => {
  const db = database({ directSalesEnabled: true, plannedOperationsEnabled: false });
  await updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'EVENTO' });
  assert.equal(db.updates.length, 1);
  assert.deepEqual((db.updates[0] as any).update, { plannedOperationsEnabled: true });
});

test('accepts the initial disabled inventory default without a change confirmation', async () => {
  const db = database(null);
  await updateOperationalConfig(db as any, 'tenant-a', { inventoryEnabled: false });
  assert.deepEqual(db.updates, [{
    create: { cervejariaId: 'tenant-a', inventoryEnabled: false },
    update: { inventoryEnabled: false },
  }]);
});

test('completes first access setup while saving mode and optional capabilities', async () => {
  const db = database(null);
  await updateOperationalConfig(db as any, 'tenant-a', {
    operationMode: 'CAIXA',
    tapsEnabled: true,
    inventoryEnabled: true,
    kitchenEnabled: false,
    confirmacaoEstoque: true,
    completeInitialSetup: true,
  });
  const update = (db.updates[0] as any).update;
  assert.deepEqual({
    plannedOperationsEnabled: update.plannedOperationsEnabled,
    tapsEnabled: update.tapsEnabled,
    inventoryEnabled: update.inventoryEnabled,
    kitchenEnabled: update.kitchenEnabled,
  }, {
    plannedOperationsEnabled: false,
    tapsEnabled: true,
    inventoryEnabled: true,
    kitchenEnabled: false,
  });
  assert.ok(update.setupCompletedAt instanceof Date);
});

test('persists WhatsApp ready-order settings independently per tenant', async () => {
  const db = database({
    plannedOperationsEnabled: false,
    tapsEnabled: false,
    inventoryEnabled: false,
    kitchenEnabled: true,
    whatsappPedidoProntoEnabled: false,
    whatsappPedidoProntoNaCozinha: false,
  });
  await updateOperationalConfig(db as any, 'tenant-a', {
    whatsappPedidoProntoEnabled: true,
    whatsappPedidoProntoNaCozinha: true,
  });
  assert.deepEqual(db.updates, [{
    create: {
      cervejariaId: 'tenant-a',
      whatsappPedidoProntoEnabled: true,
      whatsappPedidoProntoNaCozinha: true,
    },
    update: {
      whatsappPedidoProntoEnabled: true,
      whatsappPedidoProntoNaCozinha: true,
    },
  }]);
});

test('checks only the current operational day when guarding the mode transition', async () => {
  const db = database({ directSalesEnabled: true, plannedOperationsEnabled: false });
  await updateOperationalConfig(db as any, 'tenant-a', { operationMode: 'EVENTO' });
  assert.equal((db.cashQueries[0] as any).where.status, 'ABERTO');
  assert.ok((db.cashQueries[0] as any).where.diaOperacional instanceof Date);
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

const canonicalSettings = () => ({
  tapsEnabled: true,
  inventoryEnabled: true,
  kitchenEnabled: true,
  kitchenItemsChargeAtLaunch: true,
  allowCloseComandaWithPendingKitchenOrders: true,
  whatsappPedidoProntoEnabled: true,
  whatsappPedidoProntoNaCozinha: true,
  quantidadeMesas: 6,
});

function withCanonicalActivation(action: () => Promise<void>) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    PDV_CANONICAL_CONFIG_QA: '1', NODE_ENV: 'test', PDV_ISOLATED_QA: '1',
    DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:55439/cervejaria_qa_pdv_unico',
    QA_DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:55439/cervejaria_qa_pdv_unico',
  });
  return action().finally(() => {
    for (const key of ['PDV_CANONICAL_CONFIG_QA', 'NODE_ENV', 'PDV_ISOLATED_QA', 'DATABASE_URL', 'QA_DATABASE_URL']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function canonicalDatabase(options: { activeOrder?: boolean } = {}) {
  let settings = canonicalSettings();
  const legacy = { cervejariaId: 'tenant-a', plannedOperationsEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false };
  const canonicalWrites: unknown[] = [];
  const legacyWrites: unknown[] = [];
  const audits: unknown[] = [];
  const legacyReadSelects: unknown[] = [];
  const db = {
    pontoVenda: {
      findMany: async () => [{
        id: 'point-a', cervejariaId: 'tenant-a', ativo: true,
        configuracaoPdv: { ...settings, cervejariaId: 'tenant-a', pontoVendaId: 'point-a' },
      }],
    },
    configuracaoPontoVenda: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        canonicalWrites.push(data);
        settings = { ...settings, ...data };
        return { ...settings, cervejariaId: 'tenant-a', pontoVendaId: 'point-a' };
      },
    },
    configuracaoOperacional: {
      findUnique: async ({ select }: { select?: unknown }) => {
        legacyReadSelects.push(select ?? null);
        return select ? { setupCompletedAt: null } : legacy;
      },
      upsert: async (args: unknown) => { legacyWrites.push(args); return legacy; },
      update: async (args: unknown) => { legacyWrites.push(args); return { setupCompletedAt: new Date() }; },
    },
    pedidoOperacao: { findFirst: async () => options.activeOrder ? { id: 'active-order' } : null },
    comanda: { findMany: async () => [] },
    transacaoLog: { create: async (args: unknown) => { audits.push(args); return args; } },
  };
  return { db, canonicalWrites, legacyWrites, audits, legacyReadSelects, settings: () => settings };
}

test('canonical read and update use the validated PDV record, preserve false and zero, and do not synchronize legacy flags', async () => {
  await withCanonicalActivation(async () => {
    const fixture = canonicalDatabase();
    const effective = await readOperationalConfig('tenant-a', fixture.db as any);
    assert.deepEqual([
      (effective as any)?.configurationSource,
      (effective as any)?.plannedOperationsEnabled,
      (effective as any)?.inventoryEnabled,
      (effective as any)?.kitchenEnabled,
      (effective as any)?.quantidadeMesas,
    ], ['CANONICAL_PDV', false, true, true, 6]);
    assert.deepEqual(fixture.legacyReadSelects, [{ setupCompletedAt: true }], 'only out-of-scope setup metadata is read from the legacy row');

    await updateOperationalConfig(fixture.db as any, 'tenant-a', {
      tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, quantidadeMesas: 0, confirmacaoEstoque: true,
    }, { userId: 'owner-a', role: 'DONO' });
    assert.deepEqual(fixture.canonicalWrites, [{ tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, quantidadeMesas: 0 }]);
    assert.equal(fixture.legacyWrites.length, 0, 'no legacy operational write is made');
    assert.deepEqual([
      fixture.settings().tapsEnabled, fixture.settings().inventoryEnabled,
      fixture.settings().kitchenEnabled, fixture.settings().quantidadeMesas,
    ], [false, false, false, 0]);
    assert.equal(fixture.audits.length, 1, 'persistent audit uses the same transaction client');
  });
});

test('canonical mode rejects EVENTO explicitly and refuses unsafe changes before writing', async () => {
  await withCanonicalActivation(async () => {
    const fixture = canonicalDatabase();
    await assert.rejects(
      updateOperationalConfig(fixture.db as any, 'tenant-a', { operationMode: 'EVENTO' }),
      CanonicalPdvModeChangeUnsupportedError,
    );
    await assert.rejects(
      updateOperationalConfig(fixture.db as any, 'tenant-a', { inventoryEnabled: false }),
      ConfirmacaoEstoqueObrigatoriaError,
    );
    await assert.rejects(
      updateOperationalConfig(fixture.db as any, 'tenant-a', { kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: true }),
      PendingKitchenCloseDependencyError,
    );
    const activeKitchen = canonicalDatabase({ activeOrder: true });
    await assert.rejects(
      updateOperationalConfig(activeKitchen.db as any, 'tenant-a', { kitchenEnabled: false }),
      CozinhaComPedidosAtivosError,
    );
    assert.equal(fixture.canonicalWrites.length + fixture.legacyWrites.length + fixture.audits.length, 0);
    assert.equal(activeKitchen.canonicalWrites.length, 0);
  });
});

test('disabled activation reads and writes legacy config without touching the additive PDV delegate', async () => {
  const previous = process.env.PDV_CANONICAL_CONFIG_QA;
  delete process.env.PDV_CANONICAL_CONFIG_QA;
  let canonicalReads = 0;
  try {
    const db = database({ plannedOperationsEnabled: true, tapsEnabled: true });
    Object.assign(db, { pontoVenda: { findMany: async () => { canonicalReads++; throw new Error('additive relation must not be read'); } } });
    const config = await readOperationalConfig('tenant-a', db as any);
    assert.equal((config as any).plannedOperationsEnabled, true);
    await updateOperationalConfig(db as any, 'tenant-a', { tapsEnabled: false });
    assert.equal(canonicalReads, 0);
    assert.deepEqual(db.updates.at(-1), { create: { cervejariaId: 'tenant-a', tapsEnabled: false }, update: { tapsEnabled: false } });
  } finally {
    if (previous === undefined) delete process.env.PDV_CANONICAL_CONFIG_QA;
    else process.env.PDV_CANONICAL_CONFIG_QA = previous;
  }
});
