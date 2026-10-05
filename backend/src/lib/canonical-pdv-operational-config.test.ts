import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanonicalPdvConfigurationError,
  canonicalPdvQaActivationEnabled,
  readCanonicalPdvOperationalSettingsIfEnabled,
  resolveCanonicalPdvOperationalSettings,
} from './canonical-pdv-operational-config.js';

const settings = {
  tapsEnabled: false,
  inventoryEnabled: true,
  kitchenEnabled: false,
  kitchenItemsChargeAtLaunch: false,
  allowCloseComandaWithPendingKitchenOrders: false,
  whatsappPedidoProntoEnabled: false,
  whatsappPedidoProntoNaCozinha: false,
  quantidadeMesas: 6,
};
const point = (overrides: Record<string, unknown> = {}) => ({
  id: 'point-a', cervejariaId: 'tenant-a', ativo: true,
  configuracaoPdv: { ...settings, cervejariaId: 'tenant-a', pontoVendaId: 'point-a' },
  ...overrides,
});

test('canonical QA activation is off by default and reads no additive table', async () => {
  assert.equal(canonicalPdvQaActivationEnabled({}), false);
  const noAdditiveRead = { pontoVenda: { findMany: async () => { throw new Error('ADDITIVE_TABLE_READ'); } } } as any;
  assert.equal(await readCanonicalPdvOperationalSettingsIfEnabled('tenant-a', noAdditiveRead), null);
});

test('canonical QA activation accepts only the isolated runner target', () => {
  const url = 'postgresql://qa-user:qa-pass@127.0.0.1:55439/cervejaria_qa_pdv_unico';
  assert.equal(canonicalPdvQaActivationEnabled({
    PDV_CANONICAL_CONFIG_QA: '1', NODE_ENV: 'test', PDV_ISOLATED_QA: '1', DATABASE_URL: url, QA_DATABASE_URL: url,
  }), true);
  assert.throws(() => canonicalPdvQaActivationEnabled({ PDV_CANONICAL_CONFIG_QA: '1', NODE_ENV: 'test', DATABASE_URL: url, QA_DATABASE_URL: url }), (error) => error instanceof CanonicalPdvConfigurationError && error.code === 'CANONICAL_PDV_QA_GUARD_FAILED');
  assert.throws(() => canonicalPdvQaActivationEnabled({
    PDV_CANONICAL_CONFIG_QA: '1', NODE_ENV: 'test', PDV_ISOLATED_QA: '1', DATABASE_URL: url.replace('55439', '5432'), QA_DATABASE_URL: url.replace('55439', '5432'),
  }), (error) => error instanceof CanonicalPdvConfigurationError && error.code === 'CANONICAL_PDV_QA_GUARD_FAILED');
});

test('canonical configuration resolves exactly one active tenant-owned point and rejects missing or ambiguous authority', () => {
  assert.deepEqual(resolveCanonicalPdvOperationalSettings('tenant-a', [point() as any]), {
    ...settings, source: 'CANONICAL_PDV', pointId: 'point-a',
  });
  const cases = [
    { points: [], code: 'CANONICAL_PDV_MISSING' },
    { points: [point(), point({ id: 'point-b', configuracaoPdv: null })], code: 'CANONICAL_PDV_AMBIGUOUS' },
    { points: [point({ configuracaoPdv: null })], code: 'CANONICAL_PDV_CONFIGURATION_MISSING' },
    { points: [point({ ativo: false })], code: 'CANONICAL_PDV_INACTIVE' },
    { points: [point({ cervejariaId: 'tenant-b' })], code: 'CANONICAL_PDV_TENANT_MISMATCH' },
    { points: [point({ configuracaoPdv: { ...settings, cervejariaId: 'tenant-b', pontoVendaId: 'point-a' } })], code: 'CANONICAL_PDV_CONFIGURATION_MISMATCH' },
  ];
  for (const scenario of cases) {
    assert.throws(() => resolveCanonicalPdvOperationalSettings('tenant-a', scenario.points as any), (error) => error instanceof CanonicalPdvConfigurationError && error.code === scenario.code);
  }
});
