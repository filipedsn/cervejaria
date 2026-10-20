import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { verifyPdvClienteSession } from './pdv-client-session.js';
import type { PdvClienteSessionPayload } from '../types/cliente-session.js';

const validSession: PdvClienteSessionPayload = {
  type: 'cliente-pdv',
  cervejariaId: 'tenant-a',
  pontoVendaId: 'pdv-a',
  clienteId: 'customer-a',
  comandaId: 'command-a',
};

function fixture(session: unknown = validSession) {
  const calls: Prisma.ComandaWhereInput[] = [];
  const app = {
    jwt: { verify: async () => session },
    httpErrors: { unauthorized: (message: string) => Object.assign(new Error(message), { statusCode: 401 }) },
  } as unknown as FastifyInstance;
  const request = { cookies: { cliente_pdv_token: 'signed-session' } } as unknown as FastifyRequest;
  const dependencies = {
    findOpenComanda: async (where: Prisma.ComandaWhereInput) => {
      calls.push(where);
      return { id: 'command-a' };
    },
  };
  return { app, request, dependencies, calls };
}

test('a valid signed PDV session queries an open comanda constrained to tenant, PDV and customer', async () => {
  const { app, request, dependencies, calls } = fixture();
  assert.deepEqual(await verifyPdvClienteSession(app, request, dependencies), validSession);
  assert.deepEqual(calls, [{
    id: validSession.comandaId,
    origem: 'CAIXA',
    pontoVenda: { cervejariaId: validSession.cervejariaId },
    pontoVendaId: validSession.pontoVendaId,
    clienteId: validSession.clienteId,
    status: 'ABERTA',
  }]);
});

test('invalid tokens are rejected before querying comanda state', async () => {
  const { app, request, dependencies, calls } = fixture();
  app.jwt.verify = async () => { throw new Error('invalid token'); };
  await assert.rejects(verifyPdvClienteSession(app, request, dependencies), { statusCode: 401 });
  assert.equal(calls.length, 0);
});

test('closed or mismatched comanda, tenant, PDV or customer is rejected', async () => {
  const mismatches: PdvClienteSessionPayload[] = [
    { ...validSession, comandaId: 'other-command' },
    { ...validSession, cervejariaId: 'other-tenant' },
    { ...validSession, pontoVendaId: 'other-pdv' },
    { ...validSession, clienteId: 'other-customer' },
  ];

  for (const session of mismatches) {
    const { app, request, dependencies } = fixture(session);
    await assert.rejects(verifyPdvClienteSession(app, request, {
      findOpenComanda: async () => null,
    }), { statusCode: 401 });
  }

  const closed = fixture();
  await assert.rejects(verifyPdvClienteSession(closed.app, closed.request, {
    findOpenComanda: async () => null,
  }), { statusCode: 401 });
});

test('missing or malformed session payload does not reach the comanda lookup', async () => {
  for (const payload of [null, {}, { ...validSession, type: 'staff' }]) {
    const { app, request, dependencies, calls } = fixture(payload);
    await assert.rejects(verifyPdvClienteSession(app, request, dependencies), { statusCode: 401 });
    assert.equal(calls.length, 0);
  }
});
