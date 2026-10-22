import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { pollOnce } from './kibana-alert-poller.js';
import { loadAlertPollerState, saveAlertPollerState } from './alert-poller-state.js';

test('unacknowledged late events survive failed delivery, equal timestamps and restart', async () => {
  process.env.KIBANA_ALERT_POLL_STATE_FILE = join(mkdtempSync(join(tmpdir(), 'tap96-poller-')), 'state.json');
  process.env.KIBANA_ALERT_ES_URL = 'http://isolated.invalid';
  const original = globalThis.fetch;
  const timestamp = '2026-10-20T00:00:00.000Z';
  saveAlertPollerState({ lastPollIso: '2026-10-21T00:00:00.000Z', processedIds: [] });
  const remaining = new Map(Array.from({ length: 75 }, (_, i) => [`event-${i}`, { '@timestamp': timestamp }]));
  const delivered = new Set<string>();
  let fail = true;
  const log = { warn() {}, info() {} };
  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (String(url).includes('/_update/')) { remaining.delete(decodeURIComponent(String(url).split('/').at(-1)!)); return new Response('{}'); }
      const gt = body.query.bool.must?.[0]?.range?.['@timestamp']?.gt;
      const hits = [...remaining].filter(([, src]) => !gt || src['@timestamp'] > gt)
        .slice(0, body.size).map(([_id, _source]) => ({ _id, _source }));
      return new Response(JSON.stringify({ hits: { hits } }));
    };
    const notify = async (_: unknown, id?: string) => {
      if (id === 'event-12' && fail) throw new Error('synthetic transient delivery failure');
      assert.ok(id); delivered.add(id); return { sent: true };
    };
    await pollOnce(log, { notify }); fail = false;
    for (let i = 0; i < 4; i++) await pollOnce(log, { notify });
    assert.equal(delivered.size, 75);
    assert.equal(remaining.size, 0);
    assert.ok(loadAlertPollerState().lastSuccessfulDeliveryAt);
  } finally { globalThis.fetch = original; }
});

test('complete alert flow formats firing and resolved through the existing Telegram transport in isolation', async () => {
  process.env.KIBANA_ALERT_POLL_STATE_FILE = join(mkdtempSync(join(tmpdir(), 'tap96-channel-')), 'state.json');
  process.env.KIBANA_ALERT_ES_URL = 'http://isolated.invalid';
  process.env.OBS_ALERT_TELEGRAM_BOT_TOKEN = 'synthetic-test-token';
  process.env.OBS_ALERT_TELEGRAM_CHAT_ID = 'synthetic-test-chat';
  delete process.env.OBS_ALERT_EMAIL_TO;
  const original = globalThis.fetch;
  const sent: Array<{ text: string }> = [];
  const acknowledged = new Set<string>();
  const events = ['active', 'recovered'].map((alertState, i) => ({ _id: `tap96-synthetic-${i}`, _source: { '@timestamp': new Date().toISOString(), ruleName: 'TESTE TAP-96', alertState, reason: 'Isolated channel proof' } }));
  try {
    globalThis.fetch = async (url, options) => {
      assert.ok(options?.signal, 'every remote transport has an explicit timeout');
      if (String(url).startsWith('https://api.telegram.org/')) { sent.push(JSON.parse(String(options?.body))); return new Response('{"ok":true}'); }
      if (String(url).includes('/_update/')) { acknowledged.add(String(url).split('/').at(-1)!); return new Response('{}'); }
      return new Response(JSON.stringify({ hits: { hits: events.filter(e => !acknowledged.has(e._id)) } }));
    };
    await pollOnce({ warn() {}, info() {} });
    assert.equal(sent.length, 2);
    assert.ok(sent.every(message => message.text.includes('TAP-96')));
    assert.equal(acknowledged.size, 2);
    await pollOnce({ warn() {}, info() {} });
    assert.equal(sent.length, 2, 'restart/dedup does not resend acknowledged alerts');
  } finally { globalThis.fetch = original; delete process.env.OBS_ALERT_TELEGRAM_BOT_TOKEN; delete process.env.OBS_ALERT_TELEGRAM_CHAT_ID; }
});

test('stalled Elasticsearch fetch times out and the next poll recovers', { timeout: 16_000 }, async () => {
  process.env.KIBANA_ALERT_POLL_STATE_FILE = join(mkdtempSync(join(tmpdir(), 'tap96-timeout-')), 'state.json');
  let stall = true;
  const server = createServer((_req, res) => { if (!stall) { res.writeHead(200); res.end('{"hits":{"hits":[]}}'); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.KIBANA_ALERT_ES_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const started = Date.now();
    await pollOnce({ warn() {}, info() {} });
    assert.ok(Date.now() - started < 13_000);
    assert.ok(loadAlertPollerState().lastPollError);
    stall = false;
    await pollOnce({ warn() {}, info() {} });
    assert.equal(loadAlertPollerState().lastPollError, undefined);
    assert.ok(loadAlertPollerState().lastSuccessfulPollAt);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
