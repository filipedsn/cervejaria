import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTelemetryFromClienteSession, resolveTelemetryFromRequest } from './telemetry-context.js';

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

test('funcionário leva nome, e-mail, IP do cliente e país vindos da Cloudflare via nginx', async () => {
  const request = {
    id: 'request-staff-network-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174004',
    url: '/api/comandas',
    headers: { 'x-real-ip': '172.70.10.20', 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'BR' },
    raw: { socket: { remoteAddress: '127.0.0.1' } },
    user: { sub: 'staff-user', papel: 'DONO', cervejariaId: 'staff-tenant', nome: 'Maria Souza', email: 'maria@example.test' },
    cookies: {},
    server: { jwt: { verify: async () => { throw new Error('no customer cookie'); } } },
    jwtVerify: async () => undefined,
  };

  const context = await resolveTelemetryFromRequest(request as never, {
    byId: async () => 'staff-tenant',
    byPublicSlug: async () => undefined,
  });
  assert.deepEqual(context.actor, {
    type: 'usuario', id: 'staff-user', role: 'DONO', name: 'Maria Souza', email: 'maria@example.test',
  });
  assert.equal(context.clientIp, '200.160.2.3');
  assert.equal(context.clientIpSource, 'cloudflare');
  assert.equal(context.clientCountryCode, 'BR');
});

test('cabeçalhos forjados sem nginx na frente não mudam o IP registrado', async () => {
  const request = {
    id: 'request-spoof-network-test',
    correlationId: '123e4567-e89b-42d3-a456-426614174005',
    url: '/api/comandas',
    headers: { 'x-real-ip': '172.70.10.20', 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'BR' },
    raw: { socket: { remoteAddress: '198.51.100.20' } },
    cookies: {},
    server: { jwt: { verify: async () => { throw new Error('no customer cookie'); } } },
    jwtVerify: async () => { throw new Error('staff session absent'); },
  };

  const context = await resolveTelemetryFromRequest(request as never, {
    byId: async () => undefined,
    byPublicSlug: async () => undefined,
  });
  assert.equal(context.clientIp, '198.51.100.20');
  assert.equal(context.clientIpSource, 'socket');
  assert.equal(context.clientCountryCode, undefined);
});

test('contexto do cliente do portal também registra o IP, sem nome do cliente', async () => {
  const session = {
    type: 'cliente-pdv' as const,
    cervejariaId: tenantId,
    pontoVendaId: pointOfSaleId,
    clienteId: customerId,
    comandaId: commandId,
  };
  const request = {
    id: 'request-customer-network-test',
    headers: { 'x-real-ip': '203.0.113.7' },
    raw: { socket: { remoteAddress: '::1' } },
  };

  const context = await resolveTelemetryFromClienteSession(request as never, session, {
    byId: async () => 'tenant-real',
    byPublicSlug: async () => undefined,
  });
  assert.equal(context.clientIp, '203.0.113.7');
  assert.equal(context.clientIpSource, 'nginx');
  assert.deepEqual(context.actor, { type: 'cliente-pdv', id: customerId, clienteId: customerId });
});
