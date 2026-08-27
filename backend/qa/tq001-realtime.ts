import { prisma } from '../src/lib/prisma.js';
import { runRealtimeTests } from './lib/realtime-tests.js';
import { CONTEXT_PATH, readJson } from './lib/store.js';
import type { QaContext } from './lib/types.js';

const TQ001_IDS = new Set([
  'RT-03',
  'RT-04',
  'RT-05',
  'RT-06',
  'RT-07',
  'RT-08',
  'RT-09',
  'RT-10',
  'RT-12',
  'RT-13',
  'RT-14',
  'RT-15',
  'RT-16',
]);
let failures = 0;

async function main() {
  const ctx = readJson<QaContext>(CONTEXT_PATH);

  await runRealtimeTests(ctx, async (meta, run) => {
    if (!TQ001_IDS.has(meta.id)) return;

    const startedAt = performance.now();
    try {
      const outcome = await run();
      const status = outcome.status ?? 'passed';
      if (status === 'failed') failures += 1;
      console.log(`${status === 'failed' ? 'XX' : 'OK'} ${meta.id} ${meta.name} (${(performance.now() - startedAt).toFixed(0)}ms)`);
      if (outcome.message) console.log(`   ${outcome.message}`);
    } catch (error) {
      failures += 1;
      console.error(`XX ${meta.id} ${meta.name}:`, error);
    }
  });
}

main()
  .catch((error) => {
    failures += 1;
    console.error('[TQ-001] Falha no runner:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode = failures > 0 ? 1 : 0;
  });
