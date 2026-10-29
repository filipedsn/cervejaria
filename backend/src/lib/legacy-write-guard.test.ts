import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { CanonicalPdvConfigurationError } from './canonical-pdv-operational-config.js';
import { LEGACY_WRITE_BLOCKED_CODE, assertLegacyWriteAllowed, registerLegacyWriteGuard } from './legacy-write-guard.js';
import { registerPdvTenantContext } from './pdv-tenant-activation.js';

const qaUrl = 'postgresql://qa:fixture@127.0.0.1:55439/cervejaria_qa_pdv_unico';
const canonical = { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', DATABASE_URL: qaUrl, QA_DATABASE_URL: qaUrl, PDV_CANONICAL_ALL: '1' };
const legacy = { NODE_ENV: 'test' };

test('canonical model blocks every legacy write method and keeps reads', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(
      () => assertLegacyWriteAllowed(method, 'tenant', canonical),
      (error) => error instanceof CanonicalPdvConfigurationError && error.statusCode === 409 && error.code === LEGACY_WRITE_BLOCKED_CODE,
    );
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.doesNotThrow(() => assertLegacyWriteAllowed(method, 'tenant', canonical));
});

test('legacy tenants keep writing while the canonical model is off', () => {
  assert.doesNotThrow(() => assertLegacyWriteAllowed('PATCH', 'tenant', legacy));
});

test('route guard answers 409 before the handler runs and lets reads through', async () => {
  const keys = Object.keys(canonical);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, canonical);
  const app = Fastify();
  registerPdvTenantContext(app);
  let handled = 0;
  await app.register(async (scope) => {
    scope.addHook('preHandler', async (request) => {
      request.user = { sub: 'u', email: 'u@example.invalid', nome: 'U', papel: 'ATENDENTE', cervejariaId: 'tenant', pwdAt: 0 };
    });
    registerLegacyWriteGuard(scope);
    scope.get('/:id', async () => ({ ok: true }));
    scope.patch('/:id/fechar', async () => { handled += 1; return { ok: true }; });
  }, { prefix: '/api/eventos' });
  try {
    const write = await app.inject({ method: 'PATCH', url: '/api/eventos/e1/fechar' });
    assert.equal(write.statusCode, 409);
    assert.equal(write.json().code, LEGACY_WRITE_BLOCKED_CODE);
    assert.equal(handled, 0);
    const read = await app.inject({ method: 'GET', url: '/api/eventos/e1' });
    assert.equal(read.statusCode, 200);
  } finally {
    await app.close();
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

test('every legacy write route module registers the guard after authentication', async () => {
  for (const file of ['eventos', 'evento-caixa', 'comandas', 'pagamentos', 'vendas-avulsas', 'pedidos']) {
    const source = await readFile(new URL(`../routes/${file}.ts`, import.meta.url), 'utf8');
    const auth = source.search(/app\.addHook\('preHandler', app\.(authenticate|requireTenant)\);/);
    const guard = source.indexOf('registerLegacyWriteGuard(app);');
    assert.ok(auth >= 0 && guard > auth, `${file}.ts must register the legacy write guard after authentication`);
  }
  const publicRoutes = await readFile(new URL('../routes/public.ts', import.meta.url), 'utf8');
  // Portal de evento descontinuado (TAP-141): sessão do trailer responde 410 — não há mais write legado a guardar.
  assert.match(publicRoutes, /trailers\/:trailerId\/sessao[\s\S]{0,400}PORTAL_EVENTO_DESCONTINUADO/);
  assert.doesNotMatch(publicRoutes, /assertLegacyWriteAllowed\(request\.method, ctx\.cervejaria\.id\)/);
});
