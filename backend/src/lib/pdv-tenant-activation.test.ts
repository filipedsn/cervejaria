import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerPdvTenantContext, tenantPdvActivation } from './pdv-tenant-activation.js';

const cia = 'cmr9yis3c0000hvu00q9fe7y1';
const other = 'cmsry9xrn0000hvlgopjxy0oo';
const url = 'postgresql://qa:fixture@127.0.0.1:55439/cervejaria_qa_pdv_unico';
const env = { NODE_ENV: 'development', PDV_ISOLATED_QA: '1', DATABASE_URL: url, QA_DATABASE_URL: url, PDV_CANONICAL_TENANTS: cia };

test('scoped activation rejects PROD and QA impersonation while keeping unselected tenants legacy', () => {
  assert.equal(tenantPdvActivation(cia, env), true);
  assert.equal(tenantPdvActivation(other, env), false);
  assert.equal(tenantPdvActivation('unlisted', env), false);
  assert.throws(() => tenantPdvActivation(cia, { ...env, NODE_ENV: 'production' }));
  assert.throws(() => tenantPdvActivation(cia, { ...env, DATABASE_URL: 'postgresql://qa:fixture@127.0.0.1:5434/cervejaria_dev' }));
  assert.throws(() => tenantPdvActivation(cia, { ...env, PDV_CANONICAL_TENANTS: 'unlisted' }));
});

test('DEV startup selector activates exactly both reviewed tenants and leaves every other tenant on legacy behavior', () => {
  const dev = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://dev:fixture@localhost:5434/cervejaria_dev',
    PDV_CANONICAL_TENANTS: `${cia},${other}`,
  };
  assert.equal(tenantPdvActivation(cia, dev), true);
  assert.equal(tenantPdvActivation(other, dev), true);
  assert.equal(tenantPdvActivation('tenant-not-selected', dev), false);
  assert.equal(tenantPdvActivation(cia, { ...dev, PDV_CANONICAL_TENANTS: other }), false);
});

