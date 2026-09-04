import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getAlertPollerHealth, pollOnce } from './kibana-alert-poller.js';
import { loadAlertPollerState, saveAlertPollerState, summarizeAlertPollerError } from './alert-poller-state.js';

test('poller persists successful empty polls, errors and sanitized semantic health', async () => {
  const stateFile = path.join(os.tmpdir(), `alert-poller-test-${process.pid}-${Date.now()}.json`);
  const previousFile = process.env.KIBANA_ALERT_POLL_STATE_FILE;
  const previousUrl = process.env.KIBANA_ALERT_ES_URL;
  const originalFetch = globalThis.fetch;
  process.env.KIBANA_ALERT_POLL_STATE_FILE = stateFile;
  process.env.KIBANA_ALERT_ES_URL = 'http://poller-test.invalid';
  const log = { warn() {}, info() {} };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
    await pollOnce(log);
    let state = loadAlertPollerState();
    assert.ok(state.lastPollAttemptAt);
    assert.ok(state.lastSuccessfulPollAt);
    assert.equal(getAlertPollerHealth().status, 'healthy');

    globalThis.fetch = async () => new Response('', { status: 503 });
    await pollOnce(log);
    state = loadAlertPollerState();
    assert.equal(state.lastPollError, 'Elasticsearch HTTP 503');
    assert.equal(getAlertPollerHealth().status, 'degraded');

    assert.doesNotMatch(summarizeAlertPollerError('Authorization=secret-token'), /secret-token/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFile === undefined) delete process.env.KIBANA_ALERT_POLL_STATE_FILE; else process.env.KIBANA_ALERT_POLL_STATE_FILE = previousFile;
    if (previousUrl === undefined) delete process.env.KIBANA_ALERT_ES_URL; else process.env.KIBANA_ALERT_ES_URL = previousUrl;
    fs.rmSync(stateFile, { force: true });
  }
});

test('poller processes an event and records mocked delivery success or failure', async () => {
  const stateFile = path.join(os.tmpdir(), `alert-poller-event-test-${process.pid}-${Date.now()}.json`);
  const previousFile = process.env.KIBANA_ALERT_POLL_STATE_FILE;
  const previousUrl = process.env.KIBANA_ALERT_ES_URL;
  const originalFetch = globalThis.fetch;
  process.env.KIBANA_ALERT_POLL_STATE_FILE = stateFile;
  process.env.KIBANA_ALERT_ES_URL = 'http://poller-test.invalid';
  const log = { warn() {}, info() {} };
  const clock = () => new Date('2030-01-01T00:00:00.000Z');
  const event = { _id: 'event-1', _source: { ruleId: 'test-rule', ruleName: 'Test Alert', environment: 'DEV', alertState: 'active', '@timestamp': '2029-12-31T23:59:59.000Z' } };
  try {
    let deliveries = 0;
    globalThis.fetch = async () => new Response(JSON.stringify({ hits: { hits: [event] } }), { status: 200 });
    await pollOnce(log, { now: clock, notify: async () => { deliveries++; return { sent: true, channels: { email: true } }; } });
    let state = loadAlertPollerState();
    assert.equal(deliveries, 1);
    assert.equal(state.processedIds.includes('event-1'), true);
    assert.equal(state.lastEventProcessedAt, clock().toISOString());
    assert.equal(state.lastSuccessfulDeliveryAt, clock().toISOString());

    await pollOnce(log, { now: clock, notify: async () => { deliveries++; return { sent: true }; } });
    assert.equal(deliveries, 1, 'processed event is not delivered again');

    fs.rmSync(stateFile, { force: true });
    globalThis.fetch = async () => new Response(JSON.stringify({ hits: { hits: [event] } }), { status: 200 });
    await pollOnce(log, { now: clock, notify: async () => { throw new Error('Authorization=mock-secret'); } });
    state = loadAlertPollerState();
    assert.equal(state.lastSuccessfulPollAt, clock().toISOString());
    assert.equal(state.lastSuccessfulDeliveryAt, undefined);
    assert.equal(state.lastDeliveryErrorAt, clock().toISOString());
    assert.doesNotMatch(state.lastDeliveryError ?? '', /mock-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFile === undefined) delete process.env.KIBANA_ALERT_POLL_STATE_FILE; else process.env.KIBANA_ALERT_POLL_STATE_FILE = previousFile;
    if (previousUrl === undefined) delete process.env.KIBANA_ALERT_ES_URL; else process.env.KIBANA_ALERT_ES_URL = previousUrl;
    fs.rmSync(stateFile, { force: true });
  }
});
