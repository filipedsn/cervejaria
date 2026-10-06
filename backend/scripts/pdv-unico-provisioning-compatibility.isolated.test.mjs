import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { readPinnedBlob } from './pdv-unico-migrator-qa-manifest.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL differs from the validated isolated QA target.');
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.env.PDV_QA_RUN_ID;
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-provisioning-compat-${runId}-`));
if (!path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe provisioning QA temporary directory.');
const preModelCommit = '06b23a9c93e3d9e54c106d173f7d6921bf3e7138';
const preModelClientPath = path.join(backendRoot, 'node_modules', '.prisma', `pdv-pre-config-${runId}`);

function runPrisma(args) {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl };
  for (const name of Object.keys(env)) if (/^PROD/i.test(name) || (/_DATABASE_URL$/.test(name) && name !== 'DATABASE_URL')) delete env[name];
  const result = awaitableSpawn(args, env);
  if (result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed: ${(result.stderr || result.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(-1800)}`);
  return result.stdout;
}

function awaitableSpawn(args, env) {
  return spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
}

try {
  let preModelSchema = readPinnedBlob(preModelCommit, 'backend/prisma/schema.prisma').toString('utf8');
  assert(!preModelSchema.includes('model ConfiguracaoPontoVenda'), 'pinned predecessor schema predates ConfiguracaoPontoVenda');
  preModelSchema = preModelSchema.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${preModelClientPath.replaceAll('\\', '/')}"`);
  const preModelSchemaPath = path.join(temporaryRoot, 'pre-configuracao-ponto-venda.prisma');
  await writeFile(preModelSchemaPath, preModelSchema);
  runPrisma(['validate', '--schema', preModelSchemaPath]);
  runPrisma(['generate', '--schema', preModelSchemaPath]);
  runPrisma(['db', 'push', '--schema', preModelSchemaPath, '--force-reset', '--accept-data-loss', '--skip-generate']);

  const { Prisma: LegacyPrisma, PrismaClient: LegacyPrismaClient } = await import(pathToFileURL(path.join(preModelClientPath, 'index.js')).href);
  const legacyClient = new LegacyPrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    assert(!LegacyPrisma.dmmf.datamodel.models.some((model) => model.name === 'ConfiguracaoPontoVenda'), 'generated transaction client has no additive configuration model');
    const { provisionEstablishment } = await import('../src/lib/provision-establishment.ts');
    const input = {
      nome: `Pre model reproduction ${runId}`, slug: `pre-model-reproduction-${runId}`,
      dono: { nome: 'Pre model owner', email: `pre-model-owner-${runId}@example.invalid`, senhaHash: 'qa-hash-only' },
    };
    const additiveModelCount = await legacyClient.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='quiosque' AND table_name='ConfiguracaoPontoVenda'`;
    assert.equal(additiveModelCount[0].count, 0, 'pre-model PostgreSQL database contains no additive table');

    await legacyClient.$transaction((tx) => provisionEstablishment(tx, input, { mode: 'LEGACY' }));
    const jsonCompany = await legacyClient.cervejaria.findUniqueOrThrow({ where: { slug: input.slug } });
    assert.equal(await legacyClient.usuario.count({ where: { cervejariaId: jsonCompany.id, papel: 'DONO' } }), 1, 'legacy JSON provisioning creates its owner');
    assert.equal(await legacyClient.pontoVenda.count({ where: { cervejariaId: jsonCompany.id } }), 0, 'legacy JSON provisioning preserves its previous no-PDV contract');
    assert.equal(await legacyClient.trailer.count({ where: { cervejariaId: jsonCompany.id } }), 0, 'legacy JSON provisioning does not create a Trailer by default');
    assert.equal(await legacyClient.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='quiosque' AND table_name='ConfiguracaoPontoVenda'`.then((rows) => rows[0].count), 0, 'legacy JSON path never queries or writes the additive model');

    const { adaptLegacyProvisioning } = await import('../src/lib/provision-establishment.ts');
    const adapted = adaptLegacyProvisioning({
      cervejariaNome: `Pre model multipart ${runId}`, donoNome: 'Multipart owner',
      donoEmail: `pre-model-multipart-${runId}@example.invalid`, senhaHash: 'qa-hash-only',
      moduloCervejaria: true, moduloOperacao: true, operacaoControlaEstoque: true, operacaoTemCozinha: false,
    }, `pre-model-multipart-${runId}`);
    await legacyClient.$transaction((tx) => provisionEstablishment(tx, adapted.input, { ...adapted.resources, mode: 'LEGACY' }));
    const multipartCompany = await legacyClient.cervejaria.findUniqueOrThrow({ where: { slug: `pre-model-multipart-${runId}` } });
    assert.equal(await legacyClient.trailer.count({ where: { cervejariaId: multipartCompany.id } }), 1, 'legacy multipart adapter preserves Trailer creation');
    assert.equal(await legacyClient.pontoVenda.count({ where: { cervejariaId: multipartCompany.id } }), 1, 'legacy multipart adapter preserves first-PDV creation');
    const legacySetup = await legacyClient.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: multipartCompany.id } });
    assert.deepEqual([legacySetup.plannedOperationsEnabled, legacySetup.tapsEnabled, legacySetup.inventoryEnabled, legacySetup.kitchenEnabled], [true, true, true, false], 'legacy multipart explicit resource parameters remain persisted');
    const legacyProjection = await legacyClient.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: multipartCompany.id } });
    assert.deepEqual([legacyProjection.controlaEstoque, legacyProjection.temCozinha], [true, false], 'legacy operation parameters retain their projection');

    const { ativarModuloOperacao } = await import('../src/lib/operacao/modulo.ts');
    const activationCompany = await legacyClient.cervejaria.create({ data: { nome: `Pre model activation ${runId}`, slug: `pre-model-activation-${runId}` } });
    const activationResult = await legacyClient.$transaction((tx) => ativarModuloOperacao(tx, {
      cervejariaId: activationCompany.id, controlaEstoque: true, temCozinha: false, exclusivo: false,
    }));
    assert.equal(activationResult.pontoVenda.cervejariaId, activationCompany.id, 'internal activation creates its first point in legacy mode');
    assert.equal(await legacyClient.pontoVenda.count({ where: { cervejariaId: activationCompany.id } }), 1);
    assert.deepEqual([await legacyClient.configuracaoOperacao.count({ where: { cervejariaId: activationCompany.id } }), additiveModelCount[0].count], [1, 0]);
    console.log('QA_PREMODEL_PROVISIONING_COMPAT=PASS; schema=06b23a9c; client/table=model=absent; json=multipart/internal-activation=legacy-contract; additive-queries=0');
  } finally {
    await legacyClient.$disconnect();
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
