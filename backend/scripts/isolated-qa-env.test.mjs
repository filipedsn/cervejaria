import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

test('aceita apenas o destino PostgreSQL QA isolado', () => {
  const base = { PDV_ISOLATED_QA: '1', QA_DATABASE_URL: 'postgresql://qa@127.0.0.1:55439/cervejaria_qa_pdv_unico' };
  assert.doesNotThrow(() => validateIsolatedQaEnvironment(base));
  assert.doesNotThrow(() => validateIsolatedQaEnvironment({ ...base, QA_DATABASE_URL: 'postgresql://qa@127.0.0.1:55440/cervejaria_qa_pdv_unico' }), 'commerce QA may use a free port in the reserved disposable range');
  for (const QA_DATABASE_URL of [
    'postgresql://qa@127.0.0.1:5434/cervejaria_dev',
    'postgresql://qa@127.0.0.1:55439/cervejaria_qa_pdv_unico_extra',
    'postgresql://qa@example.com:55439/cervejaria_qa_pdv_unico',
    'postgresql://qa@127.0.0.1:55450/cervejaria_qa_pdv_unico',
    'postgresql://qa@127.0.0.1:55439/cervejaria_qa_pdv_unico?host=prod.example',
    'not-a-url',
  ]) assert.throws(() => validateIsolatedQaEnvironment({ ...base, QA_DATABASE_URL }));
  assert.throws(() => validateIsolatedQaEnvironment({ ...base, PDV_ISOLATED_QA: undefined }));
});
