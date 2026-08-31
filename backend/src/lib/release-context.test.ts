import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReleaseSha, resolveReleaseContext } from './release-context.js';
import { createLoggerForDestination } from './logger.js';

test('normaliza o SHA de release fornecido no startup', () => {
  const context = resolveReleaseContext({
    RELEASE_SHA: '  9DEB884D82D90B5CADFC46553D061F71CF7D5D62 ',
    OTEL_SERVICE_NAME: 'quiver-tap-api',
    NODE_ENV: 'production',
  });
  assert.equal(context.releaseSha, '9deb884d82d90b5cadfc46553d061f71cf7d5d62');
  assert.equal(context.service, 'quiver-tap-api');
  assert.equal(context.environment, 'production');
});

test('release fornecido aparece no LogRecord tecnico', () => {
  const lines: string[] = [];
  const release = resolveReleaseContext({
    RELEASE_SHA: '9deb884d',
    NODE_ENV: 'production',
    OTEL_SERVICE_NAME: 'quiver-tap-api',
  });
  createLoggerForDestination({ write: (line: string) => lines.push(line) }, release)
    .info({ event: 'test.release' }, 'release context test');

  const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(event.releaseSha, '9deb884d');
  assert.equal(event.service, 'quiver-tap-api');
  assert.equal(event.environment, 'production');
});

test('ausencia ou valor malformado usam fallback seguro', () => {
  assert.equal(normalizeReleaseSha(undefined), 'unknown');
  assert.equal(normalizeReleaseSha('release-unsafe\nvalue'), 'unknown');
  assert.equal(normalizeReleaseSha('dev'), 'dev');
  assert.equal(resolveReleaseContext({ NODE_ENV: 'production' }).releaseSha, 'unknown');
  assert.equal(resolveReleaseContext({ NODE_ENV: 'development' }).releaseSha, 'dev');
});
