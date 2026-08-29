import assert from 'node:assert/strict';
import test from 'node:test';

import { createLoggerForDestination } from './logger.js';
import { logUnhandledRequestError } from './technical-log.js';

test('writes one structured 500 error with request correlation and no duplicated stack field', () => {
  const lines: string[] = [];
  const logger = createLoggerForDestination({ write: (line: string) => lines.push(line) });
  const error = new Error('controlled failure');

  logUnhandledRequestError(
    logger,
    {
      id: 'req-500',
      correlationId: 'd2719d5c-0982-4b83-95c6-0a8e355a5e28',
      method: 'GET',
      url: '/api/test?ignored=true',
      routeOptions: { url: '/api/test' },
    } as never,
    { elapsedTime: 12.6 } as never,
    error,
  );

  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(event.requestId, 'req-500');
  assert.equal(event.correlationId, 'd2719d5c-0982-4b83-95c6-0a8e355a5e28');
  assert.equal(event.method, 'GET');
  assert.equal(event.route, '/api/test');
  assert.equal(event.statusCode, 500);
  assert.equal(event.durationMs, 13);
  assert.equal(event.msg, 'Unhandled request error');
  assert.equal((event.err as Record<string, unknown>).message, 'controlled failure');
  assert.match(String((event.err as Record<string, unknown>).stack), /controlled failure/);
  assert.equal(Object.hasOwn(event, 'stack'), false);
});
