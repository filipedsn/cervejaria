import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { logs } from '@opentelemetry/api-logs';
import { buildAuditPayload, emitAuditEvent } from './emit-audit-event.js';
import { runWithTelemetryContext, type TelemetryContext } from '../telemetry-context.js';

const staffContext: TelemetryContext = {
  slug: 'tenant-journey',
  env: 'dev',
  cervejariaId: 'tenant-journey-id',
  actor: { type: 'usuario', id: 'staff-1', role: 'DONO', name: 'Maria Souza', email: 'maria@example.test' },
  clientIp: '200.160.2.3',
  clientIpSource: 'cloudflare',
  clientCountryCode: 'BR',
};

test('jornada: registra quem (usuário), onde (IP, origem, país) e o dispositivo', () => {
  const payload = runWithTelemetryContext(staffContext, () => buildAuditPayload({
    action: 'ui.search',
    message: 'Buscou "chope" em /operacao/comandas',
    ui: { page: '/operacao/comandas', route: '/operacao/comandas', searchTerm: 'chope', viewport: '1280x720' },
    client: { sessionId: 'abcdef0123456789abcdef0123456789', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
  }));
  assert.equal(payload['user.id'], 'staff-1');
  assert.equal(payload['user.name'], 'Maria Souza');
  assert.equal(payload['user.email'], 'maria@example.test');
  assert.equal(payload['user.roles'], 'DONO');
  assert.equal(payload['client.address'], '200.160.2.3');
  assert.equal(payload['client.ip_source'], 'cloudflare');
  assert.equal(payload['client.geo.country_iso_code'], 'BR');
  assert.equal(payload['session.id'], 'abcdef0123456789abcdef0123456789');
  assert.equal(payload['user_agent.original'], 'Mozilla/5.0 (X11; Linux x86_64)');
  assert.equal(payload['ui.route'], '/operacao/comandas');
  assert.equal(payload['ui.search.term'], 'chope');
  assert.equal(payload['ui.viewport'], '1280x720');
});

test('jornada: web vital e erro de interface viram campos próprios', () => {
  const payload = runWithTelemetryContext(staffContext, () => buildAuditPayload({
    action: 'ui.error',
    message: 'Erro na interface em /operacao/caixa: boom',
    outcome: 'failure',
    vital: { name: 'LCP', value: 2300, rating: 'good' },
    error: { message: 'boom', stackTrace: 'Error: boom\n    at x', type: 'TypeError' },
  }));
  assert.equal(payload['ui.vital.name'], 'LCP');
  assert.equal(payload['ui.vital.value'], 2300);
  assert.equal(payload['ui.vital.rating'], 'good');
  assert.equal(payload['error.message'], 'boom');
  assert.equal(payload['error.stack_trace'], 'Error: boom\n    at x');
  assert.equal(payload['error.type'], 'TypeError');
});

test('metadata semântico e funcional vira atributos pesquisáveis além do JSON', () => {
  const payload = runWithTelemetryContext(staffContext, () => buildAuditPayload({
    action: 'ui.error',
    message: 'Erro',
    outcome: 'failure',
    metadata: {
      handled: true,
      kind: 'validation',
      operation: 'comanda.itens.incluir',
      livre: 'nao promovido',
      context: { comandaNumero: 42, resumo: 'Comanda #42 · Mesa 3' },
      intent: { summary: 'Incluir 2x Chopp', itens: [{ produtoNome: 'Chopp' }] },
    },
  }));
  assert.equal(payload['metadata.handled'], true);
  assert.equal(payload['metadata.kind'], 'validation');
  assert.equal(payload['metadata.operation'], 'comanda.itens.incluir');
  assert.equal(payload['metadata.context.comandaNumero'], 42);
  assert.equal(payload['metadata.intent.summary'], 'Incluir 2x Chopp');
  assert.equal(Object.hasOwn(payload, 'metadata.livre'), false);
  assert.equal(Object.hasOwn(payload, 'metadata.intent.itens'), false);
  assert.equal((payload.metadata as Record<string, unknown>).livre, 'nao promovido');
});

test('cada evento de audit vira um único registro OTLP (sem cópia via Pino)', () => {
  const emitted: Array<{ attributes?: Record<string, unknown> }> = [];
  const getLogger = mock.method(logs, 'getLogger', () => ({ emit: (record: { attributes?: Record<string, unknown> }) => emitted.push(record) }));
  try {
    runWithTelemetryContext(staffContext, () => emitAuditEvent({ action: 'ui.error', message: 'boom', outcome: 'failure' }));
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].attributes?.['event.action'], 'ui.error');
  } finally {
    getLogger.mock.restore();
  }
});

