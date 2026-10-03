import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaDir = path.join(root, 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');
const migrationName = '20261003180000_restrict_event_cash_history';
const migrationTmp = await mkdtemp(path.join(os.tmpdir(), 'pdv-fk-baseline-'));
const baselineDir = path.join(migrationTmp, 'prisma');
const env = { ...process.env };
delete env.QA_DATABASE_URL;
delete env.PDV_ISOLATED_QA;

function runPrisma(args, cwd = root) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Prisma falhou (${args.join(' ')}): ${result.stderr || result.stdout}`);
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let companyId;
try {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  assert.equal(tables.length, 0, 'QA isolado precisa estar vazio antes da migration');

  await cp(prismaDir, baselineDir, { recursive: true });
  const dirs = await readdir(path.join(baselineDir, 'migrations'), { withFileTypes: true });
  for (const dir of dirs) {
    const candidate = path.join(baselineDir, 'migrations', dir.name);
    if (!dir.isDirectory()) continue;
    if (dir.name === migrationName) {
      await rm(candidate, { recursive: true, force: true });
    } else if (!(await readdir(candidate)).includes('migration.sql')) {
      if (dir.name !== '20261002130000_comanda_category_order') {
        throw new Error(`Migration baseline inválida: ${dir.name} não contém migration.sql`);
      }
      console.log(`GATE PENDENTE: baseline não pode validar ${dir.name}, diretório local sem migration.sql.`);
      await rm(candidate, { recursive: true, force: true });
    }
  }
  await writeFile(path.join(baselineDir, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  runPrisma(['migrate', 'deploy', '--schema', path.join(baselineDir, 'schema.prisma')]);

  const company = await prisma.cervejaria.create({ data: { nome: 'QA FK migration fixture', slug: `qa-fk-${Date.now()}` } });
  companyId = company.id;
  const user = await prisma.usuario.create({ data: { nome: 'QA FK runner', email: `qa-fk-${Date.now()}@example.invalid`, senhaHash: 'test-only', papel: 'DONO', cervejariaId: company.id } });
  const trailer = await prisma.trailer.create({ data: { nome: 'QA FK trailer', cervejariaId: company.id } });
  const eventWithCash = await prisma.evento.create({ data: { nome: 'QA FK with cash', local: 'QA', data: new Date('2026-10-03T12:00:00Z'), trailerId: trailer.id, cervejariaId: company.id } });
  const cash = await prisma.sessaoCaixaEvento.create({ data: { eventoId: eventWithCash.id, abertoPorId: user.id } });
  const movement = await prisma.movimentoCaixaEvento.create({ data: { sessaoId: cash.id, tipo: 'SUPRIMENTO', valor: '12.34', registradoPorId: user.id } });
  const before = await prisma.movimentoCaixaEvento.findUniqueOrThrow({ where: { id: movement.id } });

  await cp(path.join(migrationsDir, migrationName), path.join(baselineDir, 'migrations', migrationName), { recursive: true });
  runPrisma(['migrate', 'deploy', '--schema', path.join(baselineDir, 'schema.prisma')]);

  const afterSession = await prisma.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: cash.id } });
  const afterMovement = await prisma.movimentoCaixaEvento.findUniqueOrThrow({ where: { id: movement.id } });
  assert.equal(afterSession.id, cash.id);
  assert.equal(afterSession.eventoId, eventWithCash.id);
  assert.equal(afterMovement.id, before.id);
  assert.equal(afterMovement.sessaoId, before.sessaoId);
  assert.equal(afterMovement.tipo, before.tipo);
  assert.equal(afterMovement.valor.toFixed(2), before.valor.toFixed(2));

  const fk = await prisma.$queryRaw`SELECT confdeltype FROM pg_constraint WHERE conname='SessaoCaixaEvento_eventoId_fkey'`;
  assert.equal(fk.length, 1);
  assert.equal(fk[0].confdeltype, 'r', 'FK deve estar ativa com ON DELETE RESTRICT');
  const migrationRecord = await prisma.$queryRaw`SELECT finished_at FROM _prisma_migrations WHERE migration_name=${migrationName} AND finished_at IS NOT NULL`;
  assert.equal(migrationRecord.length, 1, 'Prisma deve registrar a migration concluída no QA isolado');
  await assert.rejects(() => prisma.evento.delete({ where: { id: eventWithCash.id } }));
  assert.equal(await prisma.evento.count({ where: { id: eventWithCash.id } }), 1);

  const trailerWithoutCash = await prisma.trailer.create({ data: { nome: 'QA FK trailer without cash', cervejariaId: company.id } });
  const eventWithoutCash = await prisma.evento.create({ data: { nome: 'QA FK without cash', local: 'QA', data: new Date('2026-10-04T12:00:00Z'), trailerId: trailerWithoutCash.id, cervejariaId: company.id } });
  await prisma.evento.delete({ where: { id: eventWithoutCash.id } });
  assert.equal(await prisma.evento.count({ where: { id: eventWithoutCash.id } }), 0);

  console.log('PASS migration FK: Prisma aplicou e registrou; sessão/movimento preservados; DELETE com caixa restrito; sem caixa permitido; confdeltype=r.');
} finally {
  await prisma.$disconnect();
  await rm(migrationTmp, { recursive: true, force: true });
}
