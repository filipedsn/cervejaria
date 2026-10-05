import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommandOccurrenceMatchesSession, CashOccurrenceContextError } from './contexto-ocorrencia.js';

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
