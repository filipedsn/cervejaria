import { pathToFileURL } from 'node:url';

/**
 * Every active tenant must have exactly one active PDV with its
 * ConfiguracaoPontoVenda; otherwise the canonical runtime answers 409.
 */
export function evaluateCanonicalReadiness(tenants, env = process.env) {
  const blocked = [];
  for (const tenant of tenants) {
    const activePoints = tenant.pontosVenda.filter((point) => point.ativo);
    const reasons = [];
    if (activePoints.length === 0) reasons.push('sem PDV ativo');
    if (activePoints.length > 1) reasons.push(`${activePoints.length} PDVs ativos`);
    if (activePoints.length === 1 && !activePoints[0].configuracaoPdv) reasons.push('PDV sem configuração canônica');
    if (reasons.length) blocked.push({ id: tenant.id, slug: tenant.slug, nome: tenant.nome, reasons });
  }
  const activation = env.PDV_CANONICAL_ALL === '1' ? 'PDV_CANONICAL_ALL' : (env.PDV_CANONICAL_TENANTS ? 'PDV_CANONICAL_TENANTS' : 'NONE');
  return {
    status: blocked.length === 0 && activation === 'PDV_CANONICAL_ALL' ? 'READY' : 'BLOCKED',
    activation,
    activeTenants: tenants.length,
    blocked,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente.');
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, errorFormat: 'minimal' });
  try {
    const tenants = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.cervejaria.findMany({
        where: { ativo: true },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, slug: true, nome: true,
          pontosVenda: { select: { id: true, ativo: true, configuracaoPdv: { select: { id: true } } } },
        },
      });
    });
    const result = evaluateCanonicalReadiness(tenants);
    process.stdout.write(`${JSON.stringify({ ...result, writes: 0 })}\n`);
    process.exitCode = result.status === 'READY' ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', error: error instanceof Error ? error.message.split('\n')[0] : String(error) })}\n`);
    process.exitCode = 2;
  });
}
