import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileMaterialization } from './materialization-reconciliation.js';

const base = { establishmentsTotal: 2, operationalConfigTotal: 2, operationalModeMaterialized: 2, operationalModeUnmaterialized: 0, activePdvTotal: 2, pdvCashCapabilityExplicit: 2, pdvCashFallbackRequired: 0 };
test('reconciliation passes only when required materialization gates are clear', () => assert.equal(reconcileMaterialization(base).pass, true));
test('reconciliation detects incomplete state', () => assert.deepEqual(reconcileMaterialization({ ...base, operationalModeUnmaterialized: 1, pdvCashFallbackRequired: 1 }).blockers, ['operational_mode_unmaterialized', 'pdv_cash_fallback_required']));
