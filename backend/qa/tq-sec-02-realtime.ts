import { prisma } from '../src/lib/prisma.js';
import { runRealtimeTests } from './lib/realtime-tests.js';
import { CONTEXT_PATH, readJson } from './lib/store.js';
import type { QaContext } from './lib/types.js';

const TQ_SEC_02_IDS = new Set([
  'RT-03', // staff conecta e recebe evento operacional
  'RT-13',
  'RT-14',
  'RT-15',
  'RT-16',
  'RT-17',
  'RT-18',
  'RT-19',
  'RT-20',
  'RT-21',
  'RT-22',
]);
let failures = 0;

async function main() {
  const ctx = readJson<QaContext>(CONTEXT_PATH);

  await runRealtimeTests(ctx, async (meta, run) => {
    if (!TQ_SEC_02_IDS.has(meta.id)) return;

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
    console.error('[TQ-SEC-02] Falha no runner:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode = failures > 0 ? 1 : 0;
  });
