import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const runId = randomBytes(8).toString('hex');
const container = `codex-pdv-gamified-category-qa-${runId}`;
const portServer = net.createServer();
const port = await new Promise((resolve, reject) => {
  portServer.once('error', reject);
  portServer.listen(0, '127.0.0.1', () => {
    const value = portServer.address().port;
    portServer.close((error) => error ? reject(error) : resolve(value));
  });
});
const password = randomBytes(24).toString('base64url');
const labelPurpose = 'codex.purpose=pdv-gamified-category-qa';
const labelRun = `codex.run=${runId}`;
const repoRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('docs/testing/pdv-gamified-categories-qa-manifest.json', repoRoot), 'utf8'));
const { manifestSha256, ...manifestBody } = manifest;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
if (sha256(Buffer.from(JSON.stringify(manifestBody))) !== manifestSha256) throw new Error('Gamified category QA manifest digest mismatch');
for (const candidate of manifest.candidates) {
  const actual = sha256(await readFile(new URL(candidate.path, repoRoot)));
  if (actual !== candidate.sha256) throw new Error(`Gamified category QA candidate hash mismatch: ${candidate.path}`);
}
const migration = await readFile(new URL('../prisma/migrations/20261008120000_pdv_gamified_categories/migration.sql', import.meta.url), 'utf8');
const transform = await readFile(new URL('../prisma/transformations/pdv-gamified-categories-v1.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../prisma/transformations/rollback-pdv-gamified-categories-v1.sql', import.meta.url), 'utf8');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function must(command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout).slice(0, 1500)}`);
  return result.stdout.trim();
}
function sql(statement) {
  return must('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'category_qa', '-At', '-F', '|'], { input: statement });
}
function expectFailure(statement, expected) {
  const result = run('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'category_qa'], { input: statement });
  if (result.status === 0 || !`${result.stdout}\n${result.stderr}`.includes(expected)) throw new Error(`Expected QA SQL failure containing ${expected}; got ${result.stderr || result.stdout}`);
}

let created = false;
try {
  must('docker', ['run', '-d', '--rm', '--name', container, '--label', labelPurpose, '--label', labelRun,
    '-p', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=256m',
    '-e', 'POSTGRES_USER=postgres', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=category_qa', 'postgres:17-alpine']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    if (run('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'category_qa']).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');

  sql(`CREATE TABLE "Cervejaria" ("id" TEXT PRIMARY KEY);
       CREATE TABLE "Produto" ("id" TEXT PRIMARY KEY, "cervejariaId" TEXT NOT NULL, "categoria" TEXT, UNIQUE ("id", "cervejariaId"));
       CREATE TABLE "CardapioProduto" ("id" TEXT PRIMARY KEY, "produtoId" TEXT NOT NULL);`);
  sql(migration);
  sql(`INSERT INTO "Cervejaria" VALUES ('tenant-a'), ('tenant-b');
       INSERT INTO "Produto" ("id", "cervejariaId", "categoria") VALUES
         ('product-a-beer', 'tenant-a', 'Chope'), ('product-a-drink', 'tenant-a', 'Bebidas'), ('product-b-beer', 'tenant-b', 'Chope');
       INSERT INTO "CardapioProduto" VALUES ('menu-product-a-beer', 'product-a-beer');
       INSERT INTO "CategoriaProdutoPdv" ("id", "cervejariaId", "nome", "nomeNormalizado", "gamificada", "updatedAt")
         VALUES ('manual-a', 'tenant-a', 'Temporária', 'temporaria', true, CURRENT_TIMESTAMP);`);
  sql(transform);
  let rows = sql(`SELECT p."id", p."categoria", p."categoriaPdvId", c."nome", c."gamificada"
    FROM "Produto" p LEFT JOIN "CategoriaProdutoPdv" c ON c."id" = p."categoriaPdvId" AND c."cervejariaId" = p."cervejariaId" ORDER BY p."id"`);
  if (!rows.includes('product-a-beer|Chope|cat_') || !rows.includes('product-a-drink|Bebidas|cat_') || !rows.includes('product-b-beer|Chope|cat_')) throw new Error(`Historic labels or product links were not preserved: ${rows}`);
  if (sql(`SELECT "produtoId" FROM "CardapioProduto" WHERE "id" = 'menu-product-a-beer'`) !== 'product-a-beer') throw new Error('Cardápio product link changed');
  if (!sql(`SELECT count(*) FROM "CategoriaProdutoPdv" WHERE "origemMigracao" = 'categoria-historica-v1'`).trim().endsWith('3')) throw new Error('Expected one transformed category per tenant and source name');
  const idsBeforeReplay = sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "CategoriaProdutoPdv"`);
  sql(transform);
  if (sql(`SELECT string_agg("id", ',' ORDER BY "id") FROM "CategoriaProdutoPdv"`) !== idsBeforeReplay) throw new Error('Replay created duplicate category rows');

  expectFailure(`INSERT INTO "Produto" ("id", "cervejariaId", "categoria", "categoriaPdvId")
    SELECT 'cross-tenant-product', 'tenant-b', 'Chope', c."id" FROM "CategoriaProdutoPdv" c WHERE c."cervejariaId" = 'tenant-a' AND c."origemMigracao" = 'categoria-historica-v1' LIMIT 1;`, 'foreign key constraint');

  sql(`INSERT INTO "Produto" ("id", "cervejariaId", "categoria") VALUES ('collision-accent', 'tenant-a', 'Porções'), ('collision-plain', 'tenant-a', 'Porcoes');`);
  expectFailure(transform, 'Categoria histórica colide após normalização');
  if (sql(`SELECT count(*) FROM "Produto" WHERE "id" LIKE 'collision-%' AND "categoriaPdvId" IS NOT NULL`) !== '0') throw new Error('Collision failure partially linked products');

  sql(rollback);
  if (sql(`SELECT count(*) FROM "Produto" WHERE "categoriaPdvId" IS NOT NULL`) !== '0') throw new Error('Rollback left migrated product links');
  if (sql(`SELECT count(*) FROM "CategoriaProdutoPdv" WHERE "origemMigracao" = 'categoria-historica-v1'`) !== '0') throw new Error('Rollback left migration-owned categories');
  if (sql(`SELECT count(*) FROM "CategoriaProdutoPdv" WHERE "id" = 'manual-a' AND "gamificada"`) !== '1') throw new Error('Rollback removed a manually managed category');
  if (sql(`SELECT count(*) FROM "Produto" WHERE "id" IN ('product-a-beer', 'product-a-drink', 'product-b-beer') AND "categoriaPdvId" IS NULL AND "categoria" IS NOT NULL`) !== '3') throw new Error('Rollback changed product IDs or historical category text');
  console.log(`PDV_GAMIFIED_CATEGORY_QA=PASS; migration=applied; transform=atomic,replay,collision-blocked,rollback; tenant-FK=PASS; PROD_ACCESS_USED=NO; SHARED_DEV_ACCESSED=NO`);
} finally {
  if (created) {
    const labels = must('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]);
    if (labels !== `pdv-gamified-category-qa|${runId}`) throw new Error('Refusing to remove a QA container with mismatched ownership labels');
    must('docker', ['stop', container]);
  }
}
