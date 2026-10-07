import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommandOccurrenceMatchesSession, CashOccurrenceContextError, validateCashOccurrenceSelection } from './contexto-ocorrencia.js';

const activation = {
  flag: process.env.PDV_CANONICAL_CONFIG_QA,
  databaseUrl: process.env.DATABASE_URL,
  qaDatabaseUrl: process.env.QA_DATABASE_URL,
  isolated: process.env.PDV_ISOLATED_QA,
  nodeEnv: process.env.NODE_ENV,
};

function restoreActivation() {
  for (const [key, value] of Object.entries({
    PDV_CANONICAL_CONFIG_QA: activation.flag,
    DATABASE_URL: activation.databaseUrl,
    QA_DATABASE_URL: activation.qaDatabaseUrl,
    PDV_ISOLATED_QA: activation.isolated,
    NODE_ENV: activation.nodeEnv,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('occurrence context blocks an item-consumption increase when command and authorizing session differ', () => {
  const qaUrl = 'postgresql://postgres:qa@127.0.0.1:55439/cervejaria_qa_pdv_unico';
  Object.assign(process.env, {
    PDV_CANONICAL_CONFIG_QA: '1',
    NODE_ENV: 'test',
    PDV_ISOLATED_QA: '1',
    DATABASE_URL: qaUrl,
    QA_DATABASE_URL: qaUrl,
  });
  try {
    assert.throws(
      () => assertCommandOccurrenceMatchesSession({ ocorrenciaId: 'occurrence-a' }, { ocorrenciaId: 'occurrence-b' }),
      (error) => error instanceof CashOccurrenceContextError
        && error.statusCode === 409
        && error.code === 'CASH_OCCURRENCE_COMMAND_CONTEXT_MISMATCH',
    );
    assert.doesNotThrow(() => assertCommandOccurrenceMatchesSession({ ocorrenciaId: 'occurrence-a' }, { ocorrenciaId: 'occurrence-a' }));
  } finally {
    restoreActivation();
  }
});

test('legacy mode does not add an occurrence-context guard', () => {
  delete process.env.PDV_CANONICAL_CONFIG_QA;
  try {
    assert.doesNotThrow(() => assertCommandOccurrenceMatchesSession({ ocorrenciaId: 'historical-a' }, { ocorrenciaId: 'legacy-null' }));
  } finally {
    restoreActivation();
  }
});

async function withQaActivation(run: () => Promise<void>) {
  const qaUrl = 'postgresql://postgres:qa@127.0.0.1:55439/cervejaria_qa_pdv_unico';
  Object.assign(process.env, { PDV_CANONICAL_CONFIG_QA: '1', NODE_ENV: 'test', PDV_ISOLATED_QA: '1', DATABASE_URL: qaUrl, QA_DATABASE_URL: qaUrl });
  try { await run(); } finally { restoreActivation(); }
}

test('cash occurrence selection accepts only same-day PROGRAMADA or ABERTA and requires explicit other-date confirmation', async () => {
  await withQaActivation(async () => {
    const findFirst = async ({ where }: { where: { id: string; cervejariaId: string; pontoVendaId: string } }) => {
      assert.deepEqual(where, { id: 'occ-1', cervejariaId: 'tenant-1', pontoVendaId: 'pdv-1' });
      return { id: 'occ-1', data: new Date('2026-10-07T00:00:00.000Z'), status: 'PROGRAMADA' as const };
    };
    const tx = { ocorrenciaOperacional: { findFirst } } as never;
    assert.equal(await validateCashOccurrenceSelection(tx, { cervejariaId: 'tenant-1', pontoVendaId: 'pdv-1', ocorrenciaId: 'occ-1', diaOperacional: new Date('2026-10-07T00:00:00.000Z') }), 'occ-1');
    await assert.rejects(() => validateCashOccurrenceSelection(tx, { cervejariaId: 'tenant-1', pontoVendaId: 'pdv-1', ocorrenciaId: 'occ-1', diaOperacional: new Date('2026-10-08T00:00:00.000Z') }), (error) => error instanceof CashOccurrenceContextError && error.code === 'CASH_OCCURRENCE_DATE_CONFIRMATION_REQUIRED');
    assert.equal(await validateCashOccurrenceSelection(tx, { cervejariaId: 'tenant-1', pontoVendaId: 'pdv-1', ocorrenciaId: 'occ-1', diaOperacional: new Date('2026-10-08T00:00:00.000Z'), confirmarDataDiferente: true }), 'occ-1');
  });
});

test('cash occurrence confirmation does not bypass status or tenant and PDV isolation', async () => {
  await withQaActivation(async () => {
    const tx = { ocorrenciaOperacional: { findFirst: async ({ where }: { where: { cervejariaId: string; pontoVendaId: string } }) => {
      assert.equal(where.cervejariaId, 'tenant-1'); assert.equal(where.pontoVendaId, 'pdv-1');
      return { id: 'occ-1', data: new Date('2026-10-08T00:00:00.000Z'), status: 'FECHADA' as const };
    } } } as never;
    await assert.rejects(() => validateCashOccurrenceSelection(tx, { cervejariaId: 'tenant-1', pontoVendaId: 'pdv-1', ocorrenciaId: 'occ-1', diaOperacional: new Date('2026-10-07T00:00:00.000Z'), confirmarDataDiferente: true }), (error) => error instanceof CashOccurrenceContextError && error.code === 'CASH_OCCURRENCE_STATUS_NOT_SELECTABLE');
    const absent = { ocorrenciaOperacional: { findFirst: async () => null } } as never;
    await assert.rejects(() => validateCashOccurrenceSelection(absent, { cervejariaId: 'tenant-1', pontoVendaId: 'pdv-1', ocorrenciaId: 'foreign-occ', diaOperacional: new Date('2026-10-07T00:00:00.000Z'), confirmarDataDiferente: true }), (error) => error instanceof CashOccurrenceContextError && error.code === 'CASH_OCCURRENCE_SCOPE_MISMATCH');
  });
});
