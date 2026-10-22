import assert from 'node:assert/strict';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
validateIsolatedQaEnvironment(process.env);
assert.equal(process.env.DATABASE_URL, process.env.QA_DATABASE_URL);
assert.equal(process.env.NODE_ENV, 'test');
const { buildApp, setupSocketIO } = await import('../src/app.ts');
const { prisma } = await import('../src/lib/prisma.ts');
const app = await buildApp();
setupSocketIO(app, app.server);
try {
  process.env.QA_API_BASE = await app.listen({ host: '127.0.0.1', port: 0 });
  const { seedTenants } = await import('../qa/lib/seed.ts');
  const tenants = await seedTenants(2, 2, 1);
  const { runRealtimeTests } = await import('../qa/lib/realtime-tests.ts');
  const required = new Set(['RT-03', 'RT-13', 'RT-14', 'RT-15', 'RT-16', 'RT-17', 'RT-18', 'RT-19', 'RT-20', 'RT-21', 'RT-22']);
  const results = [];
  await runRealtimeTests({ tenants }, async (meta, run) => {
    if (!required.has(meta.id)) return;
    try {
      const result = await run();
      results.push({ id: meta.id, status: result.status ?? 'passed', message: result.message });
    } catch (error) { results.push({ id: meta.id, status: 'failed', message: error.message }); }
  });
  console.log(JSON.stringify({ gate: 'realtime-security-qa', results }));
  assert.deepEqual(new Set(results.map(r => r.id)), required, 'all former Actions security scenarios executed');
  assert.ok(results.every(r => r.status === 'passed'), 'no skipped or failed realtime acceptance scenario');
} finally { await app.close(); await prisma.$disconnect(); }