test('cliente do portal não ganha nome nem e-mail e contexto sem IP não cria campos vazios', () => {
  const payload = runWithTelemetryContext(
    { slug: 'tenant-journey', env: 'dev', actor: { type: 'cliente-pdv', id: 'cliente-1', clienteId: 'cliente-1' } },
    () => buildAuditPayload({ action: 'ui.click', message: 'Clicou' }),
  );
  assert.equal(payload['user.id'], 'cliente-1');
  for (const key of ['user.name', 'user.email', 'user.roles', 'client.address', 'client.ip_source', 'session.id', 'user_agent.original']) {
    assert.equal(Object.hasOwn(payload, key), false, key);
  }
});

test('adds the isolated QA run marker to audit logs only from the runner process', () => {
  const previousMode = process.env.PDV_ISOLATED_QA;
  const previousRunId = process.env.PDV_QA_RUN_ID;
  try {
    process.env.PDV_ISOLATED_QA = '1';
    process.env.PDV_QA_RUN_ID = '0123456789abcdef';
    const payload = buildAuditPayload({
      action: 'portal.pdv.pedido_criado',
      message: 'Synthetic order created',
      cervejariaId: 'tenant-safe-id',
      actor: { type: 'cliente-pdv', id: 'client-safe-id', clienteId: 'client-safe-id' },
      requestId: 'request-safe-id',
      correlationId: 'correlation-safe-id',
    });

    assert.equal(payload['test.synthetic'], true);
    assert.equal(payload['test.run.id'], '0123456789abcdef');
    assert.equal(payload['cervejaria.id'], 'tenant-safe-id');
    assert.equal(payload['actor.type'], 'cliente-pdv');
    assert.equal(payload['actor.id'], 'client-safe-id');
    assert.equal(payload.requestId, 'request-safe-id');
    assert.equal(payload.correlationId, 'correlation-safe-id');
    assert.equal(Object.keys(payload).some((key) => /email|senha|password|cookie|token/i.test(key)), false);
  } finally {
    if (previousMode === undefined) delete process.env.PDV_ISOLATED_QA;
    else process.env.PDV_ISOLATED_QA = previousMode;
    if (previousRunId === undefined) delete process.env.PDV_QA_RUN_ID;
    else process.env.PDV_QA_RUN_ID = previousRunId;
  }
});

test('does not trust malformed QA run IDs or add run markers outside isolated QA', () => {
  const previousMode = process.env.PDV_ISOLATED_QA;
  const previousRunId = process.env.PDV_QA_RUN_ID;
  try {
    process.env.PDV_ISOLATED_QA = '1';
    process.env.PDV_QA_RUN_ID = 'scenario-from-request-header';
    const malformed = buildAuditPayload({ action: 'auth.login.succeeded', message: 'Login succeeded' });
    assert.equal(Object.hasOwn(malformed, 'test.run.id'), false);

    process.env.PDV_ISOLATED_QA = '0';
    process.env.PDV_QA_RUN_ID = '0123456789abcdef';
    const outsideQa = buildAuditPayload({ action: 'auth.login.succeeded', message: 'Login succeeded' });
    assert.equal(Object.hasOwn(outsideQa, 'test.synthetic'), false);
    assert.equal(Object.hasOwn(outsideQa, 'test.run.id'), false);
  } finally {
    if (previousMode === undefined) delete process.env.PDV_ISOLATED_QA;
    else process.env.PDV_ISOLATED_QA = previousMode;
    if (previousRunId === undefined) delete process.env.PDV_QA_RUN_ID;
    else process.env.PDV_QA_RUN_ID = previousRunId;
  }
});
