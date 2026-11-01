import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { formatFiring, formatInfo, formatReminder, NotificationService, RATE_LIMIT_NOTICE, routeTemplate, scrubPersonalData, TelegramClient, toSafeErrorContext, type TelegramSender } from '../src/notify/index.js';
import { DETECTOR_RULES } from '../src/watch/types.js';

const baseConfig = { enabled: true, dryRun: false, botToken: '123456:SECRET-TOKEN', chatId: '-100', maxPerHour: 20 };

function recordingSender(results: Array<{ sent: boolean; error?: string }> = []) {
  const texts: string[] = [];
  const sender: TelegramSender = { send: async (text: string) => { texts.push(text); return results.shift() ?? { sent: true }; } };
  return { sender, texts };
}

async function readOutbox(service: NotificationService): Promise<Array<Record<string, unknown>>> {
  try {
    return (await readFile(service.outboxPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'notify-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('dry-run writes the outbox and never calls Telegram', () => withDir(async (dir) => {
  const { sender, texts } = recordingSender();
  const service = new NotificationService({ config: { ...baseConfig, dryRun: true }, runtimeDir: dir, client: sender });
  assert.equal(service.mode, 'dry-run');
  await service.send('FIRING', '[ANALISTA] teste', 'public-site-down');
  assert.equal(texts.length, 0);
  const outbox = await readOutbox(service);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]?.dryRun, true);
  assert.equal(outbox[0]?.sent, false);
}));

test('hourly limit sends a single notice and keeps the rest in the outbox', () => withDir(async (dir) => {
  const { sender, texts } = recordingSender();
  const service = new NotificationService({ config: { ...baseConfig, maxPerHour: 2 }, runtimeDir: dir, client: sender });
  for (let i = 0; i < 4; i += 1) await service.send('FIRING', `[ANALISTA] msg ${i}`);
  assert.deepEqual(texts, ['[ANALISTA] msg 0', '[ANALISTA] msg 1', RATE_LIMIT_NOTICE]);
  const outbox = await readOutbox(service);
  assert.equal(outbox.filter((entry) => entry.suppressedByRateLimit === true).length, 2);
}));

test('the bot token never reaches the outbox or the state file', () => withDir(async (dir) => {
  const client = new TelegramClient(baseConfig.botToken, baseConfig.chatId, async (url: string) => { throw new Error(`connect ECONNREFUSED ${url}`); });
  const service = new NotificationService({ config: baseConfig, runtimeDir: dir, client });
  await service.send('FIRING', '[ANALISTA] teste');
  const outbox = await readFile(service.outboxPath, 'utf8');
  assert.equal(outbox.includes('SECRET-TOKEN'), false);
  assert.match(outbox, /\[REDACTED\]/);
  const state = await readFile(join(dir, 'notifications', 'state.json'), 'utf8');
  assert.equal(state.includes('SECRET-TOKEN'), false);
}));

test('a failed send stays pending and is delivered on flush', () => withDir(async (dir) => {
  const { sender, texts } = recordingSender([{ sent: false, error: 'HTTP 502' }, { sent: true }]);
  const service = new NotificationService({ config: baseConfig, runtimeDir: dir, client: sender });
  await service.send('FIRING', '[ANALISTA] pendente');
  await service.flushPending();
  assert.deepEqual(texts, ['[ANALISTA] pendente', '[ANALISTA] pendente']);
  const state = JSON.parse(await readFile(join(dir, 'notifications', 'state.json'), 'utf8')) as { pending: unknown[] };
  assert.equal(state.pending.length, 0);
}));

const personal = {
  name: 'Maria Souza',
  email: 'maria.souza@cervejaria.example',
  ipv4: '187.45.120.33',
  ipv6: '2804:14c:65a1:4000::1b2',
  city: 'Florianópolis',
  search: 'ipa sem gluten',
};

test('the Telegram formatter omits name, e-mail, IP, city and search term from a raw journey-like context', () => {
  const raw = {
    routes: [{ route: '/api/clientes/48213/historico?email=maria.souza@cervejaria.example', count: 12 }, { route: personal.city, count: 3 }],
    correlationIds: ['3f2a9c1e-77aa-4b1e-9d1a-0c2b9d1e5f10', personal.email, `${personal.name}`],
    'user.name': personal.name,
    'user.email': personal.email,
    'client.address': personal.ipv4,
    'client.geo.city_name': personal.city,
    'ui.search.term': personal.search,
  };
  const context = toSafeErrorContext(raw);
  assert.deepEqual(context, { routes: [{ route: '/api/clientes/:id/historico', count: 12 }], correlationIds: ['3f2a9c1e-77aa-4b1e-9d1a-0c2b9d1e5f10'] });
  const detail = `falha para ${personal.email} vindo de ${personal.ipv4} / ${personal.ipv6}`;
  const text = formatFiring(DETECTOR_RULES['error-log-surge'], '2026-11-01T15:00:00.000Z', detail, { context: raw as never, kibanaUrl: 'https://kibana.example.test', environment: 'prd' });
  for (const value of Object.values(personal)) assert.equal(text.includes(value), false, `vazou: ${value}`);
  assert.match(text, /\[e-mail omitido\]/);
  assert.match(text, /\[ip omitido\]/);
  assert.match(text, /\/api\/clientes\/:id\/historico \(12\)/);
  assert.match(text, /--correlacao 3f2a9c1e-77aa-4b1e-9d1a-0c2b9d1e5f10 --env prd/);
  for (const message of [formatReminder(DETECTOR_RULES['public-site-down'], 5, detail), formatInfo(detail)]) {
    assert.equal(message.includes(personal.email) || message.includes(personal.ipv4) || message.includes(personal.ipv6), false);
  }
});

test('the notification service scrubs e-mails and IPs even from free text', () => withDir(async (dir) => {
  const { sender, texts } = recordingSender();
  const service = new NotificationService({ config: baseConfig, runtimeDir: dir, client: sender });
  await service.send('INFO', `[ANALISTA] contato ${personal.email} ip ${personal.ipv4} e ${personal.ipv6}`);
  assert.equal(texts.length, 1);
  assert.equal(texts[0]!.includes(personal.email) || texts[0]!.includes(personal.ipv4) || texts[0]!.includes(personal.ipv6), false);
  const outbox = await readFile(service.outboxPath, 'utf8');
  assert.equal(outbox.includes(personal.email) || outbox.includes(personal.ipv4), false);
}));

test('scrubbing keeps times, versions, route templates and UUIDs intact', () => {
  const text = 'Desde: 01/11/2026 15:00 | versão 9.5.5 | /api/comandas/:id | 3f2a9c1e-77aa-4b1e-9d1a-0c2b9d1e5f10 | http://localhost:5601/app';
  assert.equal(scrubPersonalData(text), text);
  assert.equal(scrubPersonalData('loopback ::1 e 10.0.0.12'), 'loopback [ip omitido] e [ip omitido]');
  assert.equal(routeTemplate('/api/pedidos/9b2f6c1e-0d4a-4e8b-9a77-1f2e3d4c5b6a?x=1'), '/api/pedidos/:id');
  assert.equal(routeTemplate('sem-barra'), undefined);
});
