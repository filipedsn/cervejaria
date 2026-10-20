import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTelemetryFromRequest } from './telemetry-context.js';

const tenantId = 'tenant-pdv-audit-test';
const customerId = 'customer-pdv-audit-test';
const pointOfSaleId = 'pdv-audit-test';
const commandId = 'command-pdv-audit-test';

test('atribui auditoria do cliente PDV pelo tenant assinado, sem confiar no slug da URL', async () => {
  const session = {
    type: 'cliente-pdv',
    cervejariaId: tenantId,
    pontoVendaId: pointOfSaleId,
    clienteId: customerId,
    comandaId: commandId,
  };
  const request = {
    id: 'request-pdv-audit-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174000',
    url: '/api/public/cervejarias/tenant-falso/pontos-venda/pdv-audit-test/comanda',
    cookies: { cliente_pdv_token: 'signed-session' },
    server: { jwt: { verify: async () => session } },
    jwtVerify: async () => { throw new Error('staff session absent'); },
  };

  const context = await resolveTelemetryFromRequest(request as never, {
    byId: async (id) => id === tenantId ? 'tenant-pdv-audit-test-real' : undefined,
    byPublicSlug: async () => undefined,
  });
  assert.equal(context.cervejariaId, tenantId);
  assert.equal(context.slug, 'tenant-pdv-audit-test-real');
  assert.deepEqual(context.actor, { type: 'cliente-pdv', id: customerId, clienteId: customerId });
});

test('slug público inexistente não escolhe tenant ou dataset pelo texto da URL', async () => {
  const request = {
    id: 'request-public-audit-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174001',
    url: '/api/public/cervejarias/tenant-inventado-audit-test/cardapio',
    cookies: {},
    server: { jwt: { verify: async () => { throw new Error('cookie absent'); } } },
    jwtVerify: async () => { throw new Error('staff session absent'); },
  };

  const context = await resolveTelemetryFromRequest(request as never, {
    byId: async () => undefined,
    byPublicSlug: async () => undefined,
  });
  assert.equal(context.cervejariaId, undefined);
  assert.equal(context.slug, 'unknown');
  assert.deepEqual(context.actor, { type: 'anonymous' });
});

test('public PDV API context prioritizes its signed customer over a coexisting staff cookie', async () => {
  const session = {
    type: 'cliente-pdv',
    cervejariaId: tenantId,
    pontoVendaId: pointOfSaleId,
    clienteId: customerId,
    comandaId: commandId,
  };
  const request = {
    id: 'request-public-pdv-coexist-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174002',
    url: '/api/public/cervejarias/tenant-falso/pontos-venda/pdv-falso/comanda',
    user: { sub: 'staff-user', papel: 'CAIXA', cervejariaId: 'staff-tenant' },
    cookies: { token: 'valid-staff-cookie', cliente_pdv_token: 'signed-customer-cookie' },
    server: { jwt: { verify: async (token: string) => token === 'signed-customer-cookie' ? session : undefined } },
    jwtVerify: async () => { throw new Error('should not choose staff context for public route'); },
  };

  const context = await resolveTelemetryFromRequest(request as never, {
    byId: async (id) => id === tenantId ? 'tenant-pdv-audit-test-real' : 'staff-tenant',
    byPublicSlug: async () => undefined,
  });
  assert.equal(context.cervejariaId, tenantId);
  assert.equal(context.slug, 'tenant-pdv-audit-test-real');
  assert.deepEqual(context.actor, { type: 'cliente-pdv', id: customerId, clienteId: customerId });
});

test('unauthenticated public API calls stay anonymous even when a staff cookie exists', async () => {
  const request = {
    id: 'request-public-anon-coexist-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174003',
    url: '/api/public/cervejarias/tenant-publico/cardapio',
    user: { sub: 'staff-user', papel: 'CAIXA', cervejariaId: 'staff-tenant' },
    cookies: { token: 'valid-staff-cookie' },
    server: { jwt: { verify: async () => { throw new Error('no customer cookie'); } } },
    jwtVerify: async () => { throw new Error('public endpoint must not adopt staff'); },
  };

  const context = await resolveTelemetryFromRequest(request as never, {
    byId: async () => 'staff-tenant',
    byPublicSlug: async (slug) => slug === 'tenant-publico' ? { id: tenantId, slug } : undefined,
  });
  assert.equal(context.cervejariaId, tenantId);
  assert.equal(context.slug, 'tenant-publico');
  assert.deepEqual(context.actor, { type: 'anonymous' });
});
