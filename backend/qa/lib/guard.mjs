/**
 * Aborta se o ambiente parecer producao ou banco errado.
 * Usado por scripts QA (.mjs) e importado por guard.ts.
 */
export function assertQaEnvironment(opts = {}) {
  const apiBase = opts.apiBase ?? process.env.QA_API_BASE ?? 'http://localhost:3002';
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? '';

  const blockedApiPatterns = [':3001', 'tap.quivercloud.com.br'];
  for (const pattern of blockedApiPatterns) {
    if (apiBase.includes(pattern)) {
      console.error(`[guard] ABORTADO: API aponta para producao (${pattern}) em ${apiBase}`);
      process.exit(1);
    }
  }

  if (!databaseUrl) {
    console.error('[guard] ABORTADO: DATABASE_URL nao definido — use run-with-env.mjs development');
    process.exit(1);
  }

  const dbLower = databaseUrl.toLowerCase();
  const looksProdDb =
    (dbLower.includes('/cervejaria') && !dbLower.includes('cervejaria_dev')) ||
    dbLower.includes('cervejaria_prod') ||
    (dbLower.includes('@') && dbLower.includes(':5432/cervejaria?'));

  if (looksProdDb || !dbLower.includes('cervejaria_dev')) {
    console.error('[guard] ABORTADO: DATABASE_URL deve apontar para cervejaria_dev');
    console.error(`[guard] Valor: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
    process.exit(1);
  }

  if (!dbLower.includes(':5434')) {
    console.error('[guard] ABORTADO: DATABASE_URL deve usar porta 5434 (container dev isolado)');
    console.error(`[guard] Valor: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
    process.exit(1);
  }
}
