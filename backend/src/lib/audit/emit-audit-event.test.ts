import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuditPayload } from './emit-audit-event.js';

test('adds the isolated QA run marker to audit logs only from the runner process', () => {
  const previousMode = process.env.PDV_ISOLATED_QA;
  const previousRunId = process.env.PDV_QA_RUN_ID;
  try {
    process.env.PDV_ISOLATED_QA = '1';
    process.env.PDV_QA_RUN_ID = '0123456789abcdef';
    const payload = buildAuditPayload({
      action: 'portal.pdv.pedido_criado',
      message: 'Synthetic order created',
      cervejariaId: 'tenant-safe-id',
      actor: { type: 'cliente-pdv', id: 'client-safe-id', clienteId: 'client-safe-id' },
      requestId: 'request-safe-id',
      correlationId: 'correlation-safe-id',
    });

    assert.equal(payload['test.synthetic'], true);
    assert.equal(payload['test.run.id'], '0123456789abcdef');
    assert.equal(payload['cervejaria.id'], 'tenant-safe-id');
    assert.equal(payload['actor.type'], 'cliente-pdv');
    assert.equal(payload['actor.id'], 'client-safe-id');
    assert.equal(payload.requestId, 'request-safe-id');
    assert.equal(payload.correlationId, 'correlation-safe-id');
    assert.equal(Object.keys(payload).some((key) => /email|senha|password|cookie|token/i.test(key)), false);
  } finally {
    if (previousMode === undefined) delete process.env.PDV_ISOLATED_QA;
    else process.env.PDV_ISOLATED_QA = previousMode;
    if (previousRunId === undefined) delete process.env.PDV_QA_RUN_ID;
    else process.env.PDV_QA_RUN_ID = previousRunId;
  }
});

test('does not trust malformed QA run IDs or add run markers outside isolated QA', () => {
  const previousMode = process.env.PDV_ISOLATED_QA;
  const previousRunId = process.env.PDV_QA_RUN_ID;
  try {
    process.env.PDV_ISOLATED_QA = '1';
    process.env.PDV_QA_RUN_ID = 'scenario-from-request-header';
    const malformed = buildAuditPayload({ action: 'auth.login.succeeded', message: 'Login succeeded' });
    assert.equal(Object.hasOwn(malformed, 'test.run.id'), false);

    process.env.PDV_ISOLATED_QA = '0';
    process.env.PDV_QA_RUN_ID = '0123456789abcdef';
    const outsideQa = buildAuditPayload({ action: 'auth.login.succeeded', message: 'Login succeeded' });
    assert.equal(Object.hasOwn(outsideQa, 'test.synthetic'), false);
    assert.equal(Object.hasOwn(outsideQa, 'test.run.id'), false);
  } finally {
    if (previousMode === undefined) delete process.env.PDV_ISOLATED_QA;
    else process.env.PDV_ISOLATED_QA = previousMode;
    if (previousRunId === undefined) delete process.env.PDV_QA_RUN_ID;
    else process.env.PDV_QA_RUN_ID = previousRunId;
  }
});
