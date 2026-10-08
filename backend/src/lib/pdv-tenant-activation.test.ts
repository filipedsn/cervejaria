import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerPdvTenantContext, tenantPdvActivation } from './pdv-tenant-activation.js';

const cia = 'cmr9yis3c0000hvu00q9fe7y1';
const other = 'cmsry9xrn0000hvlgopjxy0oo';
const url = 'postgresql://qa:fixture@127.0.0.1:55439/cervejaria_qa_pdv_unico';
const env = { NODE_ENV: 'development', PDV_ISOLATED_QA: '1', DATABASE_URL: url, QA_DATABASE_URL: url, PDV_CANONICAL_TENANTS: cia };

test('scoped activation rejects PROD and QA impersonation while keeping unlisted tenants legacy', () => {
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
