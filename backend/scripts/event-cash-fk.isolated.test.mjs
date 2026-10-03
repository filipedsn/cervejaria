import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { materializePinnedMigrationBundle, verifyPinnedManifest, writePinnedMigration } from './pdv-unico-qa-migration-manifest.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '20261003180000_restrict_event_cash_history';
const migrationTmp = await mkdtemp(path.join(os.tmpdir(), 'pdv-fk-baseline-'));
const env = { ...process.env };
delete env.QA_DATABASE_URL;
delete env.PDV_ISOLATED_QA;
const manifestPath = path.resolve(root, '../docs/testing/pdv-unico-qa-migration-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await verifyPinnedManifest(manifest);
const bundle = await materializePinnedMigrationBundle(manifest, migrationTmp, { exclude: [migrationName] });

function runPrisma(args, cwd = root) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Prisma falhou (${args.join(' ')}): ${result.stderr || result.stdout}`);
}

const generatedClientDir = path.join(root, 'node_modules', '.prisma', `pdv-fk-client-${process.env.PDV_QA_RUN_ID ?? process.pid}`);
await mkdir(generatedClientDir, { recursive: true });
const generateSchemaPath = path.join(migrationTmp, 'generate.prisma');
const oldSchema = await readFile(bundle.schemaPath, 'utf8');
await writeFile(generateSchemaPath, oldSchema.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${generatedClientDir.replaceAll('\\', '/')}"`));
let generatedClient;
try {
  runPrisma(['generate', '--schema', generateSchemaPath]);
  generatedClient = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
} catch (error) {
  await rm(migrationTmp, { recursive: true, force: true });
  await rm(generatedClientDir, { recursive: true, force: true });
  throw error;
}
const { PrismaClient } = generatedClient;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let companyId;
try {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  assert.equal(tables.length, 0, 'QA isolado precisa estar vazio antes da migration');

  runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath]);
  const beforeRestrict = await prisma.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(beforeRestrict[0].count, manifest.migrations.length - 1, 'pré-migration deve conter todas as versões menos a FK restritiva que será ensaiada em seguida');

  const company = await prisma.cervejaria.create({ data: { nome: 'QA FK migration fixture', slug: `qa-fk-${Date.now()}` } });
  companyId = company.id;
  const user = await prisma.usuario.create({ data: { nome: 'QA FK runner', email: `qa-fk-${Date.now()}@example.invalid`, senhaHash: 'test-only', papel: 'DONO', cervejariaId: company.id } });
  const trailer = await prisma.trailer.create({ data: { nome: 'QA FK trailer', cervejariaId: company.id } });
  const eventWithCash = await prisma.evento.create({ data: { nome: 'QA FK with cash', local: 'QA', data: new Date('2026-10-03T12:00:00Z'), trailerId: trailer.id, cervejariaId: company.id } });
  const cash = await prisma.sessaoCaixaEvento.create({ data: { eventoId: eventWithCash.id, abertoPorId: user.id } });
  const movement = await prisma.movimentoCaixaEvento.create({ data: { sessaoId: cash.id, tipo: 'SUPRIMENTO', valor: '12.34', registradoPorId: user.id } });
  const before = await prisma.movimentoCaixaEvento.findUniqueOrThrow({ where: { id: movement.id } });

  await writePinnedMigration(manifest, migrationName, path.join(bundle.migrationsDir, migrationName, 'migration.sql'));
  runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath]);

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
  assert.equal(migrationRecord.length, 1, 'Prisma deve registrar a migration concluida no QA isolado');
  await assert.rejects(() => prisma.evento.delete({ where: { id: eventWithCash.id } }));
  assert.equal(await prisma.evento.count({ where: { id: eventWithCash.id } }), 1);

  const trailerWithoutCash = await prisma.trailer.create({ data: { nome: 'QA FK trailer without cash', cervejariaId: company.id } });
  const eventWithoutCash = await prisma.evento.create({ data: { nome: 'QA FK without cash', local: 'QA', data: new Date('2026-10-04T12:00:00Z'), trailerId: trailerWithoutCash.id, cervejariaId: company.id } });
  await prisma.evento.delete({ where: { id: eventWithoutCash.id } });
  assert.equal(await prisma.evento.count({ where: { id: eventWithoutCash.id } }), 0);

  const migrationCount = await prisma.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(migrationCount[0].count, manifest.migrations.length, 'manifesto inteiro deve estar aplicado após adicionar a FK restritiva');
  console.log(`PASS migration FK: base=${manifest.baseCommit} count=${manifest.migrations.length} manifest=${manifest.manifestSha256}; sessao/movimento preservados; DELETE com caixa restrito; sem caixa permitido; confdeltype=r.`);
} finally {
  await prisma.$disconnect();
  await rm(migrationTmp, { recursive: true, force: true });
}
