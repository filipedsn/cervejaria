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

test('query strings, unrecognized labels, and free-form metadata do not enter audit events', async () => {
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
    assert.equal(serialized?.includes('alice@example.com'), false);
    assert.equal(serialized?.includes('secret-value'), false);
    assert.equal(serialized?.includes('5511999999999'), false);
    assert.equal(serialized?.includes('do-not-store'), false);
    assert.equal(emitted[0]?.input.ui?.page, '/c/brewery/p/pos-1');
    assert.equal(emitted[0]?.input.ui?.label, 'unclassified-action');
  } finally {
    await app.close();
  }
});
