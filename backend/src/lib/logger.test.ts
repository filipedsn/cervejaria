import assert from 'node:assert/strict';
import test from 'node:test';

import { createLoggerForDestination } from './logger.js';
import { runWithTelemetryContext } from './telemetry-context.js';

function capture() {
  const lines: string[] = [];
  return {
    lines,
    destination: { write: (line: string) => lines.push(line) },
  };
}

test('redacts secrets recursively and preserves safe request context in a Pino child', () => {
  const output = capture();
  const log = createLoggerForDestination(output.destination);

  runWithTelemetryContext(
    {
      requestId: 'req-42',
      correlationId: 'd2719d5c-0982-4b83-95c6-0a8e355a5e28',
      cervejariaId: 'brewery-42',
      slug: 'brewery',
      env: 'dev',
      actor: { type: 'usuario', id: 'user-42', role: 'DONO' },
    },
    () => log.child({ method: 'POST', route: '/api/test' }).error({
      authorization: 'Bearer should-not-appear',
      nested: { accessToken: 'should-not-appear', connectionString: 'postgresql://user:pass@example/db' },
      safe: 'kept',
    }, 'controlled failure'),
  );

  assert.equal(output.lines.length, 1);
  const event = JSON.parse(output.lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(event.requestId, 'req-42');
  assert.equal(event.correlationId, 'd2719d5c-0982-4b83-95c6-0a8e355a5e28');
  assert.equal(event.userId, 'user-42');
  assert.equal(event.role, 'DONO');
  assert.equal(event.method, 'POST');
  assert.equal(event.route, '/api/test');
  assert.equal(event['data_stream.dataset'], 'technical');
  assert.equal(event['data_stream.namespace'], 'dev');
  assert.equal(event.releaseSha, 'dev');
  assert.equal(event.service, 'quiver-tap-api');
  assert.equal(event.environment, 'development');
  assert.equal(event.hostname, undefined);
  assert.equal(event.pid, undefined);
  assert.equal(event.safe, 'kept');
  assert.equal(event.authorization, '[REDACTED]');
  assert.deepEqual(event.nested, { accessToken: '[REDACTED]', connectionString: '[REDACTED]' });
  assert.doesNotMatch(output.lines[0] ?? '', /should-not-appear|postgresql:\/\/user:pass/i);
});
