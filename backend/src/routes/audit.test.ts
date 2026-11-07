import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auditRoutes } from './audit.js';
import { getTelemetryContext, publicPortalKind, type TelemetryContext } from '../lib/telemetry-context.js';
import type { ClienteSessionPayload, PdvClienteSessionPayload } from '../types/cliente-session.js';
import type { AuditEventInput } from '../lib/audit/emit-audit-event.js';

const pdvSession: PdvClienteSessionPayload = {
  type: 'cliente-pdv',
  cervejariaId: 'tenant-customer',
  pontoVendaId: 'pdv-customer',
  clienteId: 'customer-a',
  comandaId: 'command-a',
};

const legacySession: ClienteSessionPayload = {
  type: 'cliente',
  cervejariaId: 'tenant-legacy',
  eventoId: 'event-a',
  trailerId: 'trailer-a',
  clienteId: 'customer-b',
  comandaId: 'command-b',
  portalGeneration: 1,
};

const staffContext: TelemetryContext = {
  requestId: 'request-audit-test',
  correlationId: '123e4567-e89b-42d3-a456-426614174010',
  cervejariaId: 'tenant-staff',
  slug: 'tenant-staff',
  env: 'dev',
  actor: { type: 'usuario', id: 'staff-a', role: 'CAIXA' },
};

function customerContext(session: ClienteSessionPayload | PdvClienteSessionPayload): TelemetryContext {
  return {
    requestId: 'request-audit-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174010',
    cervejariaId: session.cervejariaId,
    slug: session.cervejariaId,
    env: 'dev',
    actor: session.type === 'cliente-pdv'
      ? { type: 'cliente-pdv', id: session.clienteId, clienteId: session.clienteId }
      : { type: 'cliente', id: session.clienteId, clienteId: session.clienteId },
  };
}

async function makeApp(options: { pdvValid?: boolean; legacyValid?: boolean } = {}) {
  const emitted: Array<{ action: string; context: TelemetryContext | undefined; input: AuditEventInput }> = [];
  const app = Fastify();
  await app.register(cookie);
  await app.register(auditRoutes, {
    dependencies: {
      verifyStaff: async (_app: FastifyInstance, request: FastifyRequest) => {
        if (request.cookies?.token !== 'staff') throw new Error('no staff');
      },
      verifyLegacyCliente: async (_app: FastifyInstance, request: FastifyRequest) => {
        if (options.legacyValid && request.cookies?.cliente_token === 'legacy') return legacySession;
        throw new Error('no legacy customer');
      },
      verifyPdvCliente: async (_app: FastifyInstance, request: FastifyRequest) => {
        if (options.pdvValid && request.cookies?.cliente_pdv_token === 'pdv') return pdvSession;
        throw new Error('no PDV customer');
      },
      resolveClienteContext: async (_request: FastifyRequest, session: ClienteSessionPayload | PdvClienteSessionPayload) => customerContext(session),
      getStaffContext: () => staffContext,
      emit: (event: AuditEventInput) => emitted.push({ action: event.action, context: getTelemetryContext(), input: event }),
    },
  });
  return { app, emitted };
}

test('recognizes customer portal pages and API routes without treating staff routes as public', () => {
  assert.equal(publicPortalKind('/c/brewery/p/pos-1'), 'pdv');
  assert.equal(publicPortalKind('/api/public/cervejarias/brewery/pontos-venda/pos-1/comanda'), 'pdv');
  assert.equal(publicPortalKind('/c/brewery/t/trailer-1'), 'legacy');
  assert.equal(publicPortalKind('/api/public/cervejarias/brewery/trailers'), 'legacy');
  assert.equal(publicPortalKind('/operacao/caixa'), undefined);
});