test('overlapping requests retain independent tenant identity and explicit tenant resolution wins', async () => {
  const keys = Object.keys(env);
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const app = Fastify();
  registerPdvTenantContext(app);
  app.get('/:tenant', async request => {
    const tenant = (request.params as { tenant: string }).tenant;
    request.user = { sub: 'QA fixture', email: 'fixture@example.invalid', nome: 'QA', papel: 'DONO', cervejariaId: tenant, pwdAt: 0 };
    const before = tenantPdvActivation();
    await new Promise(resolve => setTimeout(resolve, tenant === cia ? 20 : 5));
    return { before, after: tenantPdvActivation(), other: tenantPdvActivation(other) };
  });
  try {
    const replies = await Promise.all([app.inject(`/${cia}`), app.inject('/unlisted')]);
    assert.deepEqual(replies[0].json(), { before: true, after: true, other: false });
    assert.deepEqual(replies[1].json(), { before: false, after: false, other: false });
  } finally {
    await app.close();
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/cervejaria',
  PDV_CANONICAL_TENANTS: `${cia},${other}`,
};

test('production per-tenant selector activates only selected tenants on the local production database', () => {
  assert.equal(tenantPdvActivation(cia, production), true);
  assert.equal(tenantPdvActivation(other, production), true);
  assert.equal(tenantPdvActivation('third-tenant', production), false);
  assert.equal(tenantPdvActivation(undefined, production), false);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(tenantPdvActivation(cia, { ...production, DATABASE_URL: `postgresql://fixture:fixture@${host}:5432/cervejaria` }), true);
  }
  assert.equal(tenantPdvActivation(cia, { ...production, DATABASE_URL: 'postgresql://fixture:fixture@localhost/cervejaria' }), true);
  assert.equal(tenantPdvActivation(cia, { ...production, PDV_CANONICAL_TENANTS: cia }), true);
  assert.equal(tenantPdvActivation(other, { ...production, PDV_CANONICAL_TENANTS: cia }), false);
});

test('global activation turns every tenant canonical, including requests without a tenant', () => {
  const global = { NODE_ENV: 'production', DATABASE_URL: production.DATABASE_URL, PDV_CANONICAL_ALL: '1' };
  assert.equal(tenantPdvActivation(cia, global), true);
  assert.equal(tenantPdvActivation('cmnewtenant0000provisioned', global), true);
  assert.equal(tenantPdvActivation(undefined, global), true);
  assert.equal(tenantPdvActivation(undefined, { ...global, PDV_CANONICAL_TENANTS: cia }), true);
  assert.equal(tenantPdvActivation(undefined, { ...global, PDV_CANONICAL_ALL: '0' }), undefined);
  assert.equal(tenantPdvActivation(cia, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://dev:fixture@localhost:5434/cervejaria_dev', PDV_CANONICAL_ALL: '1' }), true);
  assert.equal(tenantPdvActivation(undefined, { ...env, PDV_CANONICAL_TENANTS: undefined, PDV_CANONICAL_ALL: '1' }), true);
});

test('global activation keeps the destination guards', () => {
  const global = { NODE_ENV: 'production', DATABASE_URL: production.DATABASE_URL, PDV_CANONICAL_ALL: '1' };
  assert.throws(() => tenantPdvActivation(cia, { ...global, DATABASE_URL: 'postgresql://fixture:fixture@remote.invalid:5432/cervejaria' }));
  assert.throws(() => tenantPdvActivation(cia, { ...global, DATABASE_URL: 'not a url' }));
  assert.throws(() => tenantPdvActivation(cia, { ...global, PDV_ISOLATED_QA: '1' }));
  assert.throws(() => tenantPdvActivation(cia, { ...global, NODE_ENV: 'development' }));
  assert.throws(() => tenantPdvActivation(cia, { ...env, PDV_CANONICAL_ALL: '1', PROD_DATABASE_URL: production.DATABASE_URL }));
});

test('per-tenant selector no longer depends on a hardcoded tenant list', () => {
  const tenant = 'cmnewtenant0000provisioned';
  assert.equal(tenantPdvActivation(tenant, { ...production, PDV_CANONICAL_TENANTS: tenant }), true);
  assert.equal(tenantPdvActivation(cia, { ...production, PDV_CANONICAL_TENANTS: tenant }), false);
  assert.throws(() => tenantPdvActivation(cia, { ...production, PDV_CANONICAL_TENANTS: '' }));
});

test('production rejects QA identities, malformed selectors and unrelated database destinations', () => {
  const invalidDestinations = [
    'postgresql://fixture:fixture@remote.invalid:5432/cervejaria',
    'postgresql://fixture:fixture@localhost:5434/cervejaria_dev',
    'postgresql://fixture:fixture@localhost:55447/cervejaria_qa_pdv_unico',
    'postgresql://fixture:fixture@localhost:5432/other',
    'postgresql://fixture:fixture@localhost:5433/cervejaria',
    'https://localhost:5432/cervejaria',
  ];
  for (const destination of invalidDestinations) {
    assert.throws(() => tenantPdvActivation(cia, { ...production, DATABASE_URL: destination }));
  }
  assert.throws(() => tenantPdvActivation(cia, { ...production, PDV_ISOLATED_QA: '1' }));
  assert.throws(() => tenantPdvActivation(cia, { ...production, QA_DATABASE_URL: production.DATABASE_URL }));
  assert.throws(() => tenantPdvActivation(cia, { ...production, PDV_CANONICAL_TENANTS: 'third-tenant' }));
  assert.throws(() => tenantPdvActivation(cia, { ...production, PDV_CANONICAL_TENANTS: `${cia},${cia}` }));
  assert.throws(() => tenantPdvActivation(cia, { ...env, PROD_DATABASE_URL: production.DATABASE_URL }));
});

test('production request context responds successfully and keeps simultaneous tenants isolated', async () => {
  const keys = [...new Set([...Object.keys(production), 'PDV_ISOLATED_QA', 'QA_DATABASE_URL'])];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  delete process.env.PDV_ISOLATED_QA;
  delete process.env.QA_DATABASE_URL;
  Object.assign(process.env, production);
  const app = Fastify();
  registerPdvTenantContext(app);
  app.get('/:tenant', async request => {
    const tenant = (request.params as { tenant: string }).tenant;
    request.user = { sub: 'fixture', email: 'fixture@example.invalid', nome: 'Fixture', papel: 'DONO', cervejariaId: tenant, pwdAt: 0 };
    const before = tenantPdvActivation();
    await new Promise(resolve => setTimeout(resolve, tenant === cia ? 10 : 1));
    return { tenant, before, after: tenantPdvActivation() };
  });
  try {
    const replies = await Promise.all([app.inject(`/${cia}`), app.inject(`/${other}`), app.inject('/third-tenant')]);
    for (const reply of replies) assert.equal(reply.statusCode, 200, reply.body);
    assert.deepEqual(replies.map(reply => reply.json()), [
      { tenant: cia, before: true, after: true },
      { tenant: other, before: true, after: true },
      { tenant: 'third-tenant', before: false, after: false },
    ]);
  } finally {
    await app.close();
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
