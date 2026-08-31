import assert from 'node:assert/strict';
import test from 'node:test';
import { realtimeEvent } from './socket-auth.js';
import { createLoggerForDestination } from './logger.js';

test('emite contexto realtime seguro e preserva correlation ID válido', () => {
  const records: unknown[] = [];
  const app = { log: { info: (payload: unknown) => records.push(payload), warn: (payload: unknown) => records.push(payload) } };
  const socket = { id: 'socket-a', handshake: { headers: { 'x-correlation-id': 'd2719d5c-0982-4b83-95c6-0a8e355a5e28' } } };
  realtimeEvent(app as never, socket as never, 'realtime.session.accepted', { actorType: 'staff', userId: 'user-a' });
  assert.deepEqual(records[0], {
    event: 'realtime.session.accepted', socketId: 'socket-a', correlationId: 'd2719d5c-0982-4b83-95c6-0a8e355a5e28', actorType: 'staff', userId: 'user-a',
  });
  assert.equal(JSON.stringify(records[0]).includes('token'), false);
  assert.equal(JSON.stringify(records[0]).includes('cookie'), false);
});

test('realtime events inherit release context from the central logger', () => {
  const lines: string[] = [];
  const log = createLoggerForDestination({ write: (line: string) => lines.push(line) });
  const app = { log };
  const socket = { id: 'socket-release', handshake: { headers: {} } };

  realtimeEvent(app as never, socket as never, 'realtime.room.joined', { actorType: 'staff' });

  const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(event.event, 'realtime.room.joined');
  assert.equal(event.releaseSha, 'dev');
  assert.equal(event.service, 'quiver-tap-api');
  assert.equal(event.environment, 'development');
});

test('falha de telemetria realtime é fail-open', () => {
  const app = { log: { info: () => { throw new Error('telemetry unavailable'); }, warn: () => { throw new Error('telemetry unavailable'); } } };
  const socket = { id: 'socket-b', handshake: { headers: {} } };
  assert.doesNotThrow(() => realtimeEvent(app as never, socket as never, 'realtime.room.denied', { reasonCode: 'TENANT_MISMATCH' }));
});