test('public PDV events use the signed customer even when a staff cookie also exists', async () => {
  const { app, emitted } = await makeApp({ pdvValid: true });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'token=staff; cliente_pdv_token=pdv' },
      payload: { events: [{ type: 'click', page: '/c/brewery/p/pos-1', label: 'portal-test' }] },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.context?.cervejariaId, pdvSession.cervejariaId);
    assert.deepEqual(emitted[0]?.context?.actor, { type: 'cliente-pdv', id: pdvSession.clienteId, clienteId: pdvSession.clienteId });
  } finally {
    await app.close();
  }
});

test('mixed public and staff events retain separate request contexts', async () => {
  const { app, emitted } = await makeApp({ pdvValid: true });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'token=staff; cliente_pdv_token=pdv' },
      payload: {
        events: [
          { type: 'click', page: '/c/brewery/p/pos-1', label: 'portal-test' },
          { type: 'click', page: '/operacao/caixa', label: 'staff-test' },
        ],
      },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(emitted.length, 2);
    assert.equal(emitted[0]?.context?.cervejariaId, pdvSession.cervejariaId);
    assert.equal(emitted[0]?.context?.actor.type, 'cliente-pdv');
    assert.equal(emitted[1]?.context?.cervejariaId, staffContext.cervejariaId);
    assert.equal(emitted[1]?.context?.actor.id, 'staff-a');
  } finally {
    await app.close();
  }
});

test('public events are rejected instead of being attributed to a valid staff cookie when customer session is invalid', async () => {
  const { app, emitted } = await makeApp({ pdvValid: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'token=staff; cliente_pdv_token=invalid' },
      payload: { events: [{ type: 'page_view', page: '/c/brewery/p/pos-1' }] },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(emitted.length, 0);
  } finally {
    await app.close();
  }
});

test('a customer session alone cannot submit mixed customer and staff-page events', async () => {
  const { app, emitted } = await makeApp({ pdvValid: true });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'cliente_pdv_token=pdv' },
      payload: {
        events: [
          { type: 'click', page: '/c/brewery/p/pos-1', label: 'portal-test' },
          { type: 'click', page: '/operacao/caixa', label: 'operacao-caixa-abrir' },
        ],
      },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(emitted.length, 0);
  } finally {
    await app.close();
  }
});

test('legacy and PDV sessions remain independently attributable within the same batch', async () => {
  const { app, emitted } = await makeApp({ pdvValid: true, legacyValid: true });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'cliente_pdv_token=pdv; cliente_token=legacy' },
      payload: {
        events: [
          { type: 'click', page: '/c/brewery/p/pos-1', label: 'pdv-test' },
          { type: 'click', page: '/c/brewery/t/trailer-1', label: 'legacy-test' },
        ],
      },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(emitted[0]?.context?.actor.type, 'cliente-pdv');
    assert.equal(emitted[1]?.context?.actor.type, 'cliente');
    assert.equal(emitted[0]?.context?.cervejariaId, pdvSession.cervejariaId);
    assert.equal(emitted[1]?.context?.cervejariaId, legacySession.cervejariaId);
  } finally {
    await app.close();
  }
});

test('query strings and free-form metadata do not enter audit events; labels are sanitized instead of allowlisted', async () => {
  const { app, emitted } = await makeApp({ pdvValid: true });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'cliente_pdv_token=pdv' },
      payload: {
        events: [{
          type: 'click',
          page: '/c/brewery/p/pos-1?email=alice%40example.com&token=secret-value',
          label: 'alice@example.com',
          element: '5511999999999',
          meta: {
            tag: 'button',
            source: 'https://example.test/error.js?email=alice@example.com',
            line: 12,
            kind: 'unhandledrejection',
            secret: 'do-not-store',
          },
        }],
      },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(emitted.length, 1);
    const serialized = JSON.stringify(emitted[0]?.input);
    assert.equal(serialized?.includes('secret-value'), false);
    assert.equal(serialized?.includes('5511999999999'), false);
    assert.equal(serialized?.includes('do-not-store'), false);
    assert.equal(emitted[0]?.input.ui?.page, '/c/brewery/p/pos-1');
    // TAP-160: the visible label is kept (full-data decision); only card-like digits and tokens are redacted.
    assert.equal(emitted[0]?.input.ui?.label, 'alice@example.com');
    assert.equal(emitted[0]?.input.ui?.element, '[REDACTED]');
  } finally {
    await app.close();
  }
});

