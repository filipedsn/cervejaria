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
const manifest = JSON.parse(await readFile(new URL('docs/testing/pdv-gamified-categories-qa-manifest-v21.json', repoRoot), 'utf8'));
const { manifestSha256, ...manifestBody } = manifest;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
if (sha256(Buffer.from(JSON.stringify(manifestBody))) !== manifestSha256) throw new Error('Gamified category QA manifest digest mismatch');
for (const candidate of manifest.candidates) {
  if (sha256(await readFile(new URL(candidate.path, repoRoot))) !== candidate.sha256) throw new Error(`Gamified category QA candidate hash mismatch: ${candidate.path}`);
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
       INSERT INTO "CategoriaProdutoPdv" ("id", "cervejariaId", "nome", "nomeNormalizado", "gamificada", "updatedAt")
         VALUES ('manual-beer', 'tenant-a', 'Chope', 'chope', true, CURRENT_TIMESTAMP);
       INSERT INTO "Produto" ("id", "cervejariaId", "categoria", "categoriaPdvId") VALUES
         ('prelinked', 'tenant-a', 'Chope', 'manual-beer');
       INSERT INTO "Produto" ("id", "cervejariaId", "categoria") VALUES
         ('reuse-manual', 'tenant-a', 'Chope'), ('create-category', 'tenant-a', 'Bebidas'), ('tenant-b-beer', 'tenant-b', 'Chope');
       INSERT INTO "CardapioProduto" VALUES ('menu-product', 'create-category');`);
  sql(transform);
  const firstState = sql(`SELECT p."id", p."categoria", p."categoriaPdvId", c."nome", c."gamificada"
    FROM "Produto" p LEFT JOIN "CategoriaProdutoPdv" c ON c."id" = p."categoriaPdvId" AND c."cervejariaId" = p."cervejariaId" ORDER BY p."id"`);
  if (!firstState.includes('reuse-manual|Chope|manual-beer|Chope|t')) throw new Error(`Manual category was not reused: ${firstState}`);
  if (!firstState.includes('prelinked|Chope|manual-beer|Chope|t')) throw new Error(`Pre-linked product changed: ${firstState}`);
  if (!firstState.includes('create-category|Bebidas|cat_')) throw new Error(`Created category/product link missing: ${firstState}`);
  if (sql(`SELECT count(*) FROM "PdvCategoriaTransformacaoProduto" WHERE "transformacao" = 'categoria-historica-v2'`) !== '3') throw new Error('Provenance should contain only the three links created by the transform');
  if (sql(`SELECT string_agg("acao", ',' ORDER BY "nome") FROM "PdvCategoriaTransformacaoCategoria" WHERE "transformacao" = 'categoria-historica-v2' AND "cervejariaId" = 'tenant-a'`) !== 'CRIADA,REAPROVEITADA') throw new Error('Provenance did not distinguish created and reused categories');
  if (sql(`SELECT "produtoId" FROM "CardapioProduto" WHERE "id" = 'menu-product'`) !== 'create-category') throw new Error('Menu product ID changed');

  const beforeReplay = sql(`SELECT (SELECT count(*) FROM "CategoriaProdutoPdv"), (SELECT count(*) FROM "PdvCategoriaTransformacaoProduto"), (SELECT count(*) FROM "PdvCategoriaTransformacaoCategoria")`);
  sql(transform);
  if (sql(`SELECT (SELECT count(*) FROM "CategoriaProdutoPdv"), (SELECT count(*) FROM "PdvCategoriaTransformacaoProduto"), (SELECT count(*) FROM "PdvCategoriaTransformacaoCategoria")`) !== beforeReplay) throw new Error('Replay changed category or provenance row counts');

  sql(`INSERT INTO "Produto" ("id", "cervejariaId", "categoria") VALUES ('resume-product', 'tenant-a', 'Lanches');
       CREATE FUNCTION qa_reject_resume_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = 'resume-product' AND NEW."categoriaPdvId" IS NOT NULL THEN RAISE EXCEPTION 'qa interruption'; END IF; RETURN NEW; END $$;
       CREATE TRIGGER qa_reject_resume_link BEFORE UPDATE OF "categoriaPdvId" ON "Produto" FOR EACH ROW EXECUTE FUNCTION qa_reject_resume_link();`);
  expectFailure(transform, 'qa interruption');
  if (sql(`SELECT count(*) FROM "CategoriaProdutoPdv" WHERE "cervejariaId" = 'tenant-a' AND "nome" = 'Lanches'`) !== '0' || sql(`SELECT count(*) FROM "PdvCategoriaTransformacaoProduto" WHERE "produtoId" = 'resume-product'`) !== '0') throw new Error('Interrupted transformation left partial category or provenance rows');
  sql(`DROP TRIGGER qa_reject_resume_link ON "Produto"; DROP FUNCTION qa_reject_resume_link();`);
  sql(transform);
  if (!sql(`SELECT "categoriaPdvId" FROM "Produto" WHERE "id" = 'resume-product'`).startsWith('cat_')) throw new Error('Transformation did not resume after its atomic interruption');
  sql(transform);

  const createdCategory = sql(`SELECT c."id" FROM "CategoriaProdutoPdv" c JOIN "PdvCategoriaTransformacaoCategoria" e ON e."categoriaPdvId" = c."id" AND e."cervejariaId" = c."cervejariaId" WHERE e."transformacao" = 'categoria-historica-v2' AND e."acao" = 'CRIADA' AND c."nome" = 'Bebidas'`);
  sql(`INSERT INTO "Produto" ("id", "cervejariaId", "categoria", "categoriaPdvId") VALUES ('late-linked', 'tenant-a', 'Bebidas', '${createdCategory}');`);
  const lateState = sql(`SELECT "categoria", "categoriaPdvId" FROM "Produto" WHERE "id" = 'late-linked'`);
  expectFailure(rollback, 'product was attached later');
  if (sql(`SELECT "categoria", "categoriaPdvId" FROM "Produto" WHERE "id" = 'late-linked'`) !== lateState) throw new Error('Blocked rollback modified a later product');
  sql(`DELETE FROM "Produto" WHERE "id" = 'late-linked';`);

  const manualSnapshot = sql(`SELECT "nome", "nomeNormalizado", "gamificada", "origemMigracao" FROM "CategoriaProdutoPdv" WHERE "id" = 'manual-beer'`);
  sql(`UPDATE "CategoriaProdutoPdv" SET "nome" = 'Bebidas editada', "nomeNormalizado" = 'bebidas editada' WHERE "id" = '${createdCategory}';`);
  const editedCategorySnapshot = sql(`SELECT "nome", "nomeNormalizado" FROM "CategoriaProdutoPdv" WHERE "id" = '${createdCategory}'`);
  expectFailure(rollback, 'category changed or removed');
  expectFailure(transform, 'provenance');
  if (sql(`SELECT \"nome\", \"nomeNormalizado\" FROM \"CategoriaProdutoPdv\" WHERE \"id\" = '${createdCategory}'`) !== editedCategorySnapshot) throw new Error('Replay validation changed a later category edit');
  if (sql(`SELECT "nome", "nomeNormalizado" FROM "CategoriaProdutoPdv" WHERE "id" = '${createdCategory}'`) !== editedCategorySnapshot) throw new Error('Blocked rollback reverted a later category edit');
  sql(`UPDATE "CategoriaProdutoPdv" SET "nome" = 'Bebidas', "nomeNormalizado" = 'bebidas' WHERE "id" = '${createdCategory}';`);

  sql(`UPDATE "Produto" SET "categoriaPdvId" = 'manual-beer' WHERE "id" = 'create-category';`);
  expectFailure(rollback, 'product changed or removed');
  if (sql(`SELECT \"categoriaPdvId\" FROM \"Produto\" WHERE \"id\" = 'create-category'`) !== 'manual-beer') throw new Error('Blocked rollback reverted a later product link edit');
  sql(`UPDATE "Produto" SET "categoriaPdvId" = '${createdCategory}' WHERE "id" = 'create-category';`);

  sql(`UPDATE "CategoriaProdutoPdv" SET "gamificada" = false WHERE "id" = 'manual-beer';`);
  const editedManualCategory = sql(`SELECT \"gamificada\" FROM \"CategoriaProdutoPdv\" WHERE \"id\" = 'manual-beer'`);
  expectFailure(rollback, 'category changed or removed');
  if (sql(`SELECT \"gamificada\" FROM \"CategoriaProdutoPdv\" WHERE \"id\" = 'manual-beer'`) !== editedManualCategory) throw new Error('Blocked rollback reverted a later manual category edit');
  sql(`UPDATE "CategoriaProdutoPdv" SET "gamificada" = true WHERE "id" = 'manual-beer';`);

  sql(`UPDATE "Produto" SET "categoria" = 'local edit' WHERE "id" = 'create-category';`);
  expectFailure(rollback, 'product changed or removed');
  if (sql(`SELECT "categoria" FROM "Produto" WHERE "id" = 'create-category'`) !== 'local edit') throw new Error('Blocked rollback reverted a later product edit');
  sql(`UPDATE "Produto" SET "categoria" = 'Bebidas' WHERE "id" = 'create-category';`);

  sql(rollback);
  if (sql(`SELECT count(*) FROM "PdvCategoriaTransformacaoProduto" WHERE "transformacao" = 'categoria-historica-v2'`) !== '0') throw new Error('Successful rollback retained active product provenance');
  if (sql(`SELECT count(*) FROM "CategoriaProdutoPdv" WHERE "origemMigracao" = 'categoria-historica-v2'`) !== '0') throw new Error('Successful rollback retained created categories');
  if (sql(`SELECT count(*) FROM "Produto" WHERE "id" IN ('reuse-manual','create-category','tenant-b-beer','resume-product') AND "categoriaPdvId" IS NULL AND "categoria" IS NOT NULL`) !== '4') throw new Error('Rollback did not restore transformed products');
  if (sql(`SELECT "categoriaPdvId" FROM "Produto" WHERE "id" = 'prelinked'`) !== 'manual-beer') throw new Error('Rollback changed a link that existed before transformation');
  if (sql(`SELECT "nome", "nomeNormalizado", "gamificada", "origemMigracao" FROM "CategoriaProdutoPdv" WHERE "id" = 'manual-beer'`) !== manualSnapshot) throw new Error('Rollback changed a reused manual category');

  expectFailure(`INSERT INTO "Produto" ("id", "cervejariaId", "categoria", "categoriaPdvId") VALUES ('cross-tenant', 'tenant-b', 'Chope', 'manual-beer');`, 'foreign key constraint');
  sql(`INSERT INTO "Produto" ("id", "cervejariaId", "categoria") VALUES ('collision-accent', 'tenant-a', 'Porções'), ('collision-plain', 'tenant-a', 'Porcoes');`);
  expectFailure(transform, 'collide after normalization');
  if (sql(`SELECT count(*) FROM "Produto" WHERE "id" LIKE 'collision-%' AND "categoriaPdvId" IS NOT NULL`) !== '0') throw new Error('Collision failure partially linked products');
  console.log('PDV_GAMIFIED_CATEGORY_SQL_QA=PASS; created/reused provenance; prelinked preserved; replay; atomic interruption/resume; edited product/category rollback blocked; safe rollback; late link blocked; tenant FK; collision atomic; SQL_ONLY=YES');
} finally {
  if (created) {
    const labels = must('docker', ['inspect', '-f', '{{ index .Config.Labels "codex.purpose" }}|{{ index .Config.Labels "codex.run" }}', container]);
    if (labels !== `pdv-gamified-category-qa|${runId}`) throw new Error('Refusing to remove a QA container with mismatched ownership labels');
    must('docker', ['stop', container]);
  }
}
