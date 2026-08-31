import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';

import {
  classifyDbError,
  observeDbOperation,
  observeDbTransaction,
  sanitizedDbErrorMessage,
} from './prisma-observability.js';
import { createLoggerForDestination } from './logger.js';
import { runWithTelemetryContext } from './telemetry-context.js';

type LogCall = { level: 'warn' | 'error'; fields: Record<string, unknown>; message: string };

function logCapture() {
  const calls: LogCall[] = [];
  return {
    calls,
    logger: {
      warn(fields: Record<string, unknown>, message: string) {
        calls.push({ level: 'warn', fields, message });
      },
      error(fields: Record<string, unknown>, message: string) {
        calls.push({ level: 'error', fields, message });
      },
    },
  };
}

function knownError(code: string, message = 'unsafe SQL SELECT * FROM users WHERE email = secret@example.com') {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
}

test('operação rápida normal não gera sinal técnico adicional', async () => {
  const capture = logCapture();
  let tick = 100;
  const value = await observeDbOperation(
    { model: 'Comanda', operation: 'findUnique' },
    async () => 'ok',
    capture.logger,
    () => tick++,
  );

  assert.equal(value, 'ok');
  assert.deepEqual(capture.calls, []);
});

test('operação lenta gera db.operation.slow sem args ou SQL', async () => {
  const capture = logCapture();
  const clock = [10, 511];
  await observeDbOperation(
    { model: 'Comanda', operation: 'findMany' },
    async () => [],
    capture.logger,
    () => clock.shift() ?? 511,
  );

  assert.equal(capture.calls.length, 1);
  assert.equal(capture.calls[0]?.level, 'warn');
  assert.deepEqual(capture.calls[0]?.fields, {
    event: 'db.operation.slow', model: 'Comanda', operation: 'findMany', durationMs: 501,
  });
});

test('erro Prisma conhecido classifica constraint e não expõe SQL, params ou PII', async () => {
  const capture = logCapture();
  const error = knownError('P2002');
  await assert.rejects(
    observeDbOperation(
      { model: 'Usuario', operation: 'create' },
      async () => { throw error; },
      capture.logger,
      (() => { let tick = 1; return () => tick++; })(),
    ),
    error,
  );

  const call = capture.calls[0];
  assert.equal(call?.level, 'warn');
  assert.equal(call?.fields.event, 'db.operation.failed');
  assert.equal(call?.fields.category, 'CONSTRAINT');
  assert.equal(call?.fields.prismaCode, 'P2002');
  assert.equal(call?.fields['error.message'], 'Database operation failed (CONSTRAINT)');
  assert.doesNotMatch(JSON.stringify(call), /SELECT|email|secret@example\.com/i);
});

test('códigos PostgreSQL explícitos distinguem deadlock, lock timeout e timeout', () => {
  assert.equal(classifyDbError({ code: '40P01' }), 'DEADLOCK');
  assert.equal(classifyDbError({ code: '55P03' }), 'LOCK_TIMEOUT');
  assert.equal(classifyDbError({ code: '57014' }), 'TIMEOUT');
  assert.equal(classifyDbError({ code: '08006' }), 'CONNECTION');
  assert.equal(classifyDbError({ code: 'ECONNRESET' }), 'CONNECTION');
  assert.equal(
    classifyDbError(new Prisma.PrismaClientInitializationError('unsafe connection URL', 'test', 'P1001')),
    'CONNECTION',
  );
});

test('falha técnica de transação gera db.transaction.failed', async () => {
  const capture = logCapture();
  const error = knownError('P2024');
  await assert.rejects(
    observeDbTransaction(async () => { throw error; }, capture.logger),
    error,
  );

  assert.equal(capture.calls.length, 1);
  assert.equal(capture.calls[0]?.fields.event, 'db.transaction.failed');
  assert.equal(capture.calls[0]?.fields.category, 'TIMEOUT');
});

test('erro funcional em transação não vira incidente de banco', async () => {
  const capture = logCapture();
  const error = new Error('Saldo insuficiente');
  await assert.rejects(observeDbTransaction(async () => { throw error; }, capture.logger), error);
  assert.deepEqual(capture.calls, []);
});

test('mensagem sanitizada é fixa e independente da mensagem do driver', () => {
  assert.equal(sanitizedDbErrorMessage('CONNECTION'), 'Database operation failed (CONNECTION)');
});

test('sinal de banco preserva request, correlação e contexto seguro', async () => {
  const lines: string[] = [];
  const log = createLoggerForDestination({ write: (line: string) => lines.push(line) });
  await runWithTelemetryContext(
    {
      requestId: 'req-db-42',
      correlationId: 'd2719d5c-0982-4b83-95c6-0a8e355a5e28',
      cervejariaId: 'brewery-42', slug: 'brewery', env: 'dev',
      actor: { type: 'usuario', id: 'user-42', role: 'DONO' },
    },
    () => observeDbOperation(
      { model: 'Pedido', operation: 'update' },
      async () => { throw knownError('P2024'); },
      log,
    ),
  ).catch(() => undefined);

  const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(event.requestId, 'req-db-42');
  assert.equal(event.correlationId, 'd2719d5c-0982-4b83-95c6-0a8e355a5e28');
  assert.equal(event.cervejariaId, 'brewery-42');
  assert.equal(event.userId, 'user-42');
  assert.equal(event.role, 'DONO');
  assert.equal(event.releaseSha, 'dev');
});

test('falha do logger é fail-open para operação e erro de banco', async () => {
  const failingLogger = {
    warn() { throw new Error('telemetry offline'); },
    error() { throw new Error('telemetry offline'); },
  };
  assert.deepEqual(
    await observeDbOperation({ model: 'Tap', operation: 'findMany' }, async () => ['ok'], failingLogger),
    ['ok'],
  );
  const dbError = knownError('P1001');
  await assert.rejects(
    observeDbOperation({ model: 'Tap', operation: 'findMany' }, async () => { throw dbError; }, failingLogger),
    dbError,
  );
});
