import { prisma } from '../src/lib/prisma.js';
import { cleanupQa } from './lib/seed.js';

async function main() {
  console.log('[teardown] Removendo cervejarias QA (tenants + arena)...');
  await cleanupQa();
  const remaining = await prisma.cervejaria.count({
    where: { OR: [{ slug: { startsWith: 'qa-load-' } }, { slug: 'qa-arena' }] },
  });
  console.log(remaining === 0 ? '[teardown] OK — dados QA removidos.' : `[teardown] Atenção: ${remaining} restantes.`);
  await prisma.$disconnect();
  process.exit(remaining === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('[teardown] FALHOU:', err);
  await prisma.$disconnect();
  process.exit(1);
});