const sessionId = 'abcdef0123456789abcdef0123456789';

async function postStaffEvents(events: unknown[], headers: Record<string, string> = {}) {
  const { app, emitted } = await makeApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { cookie: 'token=staff', ...headers },
      payload: { events },
    });
    return { statusCode: response.statusCode, emitted };
  } finally {
    await app.close();
  }
}

test('busca registra termo, rota-modelo, sessão e user-agent da requisição', async () => {
  const { statusCode, emitted } = await postStaffEvents([{
    type: 'search',
    page: '/operacao/comandas/cm1234567890abcdefghijkl',
    route: '/operacao/comandas/:id',
    sessionId,
    search: '  chope\u0007  pilsen ',
  }], { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)\r\nX-Injected: 1' });
  assert.equal(statusCode, 204);
  const input = emitted[0]?.input;
  assert.equal(input?.action, 'ui.search');
  assert.equal(input?.ui?.searchTerm, 'chope pilsen');
  assert.equal(input?.ui?.route, '/operacao/comandas/:id');
  assert.equal(input?.ui?.page, '/operacao/comandas/cm1234567890abcdefghijkl');
  assert.equal(input?.client?.sessionId, sessionId);
  assert.equal(input?.client?.userAgent, 'Mozilla/5.0 (Linux; Android 14)  X-Injected: 1');
  assert.equal(input?.message, 'Buscou "chope pilsen" em /operacao/comandas/:id');
});

test('rótulos são saneados: controle, espaços, cartão e token longo', async () => {
  const { emitted } = await postStaffEvents([
    { type: 'click', page: '/operacao/caixa', label: ' Pagar\n\n  com   cartão 4111 1111 1111 1111 ' },
    { type: 'click', page: '/operacao/caixa', label: 'token a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8' },
    { type: 'click', page: '/operacao/caixa', label: 'operacao-caixa-encerrar-administrativamente' },
    { type: 'click', page: '/operacao/caixa', label: 'x'.repeat(300) },
  ]);
  assert.equal(emitted[0]?.input.ui?.label, 'Pagar com cartão [REDACTED]');
  assert.equal(emitted[1]?.input.ui?.label, 'token [REDACTED]');
  assert.equal(emitted[2]?.input.ui?.label, 'operacao-caixa-encerrar-administrativamente');
  assert.equal(emitted[3]?.input.ui?.label?.length, 120);
  assert.equal(emitted[0]?.input.message, 'Clicou em "Pagar com cartão [REDACTED]" na página /operacao/caixa');
});

test('web vital e erro de interface geram campos e mensagens legíveis', async () => {
  const stack = `TypeError: boom\n    at render (app.js:1:2)\n${'x'.repeat(3900)}`;
  const { statusCode, emitted } = await postStaffEvents([
    { type: 'web_vital', page: '/operacao/caixa', route: '/operacao/caixa', vitals: { name: 'LCP', value: 2300.4, rating: 'good' } },
    { type: 'web_vital', page: '/operacao/caixa', vitals: { name: 'CLS', value: 0.1234, rating: 'needs-improvement' } },
    { type: 'error', page: '/operacao/caixa', label: 'frontend_error', error: { message: 'boom', stack, name: 'TypeError' } },
    { type: 'page_view', page: '/operacao/caixa', viewport: { w: 1280, h: 720 }, meta: { sinceLastMs: 1500 } },
  ]);
  assert.equal(statusCode, 204);
  assert.deepEqual(emitted[0]?.input.vital, { name: 'LCP', value: 2300.4, rating: 'good' });
  assert.equal(emitted[0]?.input.message, 'LCP 2300 ms (good) em /operacao/caixa');
  assert.equal(emitted[1]?.input.message, 'CLS 0.123 (needs-improvement) em /operacao/caixa');
  assert.equal(emitted[2]?.input.outcome, 'failure');
  assert.equal(emitted[2]?.input.message, 'Erro na interface em /operacao/caixa: boom');
  assert.equal(emitted[2]?.input.error?.message, 'boom');
  assert.equal(emitted[2]?.input.error?.type, 'TypeError');
  assert.match(emitted[2]?.input.error?.stackTrace ?? '', /^TypeError: boom\n {4}at render/);
  assert.equal(emitted[3]?.input.ui?.viewport, '1280x720');
  assert.equal(emitted[3]?.input.metadata?.sinceLastMs, 1500);
});

test('ui.error semantico preserva handled/kind/feature/operation/scenario e correlationId', async () => {
  const correlationId = 'f4311c18-422d-4b47-bc63-be144dcf7167';
  const { statusCode, emitted } = await postStaffEvents([
    {
      type: 'error',
      page: '/operacao/comandas/cmw5mmn8b08cjl601ul30q44d',
      label: 'comanda.close',
      error: {
        message: 'Não foi possível falar com o servidor. Tente de novo.',
        name: 'Error',
      },
      meta: {
        handled: true,
        kind: 'network',
        feature: 'comanda.detail',
        operation: 'comanda.close',
        scenario: 'network_unreachable',
        httpStatus: 0,
        entityType: 'comanda',
        entityId: 'cmw5mmn8b08cjl601ul30q44d',
        correlationId,
        boundary: true,
        componentStack: 'in ComandaDetail',
      },
    },
  ]);
  assert.equal(statusCode, 204);
  const input = emitted[0]?.input;
  assert.equal(input?.action, 'ui.error');
  assert.equal(input?.correlationId, correlationId);
  assert.equal(input?.entityType, 'comanda');
  assert.equal(input?.entityId, 'cmw5mmn8b08cjl601ul30q44d');
  assert.equal(input?.metadata?.handled, true);
  assert.equal(input?.metadata?.kind, 'network');
  assert.equal(input?.metadata?.feature, 'comanda.detail');
  assert.equal(input?.metadata?.operation, 'comanda.close');
  assert.equal(input?.metadata?.scenario, 'network_unreachable');
  assert.equal(input?.metadata?.httpStatus, 0);
  assert.equal(input?.metadata?.boundary, true);
  assert.equal(input?.metadata?.componentStack, 'in ComandaDetail');
});

test('seleção em lista vira ação legível com a opção escolhida', async () => {
  const { emitted } = await postStaffEvents([
    { type: 'click', page: '/operacao/estoque', element: 'select', label: 'select:Categoria', meta: { option: 'Chopes' } },
  ]);
  assert.equal(emitted[0]?.input.message, 'Selecionou "Chopes" em "Categoria" na página /operacao/estoque');
  assert.equal(emitted[0]?.input.metadata?.option, 'Chopes');
});

test('sessão, web vital e erro malformados rejeitam o lote', async () => {
  for (const event of [
    { type: 'click', page: '/operacao/caixa', sessionId: 'curto' },
    { type: 'click', page: '/operacao/caixa', sessionId: 'a'.repeat(65) },
    { type: 'web_vital', page: '/operacao/caixa', vitals: { name: 'FID', value: 10 } },
    { type: 'web_vital', page: '/operacao/caixa', vitals: { name: 'LCP', value: -1 } },
    { type: 'error', page: '/operacao/caixa', error: { message: 'x'.repeat(501) } },
    { type: 'search', page: '/operacao/caixa', search: 'x'.repeat(201) },
    { type: 'page_view', page: '/operacao/caixa', viewport: { w: 1.5, h: 720 } },
  ]) {
    const { statusCode, emitted } = await postStaffEvents([event]);
    assert.equal(statusCode, 400, JSON.stringify(event));
    assert.equal(emitted.length, 0);
  }
});
