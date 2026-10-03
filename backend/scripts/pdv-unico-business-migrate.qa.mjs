import { pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

/** Validate the exact disposable-QA destination before loading/instantiating Prisma. */
export async function createPdvMigrationClient(env = process.env, loadClient = () => import('@prisma/client')) {
  const databaseUrl = validateIsolatedQaEnvironment(env).toString();
  const { PrismaClient } = await loadClient();
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export async function executePdvMigrationFromQaEnvironment({ env = process.env, companyId, runId, loadClient } = {}) {
  if (!companyId || !runId) throw new Error('companyId e runId são obrigatórios.');
  const db = await createPdvMigrationClient(env, loadClient);
  try {
    const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
    return await runPdvBusinessMigration({ db, companyId, runId });
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  // Environment validation occurs in createPdvMigrationClient before Prisma is imported.
  const companyId = process.argv[2];
  const runId = process.argv[3];
  if (!companyId || !runId) throw new Error('Uso: node --import tsx scripts/pdv-unico-business-migrate.qa.mjs <companyId> <runId>');
  const result = await executePdvMigrationFromQaEnvironment({ companyId, runId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'COMPLETED') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
