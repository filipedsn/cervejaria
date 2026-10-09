import assert from 'node:assert/strict';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

// No .env loading, migrations, catalog changes or real permission changes.
const target = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, target);
assert.ok(process.env.PDV_QA_CONTAINER?.startsWith('codex-pdv-settings-qa-'));
const canonical = 'cmr9yis3c0000hvu00q9fe7y1';
const legacy = 'legacy-settings-qa';
const otherLegacy = 'legacy-other-settings-qa';
process.env.PDV_CANONICAL_TENANTS = canonical;
delete process.env.PDV_CANONICAL_CONFIG_QA;
const { default: Fastify } = await import('fastify');
const { default: sensible } = await import('@fastify/sensible');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: target } } });
const { trailersRoutes } = await import('../src/routes/trailers.ts');
const { registerPdvTenantContext } = await import('../src/lib/pdv-tenant-activation.ts');
const app = Fastify();
await app.register(sensible);
registerPdvTenantContext(app);
// Trusted identities are supplied only inside Fastify.inject in this QA app.
// Exercise the same role decision, without touching persisted permissions.
app.decorate('authenticate', async request => {
  request.user = { sub: 'qa-owner', cervejariaId: request.headers['qa-tenant'] ?? null, papel: request.headers['qa-role'] ?? 'DONO' };
});
app.decorate('requireDono', async request => {
  if (request.user.papel !== 'DONO') throw app.httpErrors.forbidden('Acesso restrito ao proprietário');
});
await app.register(trailersRoutes, { prefix: '/api/trailers' });
await app.ready();
let checks = 0;
const snapshot = () => prisma.trailer.findMany({ orderBy: { id: 'asc' } });
const call = (tenant, method, url, payload, role = 'DONO') => app.inject({ method, url: `/api/trailers${url}`, headers: { ...(tenant ? { 'qa-tenant': tenant } : {}), 'qa-role': role }, ...(payload === undefined ? {} : { payload }) });
try {
  // Minimal disposable SQL fixture uses only the real columns queried by these
  // routes. It deliberately has no PDV/config tables: activation must block
  // mutation even if canonical context is missing or ambiguous.
  await prisma.$executeRawUnsafe('CREATE TABLE "Trailer" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "identificador" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true, "cervejariaId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)');
  await prisma.$executeRawUnsafe(`CREATE TYPE "EventStatus" AS ENUM ('ABERTO', 'FECHADO')`);
  await prisma.$executeRawUnsafe('CREATE TABLE "Evento" ("id" TEXT PRIMARY KEY, "trailerId" TEXT, "status" "EventStatus", "data" DATE)');
  for (const [id, tenant] of [['canonical-trailer', canonical], ['legacy-trailer', legacy], ['legacy-spare', legacy], ['other-trailer', otherLegacy]]) {
    await prisma.trailer.create({ data: { id, cervejariaId: tenant, nome: id } });
  }
  const before = await snapshot();
  // Sequence increments survive rollback: also detect attempted writes.
  await prisma.$executeRawUnsafe('CREATE SEQUENCE trailer_qa_writes');
  await prisma.$executeRawUnsafe(`CREATE FUNCTION trailer_qa_track_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('trailer_qa_writes'); RETURN COALESCE(NEW, OLD); END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER trailer_qa_write BEFORE INSERT OR UPDATE OR DELETE ON "Trailer" FOR EACH ROW EXECUTE FUNCTION trailer_qa_track_write()');
  const writeState = () => prisma.$queryRawUnsafe('SELECT last_value::text, is_called FROM trailer_qa_writes');
  const beforeWrites = await writeState();
  for (const [method, url, payload] of [
    ['POST', '/', { nome: 'Blocked creation', cervejariaId: legacy }],
    ['PUT', '/canonical-trailer', { nome: 'Blocked edit' }],
    ['PATCH', '/canonical-trailer/ativo', { ativo: false }],
    ['DELETE', '/canonical-trailer'],
    ['PUT', '/other-trailer', { nome: 'Cross tenant' }],
    ['POST', '/', {}],
  ]) {
    const response = await call(canonical, method, url, payload);
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'CANONICAL_PDV_TRAILER_MUTATION_BLOCKED');
    assert.deepEqual(await snapshot(), before, 'all Trailer rows and timestamps unchanged');
    assert.deepEqual(await writeState(), beforeWrites, 'no attempted Trailer writes, even rolled back');
    checks++;
  }
  for (const tenant of [canonical, legacy]) {
    for (const [method, url, payload] of [['POST', '/', { nome: 'Denied' }], ['PUT', '/legacy-trailer', { nome: 'Denied' }], ['PATCH', '/legacy-trailer/ativo', { ativo: false }], ['DELETE', '/legacy-trailer']]) {
      assert.equal((await call(tenant, method, url, payload, 'ATENDENTE')).statusCode, 403);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await writeState(), beforeWrites);
      checks++;
    }
  }
  assert.equal((await call(null, 'POST', '/', { nome: 'No tenant' })).statusCode, 403);
  checks++;
  for (const tenant of [canonical, legacy, otherLegacy]) {
    const response = await call(tenant, 'GET', '/');
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().every(row => row.cervejariaId === tenant));
    checks++;
  }
  for (const [method, url, payload] of [['PUT', '/canonical-trailer', { nome: 'Cross edit' }], ['PATCH', '/other-trailer/ativo', { ativo: false }], ['DELETE', '/canonical-trailer']]) {
    assert.equal((await call(legacy, method, url, payload)).statusCode, 404);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await writeState(), beforeWrites);
    checks++;
  }
  const created = await call(legacy, 'POST', '/', { nome: 'LEGACY creation', cervejariaId: canonical });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().cervejariaId, legacy);
  const id = created.json().id;
  assert.equal((await call(legacy, 'PUT', `/${id}`, { nome: 'LEGACY edited' })).json().nome, 'LEGACY edited');
  assert.equal((await call(legacy, 'PATCH', `/${id}/ativo`, { ativo: false })).json().ativo, false);
  assert.equal((await call(legacy, 'PATCH', `/${id}/ativo`, { ativo: true })).json().ativo, true);
  assert.equal((await call(legacy, 'DELETE', `/${id}`)).statusCode, 204);
  assert.deepEqual(await snapshot(), before, 'LEGACY roundtrip preserves canonical and foreign tenant');
  checks += 5;
  console.log(JSON.stringify({ result: 'PASS', checks, canonicalMutation: '409 before writes, including missing PDV tables', legacyCrud: 'preserved', tenantIsolation: 'preserved', roleGate: 'DONO only', fixture: 'minimal disposable PostgreSQL; no migrations/cutover' }));
} finally {
  await app.close();
  await prisma.$disconnect();
}
