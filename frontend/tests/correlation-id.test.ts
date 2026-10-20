import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRequestHeaders } from '../src/lib/api.ts';
import { api, ApiError } from '../src/lib/api.ts';
import { flushAuditEvents, trackPageView } from '../src/lib/audit-tracker.ts';
import { CORRELATION_ID_HEADER, createCorrelationId } from '../src/lib/correlation-id.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('gera UUID de correlação para uma requisição sem ID existente', () => {
  const correlationId = createCorrelationId();
  assert.equal(CORRELATION_ID_HEADER, 'X-Correlation-Id');
  assert.match(correlationId, UUID_PATTERN);
});

test('wrapper HTTP envia o ID de correlação gerado no header', () => {
  const headers = buildRequestHeaders({ method: 'POST', body: JSON.stringify({ ok: true }) });
  assert.match(headers[CORRELATION_ID_HEADER]!, UUID_PATTERN);
  assert.equal(headers['Content-Type'], 'application/json');
});

async function nextHttpEvent(): Promise<Record<string, unknown>> {
  await flushAuditEvents();
  const telemetryCall = (globalThis.fetch as unknown as { mock: Array<[string, RequestInit]> }).mock
    .find(([url]) => url.endsWith('/api/audit/events'));
  assert.ok(telemetryCall);
  return JSON.parse(String(telemetryCall[1].body)).events[0].http;
}

test('HTTP wrapper strips query and payload from telemetry', async () => {
  const originalFetch = globalThis.fetch;
  const mock: Array<[string, RequestInit]> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    mock.push([url, init ?? {}]);
    if (url.endsWith('/api/audit/events')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'X-Correlation-Id': 'd2719d5c-0982-4b83-95c6-0a8e355a5e28' },
    });
  }) as typeof fetch;
  (globalThis.fetch as unknown as { mock: Array<[string, RequestInit]> }).mock = mock;

  try {
    await api.get('/api/clientes?telefone=27999999999');
    const event = await nextHttpEvent();
    assert.equal(event.method, 'GET');
    assert.equal(event.route, '/api/clientes');
    assert.equal(event.statusCode, 200);
    assert.equal(event.outcome, 'success');
    assert.equal(event.correlationId, 'd2719d5c-0982-4b83-95c6-0a8e355a5e28');
    assert.equal(typeof event.durationMs, 'number');
    assert.equal(JSON.stringify(event).includes('telefone'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mantém IDs isolados em requests paralelas e falha de telemetry é fail-open', async () => {
  const originalFetch = globalThis.fetch;
  const events: Record<string, unknown>[] = [];
  let telemetryAttempts = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/audit/events')) {
      telemetryAttempts += 1;
      events.push(...JSON.parse(String(init?.body)).events.map((event: { http: Record<string, unknown> }) => event.http));
      return new Response(null, { status: telemetryAttempts === 1 ? 500 : 204 });
    }
    const headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'X-Correlation-Id': headers.get('X-Correlation-Id')! },
    });
  }) as typeof fetch;

  try {
    await Promise.all([api.get('/api/a'), api.get('/api/b')]);
    await flushAuditEvents(); // First telemetry transport failure is deliberately ignored.
    await flushAuditEvents(); // Drains the requeued events without changing business results.
    assert.equal(events.length, 4);
    const correlations = new Set(events.map((event) => event.correlationId));
    assert.equal(correlations.size, 2);
    assert.deepEqual(new Set(events.slice(-2).map((event) => event.route)), new Set(['/api/a', '/api/b']));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classifica erros HTTP, rede e abort sem alterar ApiError', async () => {
  const originalFetch = globalThis.fetch;
  const responses: Array<Response | Error> = [
    new Response(JSON.stringify({ error: 'inválido' }), { status: 400 }),
    new Response(JSON.stringify({ error: 'falhou' }), { status: 500 }),
    new Error('offline'),
    Object.assign(new Error('cancelado'), { name: 'AbortError' }),
  ];
  const events: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/audit/events')) {
      events.push(JSON.parse(String(init?.body)).events[0].http);
      return new Response(null, { status: 204 });
    }
    const result = responses.shift()!;
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;

  try {
    for (const expected of ['client_error', 'server_error', 'network_error', 'aborted']) {
      await assert.rejects(api.get('/api/test'), ApiError);
      await flushAuditEvents();
      assert.equal(events.at(-1)?.outcome, expected);
    }
    assert.equal(events[2]?.statusCode, undefined);
    assert.equal(events[3]?.statusCode, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CSV export 200 telemetry and privacy', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const calls: Array<[string, RequestInit]> = [];
  const anchor = { href: '', download: '', click: () => undefined };
  globalThis.document = { createElement: () => anchor } as unknown as Document;
  URL.createObjectURL = () => 'blob:tap96-test';
  URL.revokeObjectURL = () => undefined;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push([url, init ?? {}]);
    if (url.endsWith('/api/audit/events')) return new Response(null, { status: 204 });
    return new Response('csv confidential', {
      status: 200,
      headers: { 'X-Correlation-Id': 'd2719d5c-0982-4b83-95c6-0a8e355a5e28', 'x-request-id': 'export-request-1' },
    });
  }) as typeof fetch;
  (globalThis.fetch as unknown as { mock: Array<[string, RequestInit]> }).mock = calls;

  try {
    const { downloadCsv } = await import('../src/lib/api.ts');
    await downloadCsv('/api/relatorios/exportar?cliente=confidencial', 'relatorio.csv');
    const telemetry = await nextHttpEvent();
    assert.equal(telemetry.method, 'GET');
    assert.equal(telemetry.route, '/api/relatorios/exportar');
    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.outcome, 'success');
    assert.equal(telemetry.correlationId, 'd2719d5c-0982-4b83-95c6-0a8e355a5e28');
    assert.equal(telemetry.requestId, 'export-request-1');
    assert.equal(anchor.download, 'relatorio.csv');
    assert.equal(JSON.stringify(telemetry).includes('confidencial'), false);
    assert.equal(JSON.stringify(telemetry).includes('csv confidential'), false);
    assert.equal(calls[0]?.[1].headers && new Headers(calls[0][1].headers).has(CORRELATION_ID_HEADER), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('CSV export HTTP and network failures', async () => {
  const originalFetch = globalThis.fetch;
  const outcomes: string[] = [];
  let failNetwork = false;
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/api/audit/events')) {
      outcomes.push(...JSON.parse(String(init?.body)).events.map((event: { http: { outcome: string } }) => event.http.outcome));
      return new Response(null, { status: 204 });
    }
    if (failNetwork) throw new Error('offline');
    return new Response('ignored', { status: 403 });
  }) as typeof fetch;

  try {
    const { downloadCsv } = await import('../src/lib/api.ts');
    await assert.rejects(downloadCsv('/api/relatorios/exportar?token=private', 'relatorio.csv'), ApiError);
    await flushAuditEvents();
    failNetwork = true;
    await assert.rejects(downloadCsv('/api/relatorios/exportar?token=private', 'relatorio.csv'));
    await flushAuditEvents();
    assert.deepEqual(outcomes, ['client_error', 'network_error']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('page_view conserva somente a rota e descarta query e fragmento', async () => {
  const originalFetch = globalThis.fetch;
  let page: string | undefined;
  globalThis.fetch = (async (_input, init) => {
    page = JSON.parse(String(init?.body)).events[0].page;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    trackPageView('/recuperar?email=private@example.test#token-private');
    await flushAuditEvents();
    assert.equal(page, '/recuperar');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
