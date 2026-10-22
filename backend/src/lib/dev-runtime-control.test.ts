import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerDevRuntimeControl } from './dev-runtime-control.js';

test('DEV shutdown requires a private capability and is never registered in production', async () => {
  const previous = { env: process.env.NODE_ENV, token: process.env.QUIVER_DEV_SHUTDOWN_TOKEN };
  const token = 'a'.repeat(32);
  let shutdowns = 0;
  try {
    process.env.QUIVER_DEV_SHUTDOWN_TOKEN = token;
    for (const environment of ['production', 'development']) {
      process.env.NODE_ENV = environment;
      const app = Fastify();
      registerDevRuntimeControl(app, async () => { shutdowns++; });
      assert.equal((await app.inject({ method: 'POST', url: '/api/_dev/shutdown' })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: '/api/_dev/shutdown', headers: { 'x-quiver-dev-shutdown-token': 'bad' } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: '/api/_dev/shutdown', headers: { 'x-quiver-dev-shutdown-token': token } })).statusCode, environment === 'production' ? 404 : 202);
      await new Promise(resolve => setImmediate(resolve));
      await app.close();
    }
    assert.equal(shutdowns, 1);
  } finally {
    if (previous.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.env;
    if (previous.token === undefined) delete process.env.QUIVER_DEV_SHUTDOWN_TOKEN; else process.env.QUIVER_DEV_SHUTDOWN_TOKEN = previous.token;
  }
});
