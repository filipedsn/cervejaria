import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { materializePinnedMigrationBundle, verifyPinnedManifest } from './pdv-unico-qa-migration-manifest.mjs';
import { readPinnedBlob } from './pdv-unico-migrator-qa-manifest.mjs';

// Reject non-disposable targets before importing/generated Prisma clients or opening a connection.
const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL differs from the validated isolated QA target.');
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');
const runId = process.env.PDV_QA_RUN_ID ?? `manual-${process.pid}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), `pdv-commerce-${runId}-`));
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.UPLOADS_DIR = path.join(tempRoot, 'app-uploads');
const generatedClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-commerce-client-${runId}`);
const sha256 = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');
const manifestPath = path.join(repoRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const { manifestSha256, ...body } = manifest;
assert.equal(sha256(Buffer.from(JSON.stringify(body)), manifestSha256), manifestSha256, 'current QA manifest digest');
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', manifest.baseline.commit, 'HEAD'], { cwd: repoRoot }).status, 0, 'baseline is immutable ancestor');
assert.equal(sha256(readPinnedBlob(manifest.baseline.commit, manifest.baseline.schemaPath)), manifest.baseline.schemaSha256, 'baseline schema blob hash');
const candidateSchema = readPinnedBlob(manifest.delivery.schemaCommit, manifest.baseline.schemaPath);
assert.equal(sha256(candidateSchema), manifest.delivery.schemaSha256, 'pinned schema candidate hash');
const commerceSql = await readFile(path.join(repoRoot, manifest.delivery.migrationPath));
assert.equal(sha256(commerceSql), manifest.delivery.migrationSha256, 'candidate SQL hash');
const historicalProvenanceMigration = manifest.priorManifests.finance.historicalProvenanceMigration;
assert(historicalProvenanceMigration?.path && historicalProvenanceMigration?.sha256, 'manifest pins historical payment provenance migration');
const historicalProvenanceSql = await readFile(path.join(repoRoot, historicalProvenanceMigration.path));
assert.equal(sha256(historicalProvenanceSql), historicalProvenanceMigration.sha256, 'pinned historical payment provenance SQL');
const saleSessionContextMigration = manifest.delivery.saleSessionContextMigration;
assert(saleSessionContextMigration?.path && saleSessionContextMigration?.sha256, 'manifest pins explicit sale realization session migration');
const saleSessionContextSql = await readFile(path.join(repoRoot, saleSessionContextMigration.path));
assert.equal(sha256(saleSessionContextSql), saleSessionContextMigration.sha256, 'pinned sale realization session SQL');
const tapMountMigration = manifest.delivery.tapMountMigration;
assert(tapMountMigration?.path && tapMountMigration?.sha256, 'manifest pins the canonical PDV Tap migration');
const tapMountSql = await readFile(path.join(repoRoot, tapMountMigration.path));
assert.equal(sha256(tapMountSql), tapMountMigration.sha256, 'pinned canonical Tap SQL');
const independentKitchenMigration = manifest.delivery.independentKitchenOrderMigration;
assert(independentKitchenMigration?.path && independentKitchenMigration?.sha256, 'manifest pins the independent kitchen order candidate');
const independentKitchenSql = await readFile(path.join(repoRoot, independentKitchenMigration.path));
assert.equal(sha256(independentKitchenSql), independentKitchenMigration.sha256, 'pinned independent kitchen order SQL');
for (const item of manifest.immutableManifests) assert.equal(sha256(await readFile(path.join(repoRoot, item.path))), item.sha256, `immutable prior manifest ${item.path}`);
for (const item of manifest.codeCandidates) assert.equal(sha256(await readFile(path.join(repoRoot, item.path))), item.sha256, `current code candidate ${item.path}`);

function runPrisma(args, targetUrl = databaseUrl, allowFailure = false) {
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: targetUrl };
  for (const name of Object.keys(env)) if (/^PROD/i.test(name) || (/_DATABASE_URL$/.test(name) && name !== 'DATABASE_URL')) delete env[name];
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true });
  if (!allowFailure && result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed: ${(result.stderr || result.stdout).replaceAll(targetUrl, '[QA URL REDACTED]').slice(0, 1600)}`);
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}
const id = (name) => `${name}-qa-${runId}`;
const slug = (name) => `${name}-${runId}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
const plain = (value) => JSON.parse(JSON.stringify(value));
function changedJsonPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => changedJsonPaths(before[index], after[index], `${prefix}[${index}]`)).flat();
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => changedJsonPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix || '<root>'];
}
const centsExact = (value) => {
  const text = value?.toString?.() ?? String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  assert(match, `expected exact decimal with at most 2 fractional places, received ${text}`);
  const magnitude = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return (match[1] ? -magnitude : magnitude).toString();
};

async function withQaDate(day, operation) {
  const RealDate = globalThis.Date;
  const instant = new RealDate(`${day}T15:00:00.000Z`).getTime();
  globalThis.Date = class QaDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  try { return await operation(); }
  finally { globalThis.Date = RealDate; }
}

async function proveAuthenticatedCashApi({ db, primaryCompany, primaryPoint, menuA, menuB, product, secondCompany, secondPoint, secondMenu, secondProduct, runId }) {
  assert.equal(process.env.PDV_ISOLATED_QA, '1');
  const validatedTarget = validateIsolatedQaEnvironment(process.env);
  assert.equal(process.env.DATABASE_URL, validatedTarget.toString(), 'Fastify and every runtime Prisma module use the validated QA URL');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/cervejaria_qa_pdv_unico');
  assert.notEqual(primaryCompany.id, secondCompany.id);
  assert.notEqual(primaryPoint.id, secondPoint.id);
  assert.equal((await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: primaryCompany.id } })).plannedOperationsEnabled, true, 'legacy EVENTO selector remains true after the synthetic migration');
  assert.equal((await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).plannedOperationsEnabled, false, 'second tenant remains originally Por Caixa');

  const previousCanonicalFlag = process.env.PDV_CANONICAL_CONFIG_QA;
  process.env.PDV_CANONICAL_CONFIG_QA = '1';

  // Deliberately make company-level compatibility settings disagree with the
  // already migrated per-PDV configuration. Canonical settings must win.
  const canonicalSettings = {
    tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false,
    kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false,
    whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
  };
    for (const company of [primaryCompany, secondCompany]) {
    await db.configuracaoOperacional.update({ where: { cervejariaId: company.id }, data: {
      tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true,
      kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: true,
      whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: true,
    } });
    await db.configuracaoOperacao.update({ where: { cervejariaId: company.id }, data: {
      controlaEstoque: true, temCozinha: true, quantidadeMesas: 2,
    } });
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: company.id === primaryCompany.id ? primaryPoint.id : secondPoint.id }, data: {
      ...canonicalSettings, quantidadeMesas: company.id === primaryCompany.id ? 8 : 9,
    } });
  }

  // Password hashing is the same bcrypt mechanism used by account creation and login.
  const { hashPassword } = await import('../src/lib/utils.ts');
  const ownerPassword = `Qa-owner-${runId}-only!`;
  const attendantPassword = `Qa-attendant-${runId}-only!`;
  const secondOwnerPassword = `Qa-second-${runId}-only!`;
  const adminPassword = `Qa-admin-${runId}-only!`;
  const [ownerHash, attendantHash, secondOwnerHash, adminHash] = await Promise.all([
    hashPassword(ownerPassword), hashPassword(attendantPassword), hashPassword(secondOwnerPassword),
    hashPassword(adminPassword),
  ]);
  const blockerPasswords = ['no-point', 'no-config', 'multiple-points'].map((name) => `Qa-${name}-${runId}-only!`);
  const blockerHashes = await Promise.all(blockerPasswords.map(hashPassword));
  const authOwner = await db.usuario.create({ data: { id: `auth-owner-${runId}`, nome: 'Synthetic authenticated owner', email: `auth-owner-${runId}@example.invalid`, senhaHash: ownerHash, papel: 'DONO', cervejariaId: primaryCompany.id } });
  const authAttendant = await db.usuario.create({ data: { id: `auth-attendant-${runId}`, nome: 'Synthetic authenticated attendant', email: `auth-attendant-${runId}@example.invalid`, senhaHash: attendantHash, papel: 'ATENDENTE', cervejariaId: primaryCompany.id } });
  const secondOwner = await db.usuario.create({ data: { id: `auth-second-owner-${runId}`, nome: 'Synthetic second-tenant owner', email: `auth-second-owner-${runId}@example.invalid`, senhaHash: secondOwnerHash, papel: 'DONO', cervejariaId: secondCompany.id } });
  const authAdmin = await db.usuario.create({ data: { id: `auth-admin-${runId}`, nome: 'Synthetic platform admin', email: `auth-admin-${runId}@example.invalid`, senhaHash: adminHash, papel: 'ADMIN', cervejariaId: null } });
  const blockerFixtures = [];
  for (const [index, name] of ['no-point', 'no-config', 'multiple-points'].entries()) {
    const tenant = await db.cervejaria.create({ data: { nome: `Synthetic canonical blocker ${name}`, slug: `${slug(name)}-${runId}` } });
    const user = await db.usuario.create({ data: { id: `auth-blocker-${name}-${runId}`, nome: `Synthetic ${name} owner`, email: `auth-blocker-${name}-${runId}@example.invalid`, senhaHash: blockerHashes[index], papel: 'DONO', cervejariaId: tenant.id } });
    const password = blockerPasswords[index];
    if (name === 'no-config') await db.pontoVenda.create({ data: { id: `blocker-point-${runId}`, cervejariaId: tenant.id, nome: 'Missing config point' } });
    if (name === 'multiple-points') {
      const pointA = await db.pontoVenda.create({ data: { id: `blocker-point-a-${runId}`, cervejariaId: tenant.id, nome: 'Ambiguous point A' } });
      const pointB = await db.pontoVenda.create({ data: { id: `blocker-point-b-${runId}`, cervejariaId: tenant.id, nome: 'Ambiguous point B' } });
      await db.configuracaoPontoVenda.create({ data: {
        cervejariaId: tenant.id, pontoVendaId: pointA.id, tapsEnabled: false, inventoryEnabled: false,
        kitchenEnabled: false, kitchenItemsChargeAtLaunch: false,
        allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false,
        whatsappPedidoProntoNaCozinha: false,
      } });
      assert.notEqual(pointA.id, pointB.id);
    }
    assert.equal((await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: primaryCompany.id } })).plannedOperationsEnabled, true, 'canonical operation does not rewrite the legacy EVENTO selector');
    assert.equal((await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).plannedOperationsEnabled, false, 'canonical operation does not rewrite the legacy CAIXA selector');
    blockerFixtures.push({ name, tenant, user, password, expectedCode: name === 'no-point' ? 'CANONICAL_PDV_MISSING' : name === 'no-config' ? 'CANONICAL_PDV_CONFIGURATION_MISSING' : 'CANONICAL_PDV_AMBIGUOUS' });
  }

  // app.ts and the Prisma singleton are imported only after the QA destination guard above.
  const previousQaMode = process.env.QA_MODE;
  process.env.QA_MODE = '1';
  const [{ buildApp }, { prisma: runtimePrisma }] = await Promise.all([
    import('../src/app.ts'),
    import('../src/lib/prisma.ts'),
  ]);
  const runtimeConnection = await runtimePrisma.$queryRaw`SELECT current_database() AS database_name`;
  assert.equal(runtimeConnection.length, 1);
  assert.equal(runtimeConnection[0].database_name, 'cervejaria_qa_pdv_unico', 'runtime Prisma connects to the disposable QA database');

  const app = await buildApp();
  const counts = async () => {
    const tenantIds = [primaryCompany.id, secondCompany.id];
    const commandTenantFilter = { OR: [
      { pontoVenda: { cervejariaId: { in: tenantIds } } },
      { evento: { cervejariaId: { in: tenantIds } } },
    ] };
    const [points, pointConfigs, sessions, commands, items, payments, orders, agendas, occurrences, stockBalances, stockMovements] = await Promise.all([
      db.pontoVenda.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.configuracaoPontoVenda.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.sessaoCaixaOperacao.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.comanda.count({ where: commandTenantFilter }),
      db.itemComanda.count({ where: { comanda: commandTenantFilter } }),
      db.pagamento.count({ where: { comanda: commandTenantFilter } }),
      db.pedidoOperacao.count({ where: { comanda: commandTenantFilter } }),
      db.agendaOperacional.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.ocorrenciaOperacional.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.inventoryBalance.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.inventoryMovement.count({ where: { cervejariaId: { in: tenantIds } } }),
    ]);
    return { points, pointConfigs, sessions, commands, items, payments, orders, agendas, occurrences, stockBalances, stockMovements };
  };
  const assertNoApiWrites = async (before, scenario) => assert.deepEqual(await counts(), before, `${scenario} performs no persistent operational writes`);
  const footprintBeforeAuthorization = await counts();

  async function login(email, password, expectedRole) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: password } });
    assert.equal(response.statusCode, 200, `real login succeeds for ${expectedRole}`);
    assert.equal(JSON.parse(response.body).usuario.papel, expectedRole);
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert(cookieHeader?.startsWith('token='), 'login returns the real session credential as an HttpOnly token cookie');
    return cookieHeader.split(';', 1)[0];
  }

  try {
    const missing = await app.inject({ method: 'GET', url: '/api/operacao/contexto' });
    assert.equal(missing.statusCode, 401, 'missing credential is rejected by real authentication');
    const invalid = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: { cookie: 'token=not-a-valid-jwt' } });
    assert.equal(invalid.statusCode, 401, 'invalid token is rejected by real authentication');
    await assertNoApiWrites(footprintBeforeAuthorization, 'missing/invalid credential');

    const ownerCookie = await login(authOwner.email, ownerPassword, 'DONO');
    const attendantCookie = await login(authAttendant.email, attendantPassword, 'ATENDENTE');
    const secondOwnerCookie = await login(secondOwner.email, secondOwnerPassword, 'DONO');
    const adminCookie = await login(authAdmin.email, adminPassword, 'ADMIN');

    const raceCompany = await db.cervejaria.create({ data: { nome: `API lock race ${runId}`, slug: `api-lock-race-${runId}` } });
    await db.configuracaoOperacional.create({ data: { cervejariaId: raceCompany.id, plannedOperationsEnabled: false } });
    await db.configuracaoOperacao.create({ data: { cervejariaId: raceCompany.id } });
    const raceOwner = await db.usuario.create({ data: { id: `api-lock-race-owner-${runId}`, nome: 'API lock race owner', email: `api-lock-race-${runId}@example.invalid`, senhaHash: ownerHash, papel: 'DONO', cervejariaId: raceCompany.id } });
    const raceOwnerCookie = await login(raceOwner.email, ownerPassword, 'DONO');
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    let raceResponses;
    try {
      raceResponses = await Promise.all([1, 2].map((index) => app.inject({
        method: 'POST', url: '/api/operacao/pontos-venda', headers: { cookie: raceOwnerCookie }, payload: { nome: `Race ${index}` },
      })));
    } finally {
      process.env.PDV_CANONICAL_CONFIG_QA = '1';
    }
    assert.deepEqual(raceResponses.map((response) => response.statusCode).sort(), [201, 409], 'two concurrent authenticated first-PDV requests are serialized with one creation and one no-write conflict');
    assert.deepEqual([await db.pontoVenda.count({ where: { cervejariaId: raceCompany.id } }), await db.configuracaoPontoVenda.count({ where: { cervejariaId: raceCompany.id } })], [1, 0], 'legacy-mode API race leaves exactly one point and does not touch the canonical table');

    delete process.env.PDV_CANONICAL_CONFIG_QA;
    try {
      const legacyJsonPayload = {
        nome: `Provisioned legacy JSON ${runId}`,
        dono: { nome: 'Legacy JSON owner', email: `legacy-json-${runId}@example.invalid`, senha: ownerPassword },
        enablements: { plannedOperations: true, taps: false, inventory: true, kitchen: false },
      };
      const legacyJsonResponse = await app.inject({ method: 'POST', url: '/api/admin/cervejarias/provision', headers: { cookie: adminCookie }, payload: legacyJsonPayload });
      assert.equal(legacyJsonResponse.statusCode, 201, `legacy JSON admin route retains its contract: ${legacyJsonResponse.body}`);
      const legacyJson = JSON.parse(legacyJsonResponse.body);
      assert.deepEqual(Object.keys(legacyJson).sort(), ['cervejaria', 'configuracaoOperacional', 'dono']);
      const legacyJsonConfig = await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: legacyJson.cervejaria.id } });
      assert.deepEqual([legacyJsonConfig.plannedOperationsEnabled, legacyJsonConfig.tapsEnabled, legacyJsonConfig.inventoryEnabled, legacyJsonConfig.kitchenEnabled], [true, false, true, false]);
      assert.deepEqual([await db.pontoVenda.count({ where: { cervejariaId: legacyJson.cervejaria.id } }), await db.trailer.count({ where: { cervejariaId: legacyJson.cervejaria.id } }), await db.configuracaoPontoVenda.count({ where: { cervejariaId: legacyJson.cervejaria.id } })], [0, 0, 0], 'legacy JSON contract creates no point or additive config by default');

      const legacyBoundary = `----pdv-legacy-${runId}`;
      const multipartFields = {
        cervejariaNome: `Provisioned legacy multipart ${runId}`, donoNome: 'Legacy multipart owner',
        donoEmail: `legacy-multipart-${runId}@example.invalid`, donoSenha: ownerPassword,
        moduloCervejaria: 'true', moduloOperacao: 'true', operacaoControlaEstoque: 'true', operacaoTemCozinha: 'false',
      };
      const legacyMultipartPayload = Object.entries(multipartFields).map(([name, value]) => `--${legacyBoundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('') + `--${legacyBoundary}--\r\n`;
      const legacyMultipartResponse = await app.inject({ method: 'POST', url: '/api/admin/cervejarias', headers: { cookie: adminCookie, 'content-type': `multipart/form-data; boundary=${legacyBoundary}` }, payload: legacyMultipartPayload });
      assert.equal(legacyMultipartResponse.statusCode, 201, `legacy multipart admin route retains its contract: ${legacyMultipartResponse.body}`);
      const legacyMultipart = JSON.parse(legacyMultipartResponse.body);
      assert.deepEqual(Object.keys(legacyMultipart).sort(), ['cervejaria', 'dono']);
      const legacyMultipartConfig = await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: legacyMultipart.cervejaria.id } });
      const legacyMultipartProjection = await db.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: legacyMultipart.cervejaria.id } });
      assert.deepEqual([legacyMultipartConfig.plannedOperationsEnabled, legacyMultipartConfig.tapsEnabled, legacyMultipartConfig.inventoryEnabled, legacyMultipartConfig.kitchenEnabled], [true, true, true, false], 'legacy multipart flags are preserved in setup metadata');
      assert.deepEqual([legacyMultipartProjection.controlaEstoque, legacyMultipartProjection.temCozinha], [true, false]);
      assert.deepEqual([await db.pontoVenda.count({ where: { cervejariaId: legacyMultipart.cervejaria.id } }), await db.trailer.count({ where: { cervejariaId: legacyMultipart.cervejaria.id } }), await db.configuracaoPontoVenda.count({ where: { cervejariaId: legacyMultipart.cervejaria.id } })], [1, 1, 0], 'legacy multipart creates its selected Trailer and first PDV without canonical config');
      const legacyTrailer = await db.trailer.findFirstOrThrow({ where: { cervejariaId: legacyMultipart.cervejaria.id } });
      assert.equal(await db.tap.count({ where: { trailerId: legacyTrailer.id } }), 4, 'legacy Trailer creation retains its four default taps');
    } finally {
      process.env.PDV_CANONICAL_CONFIG_QA = '1';
    }

    const canonicalBoundary = `----pdv-canonical-${runId}`;
    const canonicalMultipartFields = {
      cervejariaNome: `Provisioned canonical multipart ${runId}`, donoNome: 'Canonical multipart owner',
      donoEmail: `canonical-multipart-${runId}@example.invalid`, donoSenha: ownerPassword,
      moduloCervejaria: 'true', moduloOperacao: 'true', operacaoControlaEstoque: 'true', operacaoTemCozinha: 'false',
    };
    const canonicalMultipartPayload = Object.entries(canonicalMultipartFields).map(([name, value]) => `--${canonicalBoundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('') + `--${canonicalBoundary}--\r\n`;
    const canonicalMultipartResponse = await app.inject({ method: 'POST', url: '/api/admin/cervejarias', headers: { cookie: adminCookie, 'content-type': `multipart/form-data; boundary=${canonicalBoundary}` }, payload: canonicalMultipartPayload });
    assert.equal(canonicalMultipartResponse.statusCode, 201, `canonical multipart admin route provisions its PDV: ${canonicalMultipartResponse.body}`);
    const canonicalMultipart = JSON.parse(canonicalMultipartResponse.body);
    const canonicalMultipartConfig = await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: (await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: canonicalMultipart.cervejaria.id } })).id } });
    const canonicalMultipartSetup = await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: canonicalMultipart.cervejaria.id } });
    assert.deepEqual([canonicalMultipartConfig.tapsEnabled, canonicalMultipartConfig.inventoryEnabled, canonicalMultipartConfig.kitchenEnabled], [true, true, false], 'canonical multipart parameters are applied to PDV configuration');
    assert.deepEqual([canonicalMultipartSetup.plannedOperationsEnabled, canonicalMultipartSetup.inventoryEnabled, canonicalMultipartSetup.kitchenEnabled], [true, true, false], 'explicit legacy module/setup flags remain owned by ConfiguracaoOperacional metadata');
    assert.deepEqual([await db.pontoVenda.count({ where: { cervejariaId: canonicalMultipart.cervejaria.id } }), await db.trailer.count({ where: { cervejariaId: canonicalMultipart.cervejaria.id } }), await db.configuracaoPontoVenda.count({ where: { cervejariaId: canonicalMultipart.cervejaria.id } })], [1, 0, 1], 'canonical multipart never creates Trailer as a substitute PDV');

    const provisionPayload = {
      nome: `Provisioned canonical ${runId}`,
      dono: { nome: 'Provisioned owner', email: `provisioned-owner-${runId}@example.invalid`, senha: ownerPassword },
    };
    const provisionResponses = await Promise.all([1, 2].map(() => app.inject({
      method: 'POST', url: '/api/admin/cervejarias/provision', headers: { cookie: adminCookie }, payload: provisionPayload,
    })));
    assert.deepEqual(provisionResponses.map((response) => response.statusCode).sort(), [201, 409], 'concurrent authenticated provisioning creates one tenant and reports the unique conflict as a retry-safe 409');
    const provisioned = JSON.parse(provisionResponses.find((response) => response.statusCode === 201).body);
    const provisionedPoint = await db.pontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id } });
    const provisionedConfig = await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id } });
    assert.equal(provisionedPoint.length, 1, 'new canonical company is born with one PDV');
    assert.equal(provisionedConfig.length, 1, 'new canonical company is born with one PDV configuration');
    assert.deepEqual([provisionedConfig[0].tapsEnabled, provisionedConfig[0].inventoryEnabled, provisionedConfig[0].kitchenEnabled, provisionedConfig[0].quantidadeMesas], [false, false, false, null], 'omitted enablements use documented disabled/null defaults');
    const provisionedOwnerCookie = await login(provisionPayload.dono.email, provisionPayload.dono.senha, 'DONO');
    const retryBefore = plain({
      company: await db.cervejaria.findUniqueOrThrow({ where: { id: provisioned.cervejaria.id } }),
      point: provisionedPoint,
      config: provisionedConfig,
      owners: await db.usuario.count({ where: { cervejariaId: provisioned.cervejaria.id, papel: 'DONO' } }),
    });
    const provisioningRetry = await app.inject({ method: 'POST', url: '/api/admin/cervejarias/provision', headers: { cookie: adminCookie }, payload: provisionPayload });
    assert.equal(provisioningRetry.statusCode, 409, 'repeating the same authenticated provisioning request does not create another company');
    assert.deepEqual(plain({
      company: await db.cervejaria.findUniqueOrThrow({ where: { id: provisioned.cervejaria.id } }),
      point: await db.pontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id } }),
      config: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id } }),
      owners: await db.usuario.count({ where: { cervejariaId: provisioned.cervejaria.id, papel: 'DONO' } }),
    }), retryBefore, 'retry leaves company, PDV, config, and owner unchanged');

    const setupResponse = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: provisionedOwnerCookie }, payload: {
      operationMode: 'CAIXA', tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false,
      quantidadeMesas: 7, completeInitialSetup: true,
    } });
    assert.equal(setupResponse.statusCode, 200, `canonical setup persists on the PDV: ${setupResponse.body}`);
    const canonicalSetup = JSON.parse(setupResponse.body);
    assert.deepEqual([canonicalSetup.configurationSource, canonicalSetup.pontoVendaId, canonicalSetup.quantidadeMesas, canonicalSetup.setupCompletedAt != null], ['CANONICAL_PDV', provisionedPoint[0].id, 7, true]);
    const canonicalBeforeEventSelection = plain({
      pointConfig: await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: provisionedPoint[0].id } }),
      setup: await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: provisioned.cervejaria.id } }),
    });
    const eventSelection = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: provisionedOwnerCookie }, payload: { operationMode: 'EVENTO' } });
    assert.equal(eventSelection.statusCode, 409, 'canonical setup cannot switch the operating motor to EVENTO');
    assert.deepEqual(plain({
      pointConfig: await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: provisionedPoint[0].id } }),
      setup: await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: provisioned.cervejaria.id } }),
    }), canonicalBeforeEventSelection, 'rejected motor selection does not change PDV settings or setup metadata');
    const provisionedContext = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: { cookie: provisionedOwnerCookie } });
    assert.equal(provisionedContext.statusCode, 200);
    assert.deepEqual([JSON.parse(provisionedContext.body).operationMode, JSON.parse(provisionedContext.body).quantidadeMesas, JSON.parse(provisionedContext.body).pontosVenda.length], ['CAIXA', 7, 1], 'canonical context consumes the PDV parameters and exposes only its single point');

    const productResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos', headers: { cookie: provisionedOwnerCookie }, payload: {
      nome: `Provisioned item ${runId}`, categoria: 'Bebidas', precoUnit: 9.5, tipo: 'BEBIDA', formato: 'LATA', controlaEstoque: true,
    } });
    assert.equal(productResponse.statusCode, 201, `new owner configures the catalog through the authenticated API: ${productResponse.body}`);
    const provisionedProduct = JSON.parse(productResponse.body);
    const chopeAResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos', headers: { cookie: provisionedOwnerCookie }, payload: {
      nome: `Provisioned pale ale ${runId}`, categoria: 'Chope', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 5 }, { volumeMl: 500, preco: 8 }],
    } });
    assert.equal(chopeAResponse.statusCode, 201, `new canonical PDV creates a priced-by-volume beer: ${chopeAResponse.body}`);
    const chopeA = JSON.parse(chopeAResponse.body);
    const chopeBResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos', headers: { cookie: provisionedOwnerCookie }, payload: {
      nome: `Provisioned IPA ${runId}`, categoria: 'Chope', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 6 }, { volumeMl: 500, preco: 9 }],
    } });
    assert.equal(chopeBResponse.statusCode, 201, `second canonical beer preserves its own volume prices: ${chopeBResponse.body}`);
    const chopeB = JSON.parse(chopeBResponse.body);
    assert.deepEqual([chopeA.pontoVendaId, chopeB.pontoVendaId], [provisionedPoint[0].id, provisionedPoint[0].id], 'canonical catalog assigns each new product to its PDV');
    const tapCreate = await app.inject({ method: 'POST', url: '/api/taps', headers: { cookie: provisionedOwnerCookie }, payload: {
      pontoVendaId: provisionedPoint[0].id, numero: 1, nome: 'Principal', produtoId: chopeA.id,
    } });
    assert.equal(tapCreate.statusCode, 201, `canonical tap is configured without a Trailer: ${tapCreate.body}`);
    const canonicalTap = JSON.parse(tapCreate.body);
    assert.deepEqual([canonicalTap.pontoVendaId, canonicalTap.trailerId ?? null], [provisionedPoint[0].id, null]);
    const menuResponse = await app.inject({ method: 'POST', url: '/api/operacao/cardapios', headers: { cookie: provisionedOwnerCookie }, payload: {
      nome: `Provisioned menu ${runId}`, itens: [
        { produtoId: provisionedProduct.id, volumeMl: 0, precoUnit: 9.5 },
        { produtoId: chopeA.id, volumeMl: 300, precoUnit: 5 }, { produtoId: chopeA.id, volumeMl: 500, precoUnit: 8 },
        { produtoId: chopeB.id, volumeMl: 300, precoUnit: 6 }, { produtoId: chopeB.id, volumeMl: 500, precoUnit: 8 },
      ],
    } });
    assert.equal(menuResponse.statusCode, 201, `new owner configures a saved menu through the authenticated API: ${menuResponse.body}`);
    const provisionedMenu = JSON.parse(menuResponse.body);
    const cashOpen = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: provisionedOwnerCookie }, payload: {
      pontoVendaId: provisionedPoint[0].id, trocoInicial: 5, cardapioId: provisionedMenu.id,
    } });
    assert.equal(cashOpen.statusCode, 201, `new canonical PDV opens the Por Caixa session: ${cashOpen.body}`);
    const provisionedSession = JSON.parse(cashOpen.body);
    assert.equal(provisionedSession.trailerId ?? null, null, 'canonical cash session opens without a Trailer association');
    assert.equal(await db.trailer.count({ where: { cervejariaId: provisioned.cervejaria.id } }), 0, 'canonical provisioning and operation did not fabricate a Trailer');
    const tapList = await app.inject({ method: 'GET', url: `/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(provisionedPoint[0].id)}`, headers: { cookie: provisionedOwnerCookie } });
    assert.equal(tapList.statusCode, 200, `session loads taps by PDV: ${tapList.body}`);
    assert.deepEqual(JSON.parse(tapList.body).taps.map((tap) => [tap.id, tap.chopeAtual?.id]), [[canonicalTap.id, chopeA.id]], 'opening the cash turn mounts the configured PDV tap');
    const mountedSwap = await app.inject({ method: 'PUT', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, produtoId: chopeB.id } });
    assert.equal(mountedSwap.statusCode, 200, `session swaps the PDV tap: ${mountedSwap.body}`);
    assert.equal(JSON.parse(mountedSwap.body).taps[0].chopeAtual.id, chopeB.id);
    const commandOpen = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: provisionedOwnerCookie }, payload: {
      pontoVendaId: provisionedPoint[0].id, tipo: 'APELIDO', identificador: `new-tenant-sale-${runId}`,
    } });
    assert.equal(commandOpen.statusCode, 201, `new canonical PDV opens a sale: ${commandOpen.body}`);
    const provisionedCommandId = JSON.parse(commandOpen.body).id;
    const launch = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(provisionedCommandId)}/pedidos`, headers: { cookie: provisionedOwnerCookie }, payload: {
      itens: [{ produtoId: provisionedProduct.id, quantidade: 2 }, { produtoId: chopeB.id, quantidade: 1, tapId: canonicalTap.id, volumeMl: 500 }],
    } });
    assert.equal(launch.statusCode, 201, `new canonical PDV sells from its saved menu: ${launch.body}`);
    assert.equal(centsExact(JSON.parse(launch.body).total), '2700', 'volume price from the saved menu is preserved in the sale total');
    const payment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(provisionedCommandId)}/pagamentos`, headers: { cookie: provisionedOwnerCookie }, payload: {
      pagamentos: [{ forma: 'PIX', valor: 27 }],
    } });
    assert.equal(payment.statusCode, 200, `new canonical PDV records payment: ${payment.body}`);
    const cashClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: provisionedOwnerCookie }, payload: {
      pontoVendaId: provisionedPoint[0].id, contadoDinheiro: 5, contadoPix: 27, contadoCartaoDebito: 0, contadoCartaoCredito: 0,
    } });
    assert.equal(cashClose.statusCode, 200, `new canonical PDV closes the Por Caixa session: ${cashClose.body}`);
    const provisionedSale = await db.comanda.findUniqueOrThrow({ where: { id: provisionedCommandId } });
    assert.deepEqual([provisionedSale.status, provisionedSale.origem, provisionedSale.sessaoCaixaRealizacaoId, provisionedSale.pontoVendaId], ['FECHADA', 'CAIXA', provisionedSession.id, provisionedPoint[0].id], 'new company uses Por Caixa and preserves the realization session required by financial turn reports');
    assert.equal((await db.pagamento.findMany({ where: { comandaId: provisionedCommandId } })).reduce((sum, row) => sum + BigInt(centsExact(row.valor)), 0n), 2700n);
    assert.equal((await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: provisionedSession.id } })).status, 'FECHADO');
    const soldVolumeLine = await db.itemComanda.findFirstOrThrow({ where: { comandaId: provisionedCommandId, produtoId: chopeB.id } });
    assert.deepEqual([soldVolumeLine.tapId, soldVolumeLine.volumeMl, centsExact(soldVolumeLine.precoUnit)], [canonicalTap.id, 500, '800']);
    assert.equal(await db.inventoryMovement.count({ where: { pontoVendaId: provisionedPoint[0].id, produtoId: { in: [chopeA.id, chopeB.id] } } }), 0, 'tap sales do not create stock movements while the canonical inventory capacity is off');
    const historicalTapMounts = await db.tapMontagem.findMany({ where: { sessaoCaixaId: provisionedSession.id, tapId: canonicalTap.id }, orderBy: { iniciadoEm: 'asc' } });
    assert.deepEqual(historicalTapMounts.map((mount) => [mount.produtoId, mount.encerradoEm != null]), [[chopeA.id, true], [chopeB.id, false]], 'swapping beer preserves both mount records');
    const deleteUsedTap = await app.inject({ method: 'DELETE', url: `/api/taps/${encodeURIComponent(canonicalTap.id)}`, headers: { cookie: provisionedOwnerCookie } });
    assert.equal(deleteUsedTap.statusCode, 409, 'a Tap with session history cannot be deleted');
    const secondCashOpen = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: provisionedOwnerCookie }, payload: {
      pontoVendaId: provisionedPoint[0].id, trocoInicial: 5, cardapioId: provisionedMenu.id,
    } });
    assert.equal(secondCashOpen.statusCode, 201, `same PDV opens a later cash session: ${secondCashOpen.body}`);
    const secondSession = JSON.parse(secondCashOpen.body);
    const secondMount = await app.inject({ method: 'GET', url: `/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(provisionedPoint[0].id)}`, headers: { cookie: provisionedOwnerCookie } });
    assert.equal(JSON.parse(secondMount.body).taps[0].chopeAtual.id, chopeA.id, 'new session starts from the saved Tap catalog');
    const removeMount = await app.inject({ method: 'DELETE', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id } });
    assert.equal(removeMount.statusCode, 200, `authenticated operator removes the mounted beer: ${removeMount.body}`);
    assert.equal(await db.tapMontagem.count({ where: { sessaoCaixaId: secondSession.id, tapId: canonicalTap.id, encerradoEm: null } }), 0);
    const repeatedTapReads = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: `/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(provisionedPoint[0].id)}`, headers: { cookie: provisionedOwnerCookie } })));
    assert.deepEqual(repeatedTapReads.map((response) => response.statusCode), [200, 200, 200]);
    assert.ok(repeatedTapReads.every((response) => JSON.parse(response.body).taps[0].chopeAtual === null), 'GET and concurrent initialization preserve an explicit removal');
    assert.equal(await db.tapMontagem.count({ where: { sessaoCaixaId: secondSession.id, tapId: canonicalTap.id, encerradoEm: null } }), 0);
    const explicitRemount = await app.inject({ method: 'PUT', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, produtoId: chopeB.id } });
    assert.equal(explicitRemount.statusCode, 200, `explicit remount after removal works: ${explicitRemount.body}`);
    assert.equal(JSON.parse(explicitRemount.body).taps[0].chopeAtual.id, chopeB.id);
    assert.equal(await db.tapMontagem.count({ where: { sessaoCaixaId: secondSession.id, tapId: canonicalTap.id } }), 2, 'removal and explicit remount preserve history');
    const concurrentMountChanges = await Promise.all([
      ...[chopeA.id, chopeB.id].map((produtoId) => app.inject({ method: 'PUT', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, produtoId } })),
      app.inject({ method: 'DELETE', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id } }),
    ]);
    assert.ok(concurrentMountChanges.every((response) => [200, 400].includes(response.statusCode)), `concurrent swap/removal returns controlled results without P2002/500: ${concurrentMountChanges.map((response) => `${response.statusCode} ${response.body}`).join(' | ')}`);
    assert.ok((await db.tapMontagem.count({ where: { sessaoCaixaId: secondSession.id, tapId: canonicalTap.id, encerradoEm: null } })) <= 1, 'concurrent swaps/removal cannot create incompatible active mounts');
    assert.equal(await db.tapMontagem.count({ where: { sessaoCaixaId: provisionedSession.id, tapId: canonicalTap.id } }), 2, 'later session swaps preserve the earlier session history');
    assert.deepEqual([soldVolumeLine.tapId, soldVolumeLine.volumeMl, centsExact(soldVolumeLine.precoUnit)], [canonicalTap.id, 500, '800'], 'new session mounting does not rewrite the prior sale snapshot');
    const closeRace = await Promise.all([
      app.inject({ method: 'PUT', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, produtoId: chopeA.id } }),
      app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, contadoDinheiro: 5, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } }),
    ]);
    assert.ok([200, 400].includes(closeRace[0].statusCode), `mount/close race returns a controlled result: ${closeRace[0].statusCode} ${closeRace[0].body}`);
    assert.equal(closeRace[1].statusCode, 200, `concurrent close succeeds: ${closeRace[1].body}`);
    const mountsAtClose = await db.tapMontagem.findMany({ where: { sessaoCaixaId: secondSession.id, tapId: canonicalTap.id }, orderBy: { iniciadoEm: 'asc' } });
    const { inicializarMontagemPdv } = await import('../src/lib/tap-montagem.ts');
    await inicializarMontagemPdv(secondSession.id, provisionedPoint[0].id, provisioned.cervejaria.id);
    assert.deepEqual(await db.tapMontagem.findMany({ where: { sessaoCaixaId: secondSession.id, tapId: canonicalTap.id }, orderBy: { iniciadoEm: 'asc' } }), mountsAtClose, 'closed sessions reject initializer writes');
    const legacyMode = process.env.PDV_CANONICAL_CONFIG_QA;
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    let legacyTapForSale;
    try {
      const legacySaleTrailer = await db.trailer.create({ data: { nome: `Legacy sale bridge ${runId}`, cervejariaId: provisioned.cervejaria.id } });
      const legacyTapResponse = await app.inject({ method: 'POST', url: '/api/taps', headers: { cookie: provisionedOwnerCookie }, payload: { trailerId: legacySaleTrailer.id, numero: 71, nome: 'Legacy sale tap', produtoId: chopeA.id } });
      assert.equal(legacyTapResponse.statusCode, 201, `legacy API creates a Trailer-owned Tap: ${legacyTapResponse.body}`);
      legacyTapForSale = JSON.parse(legacyTapResponse.body);
      assert.equal(legacyTapForSale.pontoVendaId ?? null, null);
      const legacySaleOpen = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, trailerId: legacySaleTrailer.id, trocoInicial: 0, cardapioId: provisionedMenu.id } });
      assert.equal(legacySaleOpen.statusCode, 201, `legacy session has both PDV and Trailer context: ${legacySaleOpen.body}`);
      const legacySaleSession = JSON.parse(legacySaleOpen.body);
      assert.deepEqual([legacySaleSession.pontoVendaId, legacySaleSession.trailerId], [provisionedPoint[0].id, legacySaleTrailer.id]);
      const legacyMount = await db.tapMontagem.findFirst({ where: { sessaoCaixaId: legacySaleSession.id, tapId: legacyTapForSale.id, encerradoEm: null } });
      assert.ok(legacyMount, 'legacy Trailer session initializes the matching Tap mount');
      const legacyCommandResponse = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, tipo: 'APELIDO', identificador: `legacy-tap-sale-${runId}` } });
      assert.equal(legacyCommandResponse.statusCode, 201, legacyCommandResponse.body);
      const legacyCommandId = JSON.parse(legacyCommandResponse.body).id;
      const legacySale = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(legacyCommandId)}/pedidos`, headers: { cookie: provisionedOwnerCookie }, payload: { itens: [{ produtoId: chopeA.id, quantidade: 1, tapId: legacyTapForSale.id, volumeMl: 500 }] } });
      assert.equal(legacySale.statusCode, 201, `activation-off sale validates the matching Trailer instead of Tap.pontoVendaId: ${legacySale.body}`);
      assert.equal(centsExact(JSON.parse(legacySale.body).total), '800');
      const legacyPayment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(legacyCommandId)}/pagamentos`, headers: { cookie: provisionedOwnerCookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 8 }] } });
      assert.equal(legacyPayment.statusCode, 200, legacyPayment.body);
      const legacySaleClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: provisionedOwnerCookie }, payload: { pontoVendaId: provisionedPoint[0].id, contadoDinheiro: 0, contadoPix: 8, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
      assert.equal(legacySaleClose.statusCode, 200, legacySaleClose.body);
    } finally { process.env.PDV_CANONICAL_CONFIG_QA = legacyMode; }
    const disabledTaps = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: provisionedOwnerCookie }, payload: { tapsEnabled: false } });
    assert.equal(disabledTaps.statusCode, 200);
    const disabledTapRead = await app.inject({ method: 'GET', url: `/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(provisionedPoint[0].id)}`, headers: { cookie: provisionedOwnerCookie } });
    assert.equal(disabledTapRead.statusCode, 404, 'disabled Tap capability keeps the existing access rule');
    const foreignTapCount = await db.tap.count({ where: { pontoVendaId: provisionedPoint[0].id } });
    const foreignTapCreate = await app.inject({ method: 'POST', url: '/api/taps', headers: { cookie: secondOwnerCookie }, payload: {
      pontoVendaId: provisionedPoint[0].id, numero: 99, produtoId: chopeA.id,
    } });
    assert.equal(foreignTapCreate.statusCode, 409, 'another tenant cannot configure a Tap against the foreign PDV');
    assert.equal(await db.tap.count({ where: { pontoVendaId: provisionedPoint[0].id } }), foreignTapCount, 'cross-tenant Tap attempt makes no write');
    const mountsBeforeForeignScope = await db.tapMontagem.count({ where: { tapId: canonicalTap.id } });
    const foreignMount = await app.inject({ method: 'PUT', url: `/api/operacao/caixa/taps/${encodeURIComponent(canonicalTap.id)}/chope`, headers: { cookie: ownerCookie }, payload: { pontoVendaId: secondPoint.id, produtoId: secondProduct.id } });
    assert.equal(foreignMount.statusCode, 404, 'a session cannot select another tenant/PDV while mounting a Tap');
    assert.equal(await db.tapMontagem.count({ where: { tapId: canonicalTap.id } }), mountsBeforeForeignScope, 'cross-tenant/PDV mounting rejection makes no write');
    const legacyTrailer = await db.trailer.create({ data: { nome: `Legacy tap bridge ${runId}`, cervejariaId: provisioned.cervejaria.id } });
    const unmappedLegacyTap = await db.tap.create({ data: { cervejariaId: provisioned.cervejaria.id, trailerId: legacyTrailer.id, numero: 7, produtoId: chopeA.id } });
    const unmappedTapRead = await app.inject({ method: 'GET', url: '/api/taps', headers: { cookie: provisionedOwnerCookie } });
    assert.equal(unmappedTapRead.statusCode, 409, 'canonical mode explicitly blocks a legacy Tap with no confirmed PDV map');
    assert.equal(JSON.parse(unmappedTapRead.body).code, 'CANONICAL_TAP_MAPPING_REQUIRED');
    const savedCanonicalFlag = process.env.PDV_CANONICAL_CONFIG_QA;
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    try {
      const legacyTapRead = await app.inject({ method: 'GET', url: `/api/taps?trailerId=${encodeURIComponent(legacyTrailer.id)}`, headers: { cookie: provisionedOwnerCookie } });
      assert.equal(legacyTapRead.statusCode, 200, 'the disabled activation branch retains the legacy Trailer API');
      assert.deepEqual(JSON.parse(legacyTapRead.body).map((tap) => tap.id), [unmappedLegacyTap.id]);
    } finally { process.env.PDV_CANONICAL_CONFIG_QA = savedCanonicalFlag; }
    await db.tap.delete({ where: { id: unmappedLegacyTap.id } });
    await db.trailer.delete({ where: { id: legacyTrailer.id } });

    const beforeDuplicate = plain({
      points: await db.pontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id }, orderBy: { id: 'asc' } }),
      configs: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id }, orderBy: { id: 'asc' } }),
    });
    const duplicateCalls = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: '/api/operacao/pontos-venda', headers: { cookie: provisionedOwnerCookie }, payload: { nome: 'Must not replace Principal' } })));
    assert.deepEqual(duplicateCalls.map((response) => response.statusCode), [409, 409], 'DONO cannot create another PDV, including concurrent retries');
    assert.deepEqual(plain({
      points: await db.pontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id }, orderBy: { id: 'asc' } }),
      configs: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: provisioned.cervejaria.id }, orderBy: { id: 'asc' } }),
    }), beforeDuplicate, 'duplicate attempts do not modify the existing PDV or its config');
    const beforeForeignPdvSelection = plain({
      primaryPoints: await db.pontoVenda.findMany({ where: { cervejariaId: primaryCompany.id }, orderBy: { id: 'asc' } }),
      primaryConfigs: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: primaryCompany.id }, orderBy: { id: 'asc' } }),
      secondPoints: await db.pontoVenda.findMany({ where: { cervejariaId: secondCompany.id }, orderBy: { id: 'asc' } }),
      secondConfigs: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: secondCompany.id }, orderBy: { id: 'asc' } }),
    });
    const foreignPdvSelection = await app.inject({ method: 'POST', url: '/api/operacao/pontos-venda', headers: { cookie: secondOwnerCookie }, payload: { nome: 'foreign write', cervejariaId: primaryCompany.id } });
    assert.equal(foreignPdvSelection.statusCode, 400, 'another tenant cannot select a target tenant in the PDV creation payload');
    assert.deepEqual(plain({
      primaryPoints: await db.pontoVenda.findMany({ where: { cervejariaId: primaryCompany.id }, orderBy: { id: 'asc' } }),
      primaryConfigs: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: primaryCompany.id }, orderBy: { id: 'asc' } }),
      secondPoints: await db.pontoVenda.findMany({ where: { cervejariaId: secondCompany.id }, orderBy: { id: 'asc' } }),
      secondConfigs: await db.configuracaoPontoVenda.findMany({ where: { cervejariaId: secondCompany.id }, orderBy: { id: 'asc' } }),
    }), beforeForeignPdvSelection, 'foreign-tenant selection leaves both tenants untouched');

    const failedEmail = `rollback-owner-${runId}@example.invalid`;
    const triggerName = `qa_fail_pdv_config_${runId}`.replaceAll(/[^a-zA-Z0-9_]/g, '_');
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION quiosque.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA injected canonical config failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON quiosque."ConfiguracaoPontoVenda" FOR EACH ROW EXECUTE FUNCTION quiosque.${triggerName}()`);
    let failedProvision;
    try {
      failedProvision = await app.inject({ method: 'POST', url: '/api/admin/cervejarias/provision', headers: { cookie: adminCookie }, payload: {
        nome: `Rollback tenant ${runId}`, dono: { nome: 'Rollback owner', email: failedEmail, senha: ownerPassword },
      } });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON quiosque."ConfiguracaoPontoVenda"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS quiosque.${triggerName}()`);
    }
    assert.equal(failedProvision.statusCode, 500, 'intermediate config failure propagates after the transaction rollback');
    assert.equal(await db.cervejaria.count({ where: { nome: `Rollback tenant ${runId}` } }), 0);
    assert.equal(await db.usuario.count({ where: { email: failedEmail } }), 0);
    assert.equal(await db.pontoVenda.count({ where: { cervejaria: { nome: `Rollback tenant ${runId}` } } }), 0);

    // One real RECEBIDO kitchen order exercises the effective setting through
    // create/recalculation, response summary, payment guard and persisted total.
    const kitchenProduct = await db.produto.create({ data: {
      id: `auth-kitchen-product-${runId}`, cervejariaId: secondCompany.id,
      pontoVendaId: secondPoint.id, nome: 'Synthetic prepared meal', tipo: 'COMIDA', exigePreparo: true,
      controlaEstoque: false,
    } });
    await db.preco.create({ data: { id: `auth-kitchen-price-${runId}`, produtoId: kitchenProduct.id, volumeMl: 1, preco: '10.00' } });
    await db.cardapioProduto.create({ data: {
      id: `auth-kitchen-menu-product-${runId}`, cardapioId: secondMenu.id,
      produtoId: kitchenProduct.id, pontoVendaId: secondPoint.id, volumeMl: 0, precoUnit: '10.00',
    } });
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    const kitchenCashOpened = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: secondOwnerCookie }, payload: { pontoVendaId: secondPoint.id, trocoInicial: 0, cardapioId: secondMenu.id } });
    assert.equal(kitchenCashOpened.statusCode, 201, `legacy-authority kitchen fixture opens cash: ${kitchenCashOpened.body}`);
    const kitchenSessionId = JSON.parse(kitchenCashOpened.body).id;
    const kitchenSettingProofs = [];
    const runKitchenSettingCase = async ({ name, activated, canonicalCharge, expectedTotal, expectedPending, paymentStatus }) => {
      if (activated) {
        process.env.PDV_CANONICAL_CONFIG_QA = '1';
        await db.configuracaoPontoVenda.update({ where: { pontoVendaId: secondPoint.id }, data: {
          kitchenEnabled: true,
          kitchenItemsChargeAtLaunch: canonicalCharge,
          allowCloseComandaWithPendingKitchenOrders: canonicalCharge,
        } });
      } else {
        delete process.env.PDV_CANONICAL_CONFIG_QA;
      }
      const openedCommand = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: { pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `${name}-${runId}` } });
      assert.equal(openedCommand.statusCode, 201, `${name}: command opens: ${openedCommand.body}`);
      const commandId = JSON.parse(openedCommand.body).id;
      const launched = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/pedidos`, headers: { cookie: secondOwnerCookie }, payload: { itens: [{ produtoId: kitchenProduct.id, quantidade: 1 }] } });
      assert.equal(launched.statusCode, 201, `${name}: pending kitchen order launches: ${launched.body}`);
      const launchBody = JSON.parse(launched.body);
      const kitchenOrderId = launchBody.pedidos[0].id;
      assert.deepEqual([launchBody.total, launchBody.valorEmAberto, launchBody.pedidos[0].status], [expectedTotal, expectedPending, 'RECEBIDO'], `${name}: API summary follows the selected configuration authority`);
      const persisted = await db.comanda.findUniqueOrThrow({ where: { id: commandId }, include: { pedidosOperacao: { include: { itensComanda: true } } } });
      assert.deepEqual([centsExact(persisted.total), persisted.pedidosOperacao[0].status, persisted.pedidosOperacao[0].itensComanda[0].quantidade, centsExact(persisted.pedidosOperacao[0].itensComanda[0].precoUnit)], [String(BigInt(expectedTotal * 100)), 'RECEBIDO', 1, '1000'], `${name}: response amount matches persisted total and exact item snapshot`);
      const detail = await app.inject({ method: 'GET', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}`, headers: { cookie: secondOwnerCookie } });
      assert.equal(detail.statusCode, 200, `${name}: detail query succeeds: ${detail.body}`);
      assert.deepEqual([JSON.parse(detail.body).total, JSON.parse(detail.body).valorEmAberto], [expectedTotal, expectedPending], `${name}: detail summary uses the same authority`);
      const payment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/pagamentos`, headers: { cookie: secondOwnerCookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 10 }] } });
      assert.equal(payment.statusCode, paymentStatus, `${name}: payment while order is still RECEBIDO: ${payment.body}`);
      const paymentRows = await db.pagamento.findMany({ where: { comandaId: commandId } });
      const commandAfterPayment = await db.comanda.findUniqueOrThrow({ where: { id: commandId } });
      if (paymentStatus === 200) {
        assert.deepEqual([centsExact(commandAfterPayment.total), commandAfterPayment.status, paymentRows.map((row) => [row.forma, centsExact(row.valor), row.sessaoCaixaId])], ['1000', 'FECHADA', [['PIX', '1000', kitchenSessionId]]], `${name}: one exact PIX payment is persisted against the open cash session`);
        for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
          const kitchenTransition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(kitchenOrderId)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status } });
          assert.equal(kitchenTransition.statusCode, 200, `${name}: paid order transitions to ${status} through the real kitchen route: ${kitchenTransition.body}`);
        }
      } else {
        assert.deepEqual([centsExact(commandAfterPayment.total), commandAfterPayment.status, paymentRows.length], [String(BigInt(expectedTotal * 100)), 'ABERTA', 0], `${name}: rejected payment leaves command and ledger unchanged`);
        const cancelled = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/cancelar`, headers: { cookie: secondOwnerCookie }, payload: {} });
        assert.equal(cancelled.statusCode, 200, `${name}: rejected-payment fixture is cancelled through the real route before cash close: ${cancelled.body}`);
        assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: commandId } })).status, 'CANCELADA');
        const cancellationConfirmed = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(kitchenOrderId)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status: 'CANCELADO' } });
        assert.equal(cancellationConfirmed.statusCode, 200, `${name}: terminal kitchen cancellation is confirmed through the real route: ${cancellationConfirmed.body}`);
      }
      kitchenSettingProofs.push({ name, activated, canonicalCharge, total: expectedTotal, pending: expectedPending, paymentStatus, itemStatus: persisted.pedidosOperacao[0].status });
    };

    // The configured legacy source says true/true while the synthetic PDV says
    // false/false. With activation absent, legacy remains authoritative.
    await runKitchenSettingCase({ name: 'legacy-disabled-activation', activated: false, canonicalCharge: false, expectedTotal: 10, expectedPending: 0, paymentStatus: 200 });
    await runKitchenSettingCase({ name: 'canonical-false', activated: true, canonicalCharge: false, expectedTotal: 0, expectedPending: 10, paymentStatus: 409 });
    await runKitchenSettingCase({ name: 'canonical-true', activated: true, canonicalCharge: true, expectedTotal: 10, expectedPending: 0, paymentStatus: 200 });
    process.env.PDV_CANONICAL_CONFIG_QA = '1';
    const independentProductResponse = await app.inject({ method: 'POST', url: '/api/operacao/produtos', headers: { cookie: secondOwnerCookie }, payload: {
      nome: 'Churrasquinho QA', categoria: 'Porções', tipo: 'COMIDA', formato: 'OUTRO', precoUnit: 10,
      precos: [{ volumeMl: 1, preco: 10 }], exigePreparo: true, prepararEmPedidoSeparado: true, controlaEstoque: true,
    } });
    assert.equal(independentProductResponse.statusCode, 201, `authenticated product create persists the independent-order flag: ${independentProductResponse.body}`);
    const independentProductId = JSON.parse(independentProductResponse.body).id;
    assert.equal((await db.produto.findUniqueOrThrow({ where: { id: independentProductId }, select: { prepararEmPedidoSeparado: true } })).prepararEmPedidoSeparado, true);
    const disableIndependentResponse = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${encodeURIComponent(independentProductId)}`, headers: { cookie: secondOwnerCookie }, payload: { prepararEmPedidoSeparado: false } });
    assert.equal(disableIndependentResponse.statusCode, 200, `product edit can clear the independent-order flag: ${disableIndependentResponse.body}`);
    const enableIndependentResponse = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${encodeURIComponent(independentProductId)}`, headers: { cookie: secondOwnerCookie }, payload: { prepararEmPedidoSeparado: true } });
    assert.equal(enableIndependentResponse.statusCode, 200, `product edit can enable the independent-order flag: ${enableIndependentResponse.body}`);
    const churrasquinho = await db.produto.findUniqueOrThrow({ where: { id: independentProductId }, select: { id: true, nome: true, exigePreparo: true, prepararEmPedidoSeparado: true, controlaEstoque: true } });
    const batata = await db.produto.create({ data: {
      id: `grouped-kitchen-${runId}`, cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id,
      nome: 'Batata QA', tipo: 'COMIDA', exigePreparo: true, prepararEmPedidoSeparado: false, controlaEstoque: true,
    } });
    const cebola = await db.produto.create({ data: {
      id: `grouped-kitchen-two-${runId}`, cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id,
      nome: 'Cebola QA', tipo: 'COMIDA', exigePreparo: true, prepararEmPedidoSeparado: false, controlaEstoque: true,
    } });
    await db.sessaoCaixaProdutoOperacao.createMany({ data: [churrasquinho, batata, cebola].map((product, index) => ({
      id: `independent-kitchen-session-${index}-${runId}`, sessaoCaixaId: kitchenSessionId, produtoId: product.id, volumeMl: 0,
    })) });
    for (const [index, product] of [churrasquinho, batata, cebola].entries()) {
      if (product.id !== churrasquinho.id) await db.preco.create({ data: { id: `independent-kitchen-price-${index}-${runId}`, produtoId: product.id, volumeMl: 1, preco: '10.00' } });
      await db.cardapioProduto.create({ data: { id: `independent-kitchen-menu-${index}-${runId}`, cardapioId: secondMenu.id, produtoId: product.id, pontoVendaId: secondPoint.id, volumeMl: 0, precoUnit: '10.00' } });
    }
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: secondPoint.id }, data: { inventoryEnabled: true, kitchenEnabled: true, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: true } });
    await db.inventoryBalance.createMany({ data: [churrasquinho, batata, cebola].map((product) => ({ cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id, produtoId: product.id, quantidade: 5 })) });
    const independentCommandResponse = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: {
      pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `independent-${runId}`,
      itens: [
        { produtoId: churrasquinho.id, quantidade: 1 },
        { produtoId: batata.id, quantidade: 1, prepararEmPedidoSeparado: true },
        { produtoId: cebola.id, quantidade: 1 },
      ],
    } });
    assert.equal(independentCommandResponse.statusCode, 201, `authenticated command with initial lines accepts independent preparation: ${independentCommandResponse.body}`);
    const independentCommand = JSON.parse(independentCommandResponse.body);
    assert.equal(independentCommand.pedidos.length, 2, 'one independent order plus one grouped order are returned');
    const independentStored = await db.comanda.findUniqueOrThrow({ where: { id: independentCommand.id }, include: { pedidosOperacao: { include: { itensComanda: true } } } });
    const independentKitchenOrder = independentStored.pedidosOperacao.find((order) => order.itensComanda.some((item) => item.produtoId === churrasquinho.id));
    const groupedKitchenOrder = independentStored.pedidosOperacao.find((order) => order.itensComanda.some((item) => item.produtoId === batata.id));
    assert.equal(independentStored.pedidosOperacao.length, 2, 'untrusted sale payload flag does not split an unmarked product');
    assert.deepEqual(groupedKitchenOrder.itensComanda.map((item) => item.produtoId).sort(), [batata.id, cebola.id].sort(), 'ordinary kitchen lines remain together');
    const outgoingMovements = await db.inventoryMovement.findMany({ where: { pedidoId: { in: [independentKitchenOrder?.id, groupedKitchenOrder?.id] }, tipo: 'SAIDA_VENDA' }, orderBy: { produtoId: 'asc' } });
    assert.deepEqual(outgoingMovements.map((movement) => [movement.produtoId, movement.pedidoId, movement.quantidade.toString()]), [
      [batata.id, groupedKitchenOrder?.id, '1'], [cebola.id, groupedKitchenOrder?.id, '1'], [churrasquinho.id, independentKitchenOrder?.id, '1'],
    ].sort((left, right) => left[0].localeCompare(right[0])), 'each line consumes stock once and records its owning kitchen order');
    const rollbackState = async () => plain({
      commands: await db.comanda.findMany({ where: { pontoVendaId: secondPoint.id }, orderBy: { id: 'asc' }, include: { itens: { orderBy: { id: 'asc' }, include: { opcionais: { orderBy: { id: 'asc' } } } }, pagamentos: { orderBy: { id: 'asc' } } } }),
      orders: await db.pedidoOperacao.findMany({ where: { pontoVendaId: secondPoint.id }, orderBy: [{ diaOperacional: 'asc' }, { numero: 'asc' }], include: { itensComanda: { orderBy: { id: 'asc' }, include: { opcionais: { orderBy: { id: 'asc' } } } }, historicoStatus: { orderBy: [{ registradoEm: 'asc' }, { id: 'asc' }] } } }),
      balances: await db.inventoryBalance.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id, cebola.id] } }, orderBy: { produtoId: 'asc' } }),
      movements: await db.inventoryMovement.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id, cebola.id] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    });
    const beforeInjectedFailure = await rollbackState();
    const independentFailureTrigger = `qa_fail_independent_order_${runId}`.replaceAll(/[^a-zA-Z0-9_]/g, '_');
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION public.${independentFailureTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."produtoId" = '${churrasquinho.id}' THEN RAISE EXCEPTION 'QA injected independent kitchen item failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${independentFailureTrigger} BEFORE INSERT ON public."ItemComanda" FOR EACH ROW EXECUTE FUNCTION public.${independentFailureTrigger}()`);
    let failedIndependentLaunch;
    try {
      failedIndependentLaunch = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: {
        pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `independent-rollback-${runId}`,
        itens: [{ produtoId: churrasquinho.id, quantidade: 1 }, { produtoId: batata.id, quantidade: 1 }, { produtoId: cebola.id, quantidade: 1 }],
      } });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${independentFailureTrigger} ON public."ItemComanda"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${independentFailureTrigger}()`);
    }
    assert.equal(failedIndependentLaunch.statusCode, 500, 'failure while building the second kitchen order fails the complete launch');
    assert.deepEqual(await rollbackState(), beforeInjectedFailure, 'injected launch failure leaves commands, orders, items, optional snapshots, histories, balances and stock movements identical');
    for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
      const transition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(independentKitchenOrder.id)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status } });
      assert.equal(transition.statusCode, 200, `independent kitchen order transitions to ${status}: ${transition.body}`);
    }
    const groupedBeforeCancel = await db.pedidoOperacao.findUniqueOrThrow({ where: { id: groupedKitchenOrder.id } });
    assert.equal(groupedBeforeCancel.status, 'RECEBIDO', 'delivering the independent brother does not advance the grouped brother');
    const independentAfterDelivery = await app.inject({ method: 'GET', url: `/api/operacao/comandas/${encodeURIComponent(independentCommand.id)}`, headers: { cookie: secondOwnerCookie } });
    assert.deepEqual([JSON.parse(independentAfterDelivery.body).total, JSON.parse(independentAfterDelivery.body).valorEmAberto], [10, 20], 'delivery charges only the independent order while its brother remains pending');
    for (const status of ['CANCELAMENTO_PENDENTE', 'CANCELADO']) {
      const transition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(groupedKitchenOrder.id)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status } });
      assert.equal(transition.statusCode, 200, `grouped brother cancels without changing the delivered independent order: ${transition.body}`);
    }
    assert.equal((await db.pedidoOperacao.findUniqueOrThrow({ where: { id: independentKitchenOrder.id } })).status, 'ENTREGUE');
    assert.deepEqual(await db.inventoryBalance.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id, cebola.id] } }, orderBy: { produtoId: 'asc' } }).then((rows) => rows.map((row) => [row.produtoId, row.quantidade.toString()])), [[batata.id, '5'], [cebola.id, '5'], [churrasquinho.id, '4']].sort((left, right) => left[0].localeCompare(right[0])), 'cancelling the grouped brother reverses only its two stock lines');
    const independentCommandPayment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(independentCommand.id)}/pagamentos`, headers: { cookie: secondOwnerCookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 10 }] } });
    assert.equal(independentCommandPayment.statusCode, 200, `only the delivered order is charged when the other order was cancelled: ${independentCommandPayment.body}`);
    const avulsaResponse = await app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: { cookie: secondOwnerCookie }, payload: {
      pontoVendaId: secondPoint.id, itens: [
        { produtoId: churrasquinho.id, quantidade: 1 }, { produtoId: batata.id, quantidade: 1 }, { produtoId: cebola.id, quantidade: 1 },
      ], pagamentos: [{ forma: 'PIX', valor: 30 }],
    } });
    assert.equal(avulsaResponse.statusCode, 201, `authenticated walk-up sale creates every kitchen order: ${avulsaResponse.body}`);
    const avulsaComanda = JSON.parse(avulsaResponse.body);
    assert.deepEqual([avulsaComanda.tipo, centsExact(avulsaComanda.total), avulsaComanda.pedidos.length], ['AVULSA', '3000', 2], 'walk-up response preserves the total and returns both kitchen orders');
    const avulsaOrderRows = await db.pedidoOperacao.findMany({ where: { comandaId: avulsaComanda.id }, include: { itensComanda: true } });
    assert.equal(avulsaOrderRows.length, 2, 'walk-up sale persists the split order collection');
    for (const walkUpOrder of avulsaOrderRows) for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
      const transition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(walkUpOrder.id)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status } });
      assert.equal(transition.statusCode, 200, `walk-up kitchen order ${walkUpOrder.id} transitions to ${status}: ${transition.body}`);
    }
    const postAvulsaBalance = await db.inventoryBalance.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id, cebola.id] } }, orderBy: { produtoId: 'asc' } });
    assert.deepEqual(postAvulsaBalance.map((row) => [row.produtoId, row.quantidade.toString()]), [[batata.id, '4'], [cebola.id, '4'], [churrasquinho.id, '3']].sort((left, right) => left[0].localeCompare(right[0])), 'walk-up sale consumes each stock line exactly once');
    const portalPhone = `119${runId.replaceAll(/\D/g, '').padEnd(8, '7').slice(0, 8)}`;
    const portalOpen = await app.inject({ method: 'POST', url: `/api/public/cervejarias/${encodeURIComponent(secondCompany.slug)}/pontos-venda/${encodeURIComponent(secondPoint.id)}/comandas`, payload: { nome: 'Portal QA customer', telefone: portalPhone } });
    assert.equal(portalOpen.statusCode, 201, `public PDV portal opens an authenticated customer session: ${portalOpen.body}`);
    const portalCookieHeader = String(portalOpen.headers['set-cookie'] ?? '').split(';')[0];
    assert.match(portalCookieHeader, /=.+/, 'portal response returns the customer session cookie');
    const portalLaunch = await app.inject({ method: 'POST', url: `/api/public/cervejarias/${encodeURIComponent(secondCompany.slug)}/pontos-venda/${encodeURIComponent(secondPoint.id)}/comanda/pedidos`, headers: { cookie: portalCookieHeader }, payload: {
      itens: [{ produtoId: churrasquinho.id, quantidade: 1 }, { produtoId: batata.id, quantidade: 1 }, { produtoId: cebola.id, quantidade: 1 }],
    } });
    assert.equal(portalLaunch.statusCode, 201, `portal launch creates all independent kitchen orders: ${portalLaunch.body}`);
    const portalComanda = JSON.parse(portalLaunch.body);
    assert.equal(portalComanda.pedidos.length, 2, 'portal response preserves all split kitchen orders');
    const portalOrders = await db.pedidoOperacao.findMany({ where: { comandaId: portalComanda.id }, include: { itensComanda: true } });
    assert.equal(portalOrders.length, 2, 'portal persists the marked line separately and keeps common lines grouped');
    assert.deepEqual(await db.inventoryBalance.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id, cebola.id] } }, orderBy: { produtoId: 'asc' } }).then((rows) => rows.map((row) => [row.produtoId, row.quantidade.toString()])), [[batata.id, '3'], [cebola.id, '3'], [churrasquinho.id, '2']].sort((left, right) => left[0].localeCompare(right[0])), 'portal consumes each product once under the order that owns its line');
    for (const portalOrder of portalOrders) for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
      const transition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(portalOrder.id)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status } });
      assert.equal(transition.statusCode, 200, `portal kitchen order ${portalOrder.id} transitions to ${status}: ${transition.body}`);
    }
    const portalPayment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(portalComanda.id)}/pagamentos`, headers: { cookie: secondOwnerCookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 30 }] } });
    assert.equal(portalPayment.statusCode, 200, `owner can settle the portal comanda through the existing payment flow: ${portalPayment.body}`);
    const snapshotStockSeed = await db.inventoryBalance.updateMany({
      where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id] } }, data: { quantidade: 20 },
    });
    assert.equal(snapshotStockSeed.count, 2, 'snapshot and concurrency fixtures start with sufficient isolated QA stock');

    const markedOptional = await db.opcional.create({ data: {
      id: `independent-snapshot-optional-marked-${runId}`, cervejariaId: secondCompany.id, nome: `Molho marcado ${runId}`, preco: '1.25',
      produtos: { create: [{ id: `independent-snapshot-link-marked-${runId}`, produtoId: churrasquinho.id, ordem: 1 }] },
    } });
    const commonOptional = await db.opcional.create({ data: {
      id: `independent-snapshot-optional-common-${runId}`, cervejariaId: secondCompany.id, nome: `Queijo comum ${runId}`, preco: '0.75',
      produtos: { create: [{ id: `independent-snapshot-link-common-${runId}`, produtoId: batata.id, ordem: 1 }] },
    } });
    const secondMarkedProduct = await db.produto.create({ data: {
      id: `independent-snapshot-marked-two-${runId}`, cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id,
      nome: 'Pastel QA marcado', tipo: 'COMIDA', exigePreparo: true, prepararEmPedidoSeparado: true, controlaEstoque: true,
    } });
    await db.preco.create({ data: { id: `independent-snapshot-marked-two-price-${runId}`, produtoId: secondMarkedProduct.id, volumeMl: 1, preco: '8.00' } });
    await db.sessaoCaixaProdutoOperacao.create({ data: { id: `independent-snapshot-marked-two-session-${runId}`, sessaoCaixaId: kitchenSessionId, produtoId: secondMarkedProduct.id, volumeMl: 0 } });
    await db.cardapioProduto.create({ data: { id: `independent-snapshot-marked-two-menu-${runId}`, cardapioId: secondMenu.id, produtoId: secondMarkedProduct.id, pontoVendaId: secondPoint.id, volumeMl: 0, precoUnit: '8.00' } });
    await db.inventoryBalance.create({ data: { cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id, produtoId: secondMarkedProduct.id, quantidade: 5 } });
    const snapshotLaunch = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: {
      pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `independent-snapshot-${runId}`,
      itens: [
        { produtoId: churrasquinho.id, quantidade: 3, paraViagem: true, observacao: 'marcado: molho separado', opcionais: [{ opcionalId: markedOptional.id, quantidade: 2 }] },
        { produtoId: secondMarkedProduct.id, quantidade: 1, paraViagem: false, observacao: 'marcado: borda crocante' },
        { produtoId: batata.id, quantidade: 3, paraViagem: false, observacao: 'comum: sem sal', opcionais: [{ opcionalId: commonOptional.id, quantidade: 1 }] },
      ],
    } });
    assert.equal(snapshotLaunch.statusCode, 201, `authenticated split launch preserves line snapshots: ${snapshotLaunch.body}`);
    const snapshotCommandId = JSON.parse(snapshotLaunch.body).id;
    const readSnapshotOrders = () => db.pedidoOperacao.findMany({
      where: { comandaId: snapshotCommandId }, orderBy: { numero: 'asc' },
      include: { itensComanda: { orderBy: { produtoId: 'asc' }, include: { opcionais: { orderBy: { nome: 'asc' } } } }, historicoStatus: { orderBy: { registradoEm: 'asc' } } },
    });
    const snapshotOrdersBeforeFlagEdit = await readSnapshotOrders();
    assert.equal(snapshotOrdersBeforeFlagEdit.length, 3, 'two marked lines each have their own order and the common line has one grouped order');
    const markedSnapshotOrder = snapshotOrdersBeforeFlagEdit.find((row) => row.itensComanda.some((item) => item.produtoId === churrasquinho.id));
    const secondMarkedSnapshotOrder = snapshotOrdersBeforeFlagEdit.find((row) => row.itensComanda.some((item) => item.produtoId === secondMarkedProduct.id));
    const commonSnapshotOrder = snapshotOrdersBeforeFlagEdit.find((row) => row.itensComanda.some((item) => item.produtoId === batata.id));
    assert(markedSnapshotOrder && secondMarkedSnapshotOrder && commonSnapshotOrder && new Set([markedSnapshotOrder.id, secondMarkedSnapshotOrder.id, commonSnapshotOrder.id]).size === 3, 'each marked line is independent and the common line is grouped separately');
    const markedSnapshotItem = markedSnapshotOrder.itensComanda.find((item) => item.produtoId === churrasquinho.id);
    const commonSnapshotItem = commonSnapshotOrder.itensComanda.find((item) => item.produtoId === batata.id);
    assert.deepEqual([markedSnapshotItem?.quantidade, markedSnapshotItem?.nome, markedSnapshotItem?.precoUnit.toString(), markedSnapshotItem?.volumeMl, markedSnapshotItem?.observacao, markedSnapshotItem?.paraViagem, markedSnapshotItem?.pedidoCozinhaId], [3, 'Churrasquinho QA', '10', 0, 'marcado: molho separado', true, markedSnapshotOrder.id], 'marked item retains exact quantity, product/value/volume, note, take-away and order link');
    assert.deepEqual([commonSnapshotItem?.quantidade, commonSnapshotItem?.nome, commonSnapshotItem?.precoUnit.toString(), commonSnapshotItem?.volumeMl, commonSnapshotItem?.observacao, commonSnapshotItem?.paraViagem, commonSnapshotItem?.pedidoCozinhaId], [3, 'Batata QA', '10', 0, 'comum: sem sal', false, commonSnapshotOrder.id], 'common item retains exact quantity, product/value/volume, note, take-away and order link');
    assert.deepEqual(secondMarkedSnapshotOrder.itensComanda.map((item) => [item.produtoId, item.quantidade, item.precoUnit.toString(), item.volumeMl, item.observacao, item.paraViagem, item.pedidoCozinhaId]), [[secondMarkedProduct.id, 1, '8', 0, 'marcado: borda crocante', false, secondMarkedSnapshotOrder.id]], 'second marked line also retains its exact item snapshot and independent parent link');
    assert.deepEqual(markedSnapshotItem.opcionais.map((row) => [row.nome, row.precoAdicional.toString(), row.quantidade]), [[markedOptional.nome, '1.25', 2]], 'marked line stores optional name, price and quantity snapshot');
    assert.deepEqual(commonSnapshotItem.opcionais.map((row) => [row.nome, row.precoAdicional.toString(), row.quantidade]), [[commonOptional.nome, '0.75', 1]], 'common line stores its distinct optional snapshot');
    assert.equal(markedSnapshotOrder.paraViagem, true, 'marked order derives take-away from its line');
    assert.equal(secondMarkedSnapshotOrder.paraViagem, false, 'second marked order preserves its own take-away value');
    assert.equal(commonSnapshotOrder.paraViagem, false, 'common order keeps its own take-away value');
    const disableFlagAfterLaunch = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${encodeURIComponent(churrasquinho.id)}`, headers: { cookie: secondOwnerCookie }, payload: { prepararEmPedidoSeparado: false } });
    assert.equal(disableFlagAfterLaunch.statusCode, 200, `product flag can change after the sale: ${disableFlagAfterLaunch.body}`);
    assert.deepEqual(plain(await readSnapshotOrders()), plain(snapshotOrdersBeforeFlagEdit), 'editing the product flag does not repartition or mutate existing order/item/optional/history snapshots');
    const restoreFlagAfterLaunch = await app.inject({ method: 'PUT', url: `/api/operacao/produtos/${encodeURIComponent(churrasquinho.id)}`, headers: { cookie: secondOwnerCookie }, payload: { prepararEmPedidoSeparado: true } });
    assert.equal(restoreFlagAfterLaunch.statusCode, 200, `test fixture restores product flag for later sale proofs: ${restoreFlagAfterLaunch.body}`);

    const { diaOperacional } = await import('../src/lib/operacao/venda.ts');
    const launchDay = diaOperacional();
    const launchDayText = launchDay.toISOString().slice(0, 10);
    const concurrentSaleLockDigest = createHash('sha256').update(`caixa-operacao:${secondCompany.id}:${secondPoint.id}:${launchDayText}`).digest();
    const splitSaleCashLockKey = BigInt.asIntN(64, concurrentSaleLockDigest.readBigUInt64BE(0));
    let signalSplitSaleCashLock;
    let releaseSplitSaleCashLock;
    const splitSaleCashLockHeld = new Promise((resolve) => { signalSplitSaleCashLock = resolve; });
    const splitSaleCashLockRelease = new Promise((resolve) => { releaseSplitSaleCashLock = resolve; });
    const balancesBeforeConcurrentLaunches = await db.inventoryBalance.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id] } }, orderBy: { produtoId: 'asc' } });
    const splitSaleCashLockHolder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${splitSaleCashLockKey})`;
      signalSplitSaleCashLock();
      await splitSaleCashLockRelease;
    }, { maxWait: 15000, timeout: 30000 });
    await splitSaleCashLockHeld;
    const concurrentLaunches = Promise.all(['a', 'b'].map((suffix) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: {
      pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `independent-concurrent-${suffix}-${runId}`,
      itens: [{ produtoId: churrasquinho.id, quantidade: 1 }, { produtoId: batata.id, quantidade: 1 }],
    } })));
    let splitSaleCashLockWaiters = 0;
    const splitSaleCashLockDeadline = process.hrtime.bigint() + 15_000_000_000n;
    try {
      while (process.hrtime.bigint() < splitSaleCashLockDeadline) {
        const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory' AND query ILIKE '%pg_advisory_xact_lock%'`;
        splitSaleCashLockWaiters = rows[0]?.count ?? 0;
        if (splitSaleCashLockWaiters >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert(splitSaleCashLockWaiters >= 2, `both split-launch API calls are observable waiting on PostgreSQL cash lock; waiters=${splitSaleCashLockWaiters}`);
    } finally {
      releaseSplitSaleCashLock();
      await splitSaleCashLockHolder;
    }
    const concurrentLaunchResponses = await concurrentLaunches;
    assert(concurrentLaunchResponses.every((response) => response.statusCode === 201), `both concurrent split launches succeed: ${concurrentLaunchResponses.map((response) => response.statusCode)}`);
    const concurrentCommandIds = concurrentLaunchResponses.map((response) => JSON.parse(response.body).id);
    const concurrentOrders = await db.pedidoOperacao.findMany({ where: { comandaId: { in: concurrentCommandIds } }, include: { itensComanda: true }, orderBy: { numero: 'asc' } });
    assert.equal(concurrentOrders.length, 4, 'two concurrent launches persist exactly two kitchen orders each');
    assert.equal(new Set(concurrentOrders.map((order) => `${order.diaOperacional.toISOString().slice(0, 10)}:${order.numero}`)).size, 4, 'all concurrent split orders receive unique daily numbers');
    for (const commandId of concurrentCommandIds) {
      const orders = concurrentOrders.filter((order) => order.comandaId === commandId);
      assert.equal(orders.length, 2, 'each concurrent comanda owns the independent and grouped kitchen order');
      assert.equal(orders.reduce((count, order) => count + order.itensComanda.length, 0), 2, 'each concurrent comanda persists exactly its two source lines');
    }
    const concurrentMovements = await db.inventoryMovement.findMany({ where: { pedidoId: { in: concurrentOrders.map((order) => order.id) }, tipo: 'SAIDA_VENDA' }, orderBy: [{ produtoId: 'asc' }, { pedidoId: 'asc' }] });
    assert.deepEqual(concurrentMovements.map((movement) => [movement.produtoId, movement.quantidade.toString()]).sort(), [[batata.id, '1'], [batata.id, '1'], [churrasquinho.id, '1'], [churrasquinho.id, '1']].sort(), 'stock is consumed once per source line across both concurrent launches');
    const balancesAfterConcurrentLaunches = await db.inventoryBalance.findMany({ where: { pontoVendaId: secondPoint.id, produtoId: { in: [churrasquinho.id, batata.id] } }, orderBy: { produtoId: 'asc' } });
    assert.deepEqual(balancesAfterConcurrentLaunches.map((row, index) => [row.produtoId, row.quantidade.toString(), balancesBeforeConcurrentLaunches[index]?.quantidade.sub(2).toString()]), balancesAfterConcurrentLaunches.map((row) => [row.produtoId, row.quantidade.toString(), row.quantidade.toString()]), 'each concurrent source line reduces its product balance by exactly two units total');

    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: secondPoint.id }, data: canonicalSettings });

    const canonicalContexts = [];
    for (const [company, expectedQuantity] of [[primaryCompany, 8], [secondCompany, 9]]) {
      const response = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: { cookie: company.id === primaryCompany.id ? ownerCookie : secondOwnerCookie } });
      assert.equal(response.statusCode, 200, `canonical operational context resolves for tenant ${company.id}: ${response.body}`);
      const context = JSON.parse(response.body);
      assert.deepEqual([
        context.operationMode, context.plannedOperationsEnabled, context.cashRegisterEnabled,
        context.tapsEnabled, context.inventoryEnabled, context.kitchenEnabled,
        context.kitchenItemsChargeAtLaunch, context.allowCloseComandaWithPendingKitchenOrders,
        context.whatsappPedidoProntoEnabled, context.quantidadeMesas, context.operationalSettingsSource,
      ], ['CAIXA', false, true, false, false, false, false, false, false, expectedQuantity, 'CANONICAL_PDV'], 'legacy EVENTO/capability values do not override canonical PDV settings');
      canonicalContexts.push({ tenantId: company.id, mode: context.operationMode, source: context.operationalSettingsSource, inventory: context.inventoryEnabled, kitchen: context.kitchenEnabled, tables: context.quantidadeMesas });
    }

    const blockedFootprint = async (tenantId) => ({
      points: await db.pontoVenda.count({ where: { cervejariaId: tenantId } }),
      configs: await db.configuracaoPontoVenda.count({ where: { cervejariaId: tenantId } }),
      sessions: await db.sessaoCaixaOperacao.count({ where: { cervejariaId: tenantId } }),
      commands: await db.comanda.count({ where: { OR: [{ pontoVenda: { cervejariaId: tenantId } }, { evento: { cervejariaId: tenantId } }] } }),
      items: await db.itemComanda.count({ where: { comanda: { OR: [{ pontoVenda: { cervejariaId: tenantId } }, { evento: { cervejariaId: tenantId } }] } } }),
      payments: await db.pagamento.count({ where: { comanda: { OR: [{ pontoVenda: { cervejariaId: tenantId } }, { evento: { cervejariaId: tenantId } }] } } }),
    });
    for (const fixture of blockerFixtures) {
      const cookie = await login(fixture.user.email, fixture.password, 'DONO');
      const before = await blockedFootprint(fixture.tenant.id);
      const response = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: { cookie } });
      assert.equal(response.statusCode, 409, `${fixture.name} blocks the canonical context: ${response.body}`);
      assert.equal(JSON.parse(response.body).code, fixture.expectedCode, `${fixture.name} returns a specific canonical configuration blocker`);
      const configRead = await app.inject({ method: 'GET', url: '/api/cervejaria/configuracao-operacional', headers: { cookie } });
      assert.equal(configRead.statusCode, 409, `${fixture.name} also blocks operational config reads: ${configRead.body}`);
      assert.equal(JSON.parse(configRead.body).code, fixture.expectedCode);
      const configWrite = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie }, payload: { tapsEnabled: false } });
      assert.equal(configWrite.statusCode, 409, `${fixture.name} cannot provision config through PATCH: ${configWrite.body}`);
      assert.equal(JSON.parse(configWrite.body).code, fixture.expectedCode);
      assert.deepEqual(await blockedFootprint(fixture.tenant.id), before, `${fixture.name} does not create or change a PDV/configuration/session/command/item/payment`);
    }

    const beforeAttendantDenial = await counts();
    const attendantOwnerOnly = await app.inject({ method: 'POST', url: '/api/operacao/pontos-venda', headers: { cookie: attendantCookie }, payload: { nome: `forbidden-${runId}` } });
    assert.equal(attendantOwnerOnly.statusCode, 403, 'ATENDENTE is denied by the real requireDono guard');
    await assertNoApiWrites(beforeAttendantDenial, 'ATENDENTE owner-only request');

    const beforeCrossTenant = await counts();
    const foreignRead = await app.inject({ method: 'GET', url: `/api/operacao/caixa/cardapio?pontoVendaId=${encodeURIComponent(primaryPoint.id)}`, headers: { cookie: secondOwnerCookie } });
    assert.equal(foreignRead.statusCode, 404, 'second tenant cannot read the primary tenant cash register by PDV ID');
    const foreignWrite = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: { pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: `foreign-${runId}` } });
    assert.equal(foreignWrite.statusCode, 404, 'second tenant cannot create a command against the primary tenant PDV');
    await assertNoApiWrites(beforeCrossTenant, 'cross-tenant read/write attempts');

    const operationFlows = [];
    for (const flow of [
      { company: primaryCompany, point: primaryPoint, menu: menuA, product, owner: authOwner, cookie: ownerCookie, priceCents: '950' },
      { company: secondCompany, point: secondPoint, menu: secondMenu, product: secondProduct, owner: secondOwner, cookie: secondOwnerCookie, priceCents: '400' },
    ]) {
      const totalCents = (BigInt(flow.priceCents) * 2n).toString();
      const total = Number(totalCents) / 100;
      const dashboardPeriod = new Date();
      const dashboardUrl = `/api/operacao/dashboard?ano=${dashboardPeriod.getFullYear()}&mes=${dashboardPeriod.getMonth() + 1}&pontoVendaId=${encodeURIComponent(flow.point.id)}`;
      const dashboardBefore = await app.inject({ method: 'GET', url: dashboardUrl, headers: { cookie: flow.cookie } });
      assert.equal(dashboardBefore.statusCode, 200, `authenticated dashboard baseline for ${flow.company.id}`);
      const totalReceivedBefore = JSON.parse(dashboardBefore.body).resumo.totalRecebido;
      const opened = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: flow.cookie }, payload: { pontoVendaId: flow.point.id, trocoInicial: 5, cardapioId: flow.menu.id } });
      assert.equal(opened.statusCode, 201, `authenticated cash opens for ${flow.company.id}: ${opened.body}`);
      const openedBody = JSON.parse(opened.body);
      assert.deepEqual([openedBody.pontoVendaId, openedBody.status], [flow.point.id, 'ABERTO']);
      assert.equal(openedBody.ocorrenciaId ?? null, null, 'cash with no explicit occurrence remains unassigned');
      const session = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: openedBody.id } });
      assert.deepEqual([session.cervejariaId, session.pontoVendaId, session.cardapioId, session.abertoPorId, session.status, centsExact(session.trocoInicial)], [flow.company.id, flow.point.id, flow.menu.id, flow.owner.id, 'ABERTO', '500']);

      const menuResponse = await app.inject({ method: 'GET', url: `/api/operacao/caixa/cardapio?pontoVendaId=${encodeURIComponent(flow.point.id)}`, headers: { cookie: flow.cookie } });
      assert.equal(menuResponse.statusCode, 200, `turn menu is returned for ${flow.company.id}: ${menuResponse.body}`);
      const menuView = JSON.parse(menuResponse.body);
      assert.equal(menuView.cardapioId, flow.menu.id);
      const menuProduct = menuView.produtos.find((row) => row.id === flow.product.id && row.volumeMl === 0);
      assert(menuProduct, 'selected menu exposes the migrated unit product');
      assert.equal(centsExact(menuProduct.precoUnit), flow.priceCents);

      const stockBeforeSale = plain({
        balances: await db.inventoryBalance.findMany({ where: { cervejariaId: flow.company.id, produtoId: flow.product.id }, orderBy: { id: 'asc' } }),
        movements: await db.inventoryMovement.findMany({ where: { cervejariaId: flow.company.id, produtoId: flow.product.id }, orderBy: { id: 'asc' } }),
      });
      const openedCommand = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: flow.cookie }, payload: { pontoVendaId: flow.point.id, tipo: 'APELIDO', identificador: `auth-sale-${flow.company.id}-${runId}` } });
      assert.equal(openedCommand.statusCode, 201, `command opens for ${flow.company.id}: ${openedCommand.body}`);
      assert.equal(JSON.parse(openedCommand.body).ocorrenciaId ?? null, null, 'new command inherits the session absence of occurrence');
      const commandId = JSON.parse(openedCommand.body).id;
      const launched = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/pedidos`, headers: { cookie: flow.cookie }, payload: { itens: [{ produtoId: flow.product.id, quantidade: 2 }] } });
      assert.equal(launched.statusCode, 201, `product is launched for ${flow.company.id}: ${launched.body}`);
      assert.equal(centsExact(JSON.parse(launched.body).total), totalCents);
      const commandAfterLaunch = await db.comanda.findUniqueOrThrow({ where: { id: commandId }, include: { itens: true } });
      assert.deepEqual([commandAfterLaunch.status, commandAfterLaunch.origem, commandAfterLaunch.pontoVendaId, commandAfterLaunch.diaOperacional.toISOString().slice(0, 10), centsExact(commandAfterLaunch.total), commandAfterLaunch.itens.length], ['ABERTA', 'CAIXA', flow.point.id, session.diaOperacional.toISOString().slice(0, 10), totalCents, 1]);
      assert.deepEqual([commandAfterLaunch.itens[0].produtoId, commandAfterLaunch.itens[0].volumeMl, commandAfterLaunch.itens[0].quantidade, centsExact(commandAfterLaunch.itens[0].precoUnit), commandAfterLaunch.itens[0].nome], [flow.product.id, 0, 2, flow.priceCents, flow.product.nome], 'real API snapshots selected menu price into sold item');
      assert.deepEqual(plain({
        balances: await db.inventoryBalance.findMany({ where: { cervejariaId: flow.company.id, produtoId: flow.product.id }, orderBy: { id: 'asc' } }),
        movements: await db.inventoryMovement.findMany({ where: { cervejariaId: flow.company.id, produtoId: flow.product.id }, orderBy: { id: 'asc' } }),
      }), stockBeforeSale, 'canonical inventory=false prevents legacy inventory=true from changing stock rows');

      const paid = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/pagamentos`, headers: { cookie: flow.cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: total }] } });
      assert.equal(paid.statusCode, 200, `PIX payment succeeds for ${flow.company.id}: ${paid.body}`);
      assert.equal(centsExact(JSON.parse(paid.body).total), totalCents);
      const paidCommand = await db.comanda.findUniqueOrThrow({ where: { id: commandId }, include: { itens: true, pagamentos: true } });
      assert.equal(paidCommand.status, 'FECHADA');
      assert.equal(paidCommand.sessaoCaixaRealizacaoId, session.id, 'immediate sale records its exact realization session once');
      assert.deepEqual(paidCommand.pagamentos.map((payment) => [payment.forma, centsExact(payment.valor), payment.sessaoCaixaId, payment.sessaoCaixaEventoId, payment.registradoPorId]), [['PIX', totalCents, session.id, null, flow.owner.id]]);

      const closed = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: flow.cookie }, payload: { pontoVendaId: flow.point.id, contadoDinheiro: 5, contadoPix: total, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
      assert.equal(closed.statusCode, 200, `cash close succeeds for ${flow.company.id}: ${closed.body}`);
      const persistedSession = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: session.id } });
      assert.deepEqual([persistedSession.status, persistedSession.fechadoPorId, centsExact(persistedSession.trocoInicial), centsExact(persistedSession.contadoDinheiro), centsExact(persistedSession.contadoPix), centsExact(persistedSession.contadoCartaoDebito), centsExact(persistedSession.contadoCartaoCredito)], ['FECHADO', flow.owner.id, '500', '500', totalCents, '0', '0']);
      const sessionReport = await app.inject({ method: 'GET', url: `/api/operacao/caixa/sessoes/${encodeURIComponent(session.id)}`, headers: { cookie: flow.cookie } });
      assert.equal(sessionReport.statusCode, 200, `authenticated session report returns for ${flow.company.id}: ${sessionReport.body}`);
      assert.equal(centsExact(JSON.parse(sessionReport.body).caixa.esperado.totalVendas), totalCents, 'session report totals exact persisted payments');
      const dashboardAfter = await app.inject({ method: 'GET', url: dashboardUrl, headers: { cookie: flow.cookie } });
      assert.equal(dashboardAfter.statusCode, 200);
      assert.equal(centsExact(JSON.parse(dashboardAfter.body).resumo.totalRecebido - totalReceivedBefore), totalCents, 'dashboard total received includes this payment exactly once');
      const recentTurn = JSON.parse(dashboardAfter.body).turnosRecentes.find((row) => row.sessaoId === session.id);
      assert.equal(centsExact(recentTurn.totalRecebido), totalCents, 'dashboard session total follows the persisted session link');
      assert.equal(await db.itemComandaOpcional.count({ where: { itemComanda: { comandaId: commandId } } }), 0);
      operationFlows.push({ tenantId: flow.company.id, sessionId: session.id, commandId, productId: flow.product.id, menuId: flow.menu.id, itemPriceCents: flow.priceCents, quantity: 2, totalCents, payment: `PIX:${totalCents}`, sessionStatus: persistedSession.status, endpoints: [opened.statusCode, menuResponse.statusCode, openedCommand.statusCode, launched.statusCode, paid.statusCode, closed.statusCode] });
    }
    const secondTenantSessionId = operationFlows.find((flow) => flow.tenantId === secondCompany.id).sessionId;
    await assert.rejects(db.comanda.create({ data: {
      id: `cross-tenant-sale-session-${runId}`, origem: 'CAIXA', pontoVendaId: primaryPoint.id, sessaoCaixaRealizacaoId: secondTenantSessionId,
      status: 'FECHADA', tipo: 'COMANDA', total: '1.00', fechadaEm: new Date(),
    } }), (error) => error.code === 'P2003', 'sale realization session must match the command PDV and tenant');

    // A new debt sale must retain the exact session in which the sale was closed, even when unpaid.
    const pendingClient = await db.cliente.create({ data: { id: `turn-pending-client-${runId}`, cervejariaId: primaryCompany.id, nome: 'QA pending turn client', telefone: `118${String(Date.now()).slice(-8)}` } });
    const pendingSessionResponse = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: ownerCookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id } });
    assert.equal(pendingSessionResponse.statusCode, 201, `pending sale session opens: ${pendingSessionResponse.body}`);
    const pendingSessionId = JSON.parse(pendingSessionResponse.body).id;
    const pendingCommandResponse = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: ownerCookie }, payload: { pontoVendaId: primaryPoint.id, clienteId: pendingClient.id, tipo: 'APELIDO', identificador: `pending-turn-${runId}` } });
    assert.equal(pendingCommandResponse.statusCode, 201, `pending sale command opens: ${pendingCommandResponse.body}`);
    const pendingCommandId = JSON.parse(pendingCommandResponse.body).id;
    const pendingOrderResponse = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(pendingCommandId)}/pedidos`, headers: { cookie: ownerCookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } });
    assert.equal(pendingOrderResponse.statusCode, 201, `pending sale item launches: ${pendingOrderResponse.body}`);
    const pendingSaleResponse = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(pendingCommandId)}/pagamentos`, headers: { cookie: ownerCookie }, payload: { deixarPendente: true, pagamentos: [] } });
    assert.equal(pendingSaleResponse.statusCode, 200, `sale is left pending through the authenticated close route: ${pendingSaleResponse.body}`);
    assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: pendingCommandId } })).sessaoCaixaRealizacaoId, pendingSessionId, 'new pending sale captures its realization cash session');
    const pendingSessionClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: ownerCookie }, payload: { pontoVendaId: primaryPoint.id, contadoDinheiro: 0, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
    assert.equal(pendingSessionClose.statusCode, 200, `pending-sale session closes: ${pendingSessionClose.body}`);
    const debtDashboardPeriod = new Date();
    const debtDashboardUrl = `/api/operacao/dashboard?ano=${debtDashboardPeriod.getFullYear()}&mes=${debtDashboardPeriod.getMonth() + 1}&pontoVendaId=${encodeURIComponent(primaryPoint.id)}`;
    const pendingTurnDashboard = await app.inject({ method: 'GET', url: debtDashboardUrl, headers: { cookie: ownerCookie } });
    assert.equal(pendingTurnDashboard.statusCode, 200);
    const pendingTurn = JSON.parse(pendingTurnDashboard.body).turnosRecentes.find((row) => row.sessaoId === pendingSessionId);
    assert(pendingTurn, 'a turn with a pending sale remains visible as an operational turn');
    assert.equal(centsExact(pendingTurn.receitaTotal), centsExact(JSON.parse(pendingSaleResponse.body).total), 'pending principal remains reported as sale revenue in its original turn');
    assert.equal(centsExact(pendingTurn.totalRecebido), '0', 'pending principal is not reported as cash received');

    // Isolated authenticated-API reproduction for a sale paid through two debt receipts.
    const debtSessionIds = [];
    const debtClient = await db.cliente.create({ data: { id: `turn-debt-client-${runId}`, cervejariaId: primaryCompany.id, nome: 'QA turn debt client', telefone: `119${String(Date.now()).slice(-8)}` } });
    const debtCommand = await db.comanda.create({ data: {
      id: `turn-debt-command-${runId}`, origem: 'CAIXA', pontoVendaId: primaryPoint.id, diaOperacional: new Date(),
      clienteId: debtClient.id, sessaoCaixaRealizacaoId: null, status: 'FECHADA', tipo: 'COMANDA', total: '100.00', fechadaEm: new Date(), fechadoPorId: authOwner.id,
    } });
    const debtAccount = await db.contaReceber.create({ data: { id: `turn-debt-account-${runId}`, comandaId: debtCommand.id, clienteId: debtClient.id, valorOriginal: '100.00', criadoPorId: authOwner.id } });
    const receiptCentsBySession = [['4000'], ['5000', '1000']];
    for (let index = 0; index < receiptCentsBySession.length; index++) {
      const openedDebtSession = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: ownerCookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id } });
      assert.equal(openedDebtSession.statusCode, 201, `debt receipt session ${index + 1} opens: ${openedDebtSession.body}`);
      const debtSessionId = JSON.parse(openedDebtSession.body).id;
      debtSessionIds.push(debtSessionId);
      if (index === 0) await db.comanda.update({ where: { id: debtCommand.id }, data: { sessaoCaixaRealizacaoId: debtSessionId } });
      for (const cents of receiptCentsBySession[index]) {
        const receipt = await app.inject({ method: 'POST', url: `/api/operacao/contas-pendentes/${encodeURIComponent(debtAccount.id)}/pagamentos`, headers: { cookie: ownerCookie }, payload: { pontoVendaId: primaryPoint.id, pagamentos: [{ forma: 'PIX', valor: Number(cents) / 100 }] } });
        assert.equal(receipt.statusCode, 200, `authenticated debt receipt ${cents} is collected in session ${index + 1}: ${receipt.body}`);
        assert.equal(JSON.parse(receipt.body).id, debtAccount.id, 'authenticated receipt response identifies the account that received funds');
        const persistedReceipt = await db.pagamento.findMany({ where: { contaReceberId: debtAccount.id, sessaoCaixaId: debtSessionId }, orderBy: { pagoEm: 'asc' } });
        assert.equal(persistedReceipt.reduce((sum, row) => sum + Number(centsExact(row.valor)), 0), receiptCentsBySession[index].slice(0, receiptCentsBySession[index].indexOf(cents) + 1).reduce((sum, value) => sum + Number(value), 0), 'database persists only the exact receipts collected in this session');
      }
      const sessionTotal = receiptCentsBySession[index].reduce((sum, value) => sum + Number(value), 0);
      const closedDebtSession = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: ownerCookie }, payload: { pontoVendaId: primaryPoint.id, contadoDinheiro: 0, contadoPix: sessionTotal / 100, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
      assert.equal(closedDebtSession.statusCode, 200, `debt receipt session ${index + 1} closes: ${closedDebtSession.body}`);
    }
    const debtTurnDashboard = await app.inject({ method: 'GET', url: debtDashboardUrl, headers: { cookie: ownerCookie } });
    assert.equal(debtTurnDashboard.statusCode, 200, `authenticated turn report returns for debt receipts: ${debtTurnDashboard.body}`);
    const debtTurns = JSON.parse(debtTurnDashboard.body).turnosRecentes.filter((row) => debtSessionIds.includes(row.sessaoId));
    assert.equal(debtTurns.length, 2);
    assert.deepEqual(debtTurns.map((row) => centsExact(row.receitaTotal)), ['10000', '0'], 'sale principal appears once in its explicit realization session, never in debt receipt sessions');
    assert.deepEqual(debtTurns.map((row) => centsExact(row.totalRecebido)), ['4000', '6000'], 'received totals follow each actual debt receipt');
    assert.equal((await db.contaReceber.findUniqueOrThrow({ where: { id: debtAccount.id }, include: { pagamentos: true } })).pagamentos.reduce((sum, payment) => sum + Number(centsExact(payment.valor)), 0), 10000, 'partial debt receipts in two sessions fully settle the original principal');
    operationFlows.push({ debtTurnCertification: 'PASS; authenticated API separates realization revenue from debt receipts', saleCents: '10000', receiptsBySessionCents: ['4000', '5000', '1000'], revenueBySessionCents: debtTurns.map((row) => centsExact(row.receitaTotal)), pendingSaleSessionId: pendingSessionId });

    const immediateWithoutSessionCommandId = `authenticated-no-session-command-${runId}`;
    await db.comanda.create({ data: {
      id: immediateWithoutSessionCommandId, origem: 'CAIXA', pontoVendaId: primaryPoint.id,
      diaOperacional: new Date('2026-10-06T00:00:00.000Z'), status: 'ABERTA', tipo: 'COMANDA', total: '1.00',
    } });
    const noSessionItem = await db.itemComanda.create({ data: { id: `authenticated-no-session-item-${runId}`, comandaId: immediateWithoutSessionCommandId, produtoId: product.id, volumeMl: 0, quantidade: 1, precoUnit: '1.00', nome: 'QA session guard item' } });
    const noSessionOperationalPhoto = async () => plain({
      command: await db.comanda.findUniqueOrThrow({ where: { id: immediateWithoutSessionCommandId }, include: { itens: true, pagamentos: true, contaReceber: true } }),
      audits: await db.transacaoLog.findMany({ where: { cervejariaId: primaryCompany.id, comandaId: immediateWithoutSessionCommandId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    });
    const noSessionPhotoBefore = await noSessionOperationalPhoto();
    const auditCountBefore = noSessionPhotoBefore.audits.filter((row) => row.tipo === 'SALE_PAYMENT_RECORDED').length;
    const rejectedNoSessionPayment = await withQaDate('2026-10-06', () => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(immediateWithoutSessionCommandId)}/pagamentos`, headers: { cookie: ownerCookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 1 }] } }));
    assert.equal(rejectedNoSessionPayment.statusCode, 400, `new immediate payment without a valid open session is refused: ${rejectedNoSessionPayment.body}`);
    const noSessionPhotoAfter = await noSessionOperationalPhoto();
    assert.deepEqual(noSessionPhotoAfter, noSessionPhotoBefore, 'no-session refusal leaves command, items, payments, totals, states, timestamps and relevant audit exactly unchanged');
    assert.equal(noSessionPhotoAfter.command.pagamentos.length, 0, 'no-session refusal creates no payment');
    assert.equal(noSessionPhotoAfter.audits.filter((row) => row.tipo === 'SALE_PAYMENT_RECORDED').length, auditCountBefore, 'no-session refusal creates no payment audit');
    const cleanupNoSessionCommand = await withQaDate('2026-10-06', () => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(immediateWithoutSessionCommandId)}/cancelar`, headers: { cookie: ownerCookie }, payload: {} }));
    assert.equal(cleanupNoSessionCommand.statusCode, 200, `rejected-payment fixture is cancelled through the real route: ${cleanupNoSessionCommand.body}`);
    assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: immediateWithoutSessionCommandId } })).status, 'CANCELADA');

    const settingState = async (tenantId, pointId) => plain({
      canonical: await db.configuracaoPontoVenda.findUnique({ where: { pontoVendaId: pointId } }),
      legacy: await db.configuracaoOperacional.findUnique({ where: { cervejariaId: tenantId } }),
      module: await db.configuracaoOperacao.findUnique({ where: { cervejariaId: tenantId } }),
    });
    const settingsApiProofs = [];
    const ownerConfigRead = await app.inject({ method: 'GET', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: ownerCookie } });
    assert.equal(ownerConfigRead.statusCode, 200, `owner reads effective canonical configuration: ${ownerConfigRead.body}`);
    const ownerConfigResponse = JSON.parse(ownerConfigRead.body);
    const ownerConfigView = ownerConfigResponse.configuration;
    assert.deepEqual([ownerConfigView.configurationSource, ownerConfigView.plannedOperationsEnabled, ownerConfigView.tapsEnabled, ownerConfigView.inventoryEnabled, ownerConfigView.quantidadeMesas], ['CANONICAL_PDV', false, false, false, 8]);
    assert.deepEqual(ownerConfigResponse.enablements, { cashMode: true, cashRegister: true, plannedOperations: false, taps: false, inventory: false, kitchen: false }, 'configuration and enablements derive from the same validated canonical read');

    const beforeStockConfirmation = await settingState(secondCompany.id, secondPoint.id);
    const stockWithoutConfirmation = await app.inject({ method: 'PATCH', url: '/api/operacao/capacidades', headers: { cookie: secondOwnerCookie }, payload: { controlaEstoque: true } });
    assert.equal(stockWithoutConfirmation.statusCode, 400, `stock transition requires explicit confirmation: ${stockWithoutConfirmation.body}`);
    assert.deepEqual(await settingState(secondCompany.id, secondPoint.id), beforeStockConfirmation, 'missing inventory confirmation does not partially write canonical or legacy settings');

    const beforeModeRequest = await settingState(primaryCompany.id, primaryPoint.id);
    const eventModeRequest = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: ownerCookie }, payload: { operationMode: 'EVENTO' } });
    assert.equal(eventModeRequest.statusCode, 409, `canonical configuration rejects switching engines: ${eventModeRequest.body}`);
    assert.equal(JSON.parse(eventModeRequest.body).code, 'CANONICAL_PDV_MODE_CHANGE_UNSUPPORTED');
    const invalidCloseDependency = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: ownerCookie }, payload: { allowCloseComandaWithPendingKitchenOrders: true } });
    assert.equal(invalidCloseDependency.statusCode, 400, `pending close requires kitchen charge at launch: ${invalidCloseDependency.body}`);
    assert.deepEqual(await settingState(primaryCompany.id, primaryPoint.id), beforeModeRequest, 'mode/dependency rejection makes no settings or audit write');

    const beforeAttendantSettings = await settingState(primaryCompany.id, primaryPoint.id);
    const attendantConfigPatch = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: attendantCookie }, payload: { tapsEnabled: true } });
    assert.equal(attendantConfigPatch.statusCode, 403, 'ATENDENTE is denied by the real owner guard on operational settings');
    assert.deepEqual(await settingState(primaryCompany.id, primaryPoint.id), beforeAttendantSettings, 'ATENDENTE denial leaves settings unchanged');

    const primaryLegacyBeforeSettings = await settingState(primaryCompany.id, primaryPoint.id);
    const ownerConfigPatch = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: ownerCookie }, payload: { tapsEnabled: true, inventoryEnabled: true, quantidadeMesas: 0, confirmacaoEstoque: true } });
    assert.equal(ownerConfigPatch.statusCode, 200, `owner persists canonical flags and zero tables: ${ownerConfigPatch.body}`);
    const ownerConfigSaved = JSON.parse(ownerConfigPatch.body);
    assert.deepEqual([ownerConfigSaved.configurationSource, ownerConfigSaved.tapsEnabled, ownerConfigSaved.inventoryEnabled, ownerConfigSaved.quantidadeMesas], ['CANONICAL_PDV', true, true, 0]);
    const primaryAfterOwnerPatch = await settingState(primaryCompany.id, primaryPoint.id);
    assert.deepEqual(primaryAfterOwnerPatch.legacy, primaryLegacyBeforeSettings.legacy, 'owner setting patch does not synchronize legacy company flags');
    assert.deepEqual(primaryAfterOwnerPatch.module, primaryLegacyBeforeSettings.module, 'owner setting patch does not rewrite the old Operacao row');
    assert.deepEqual([primaryAfterOwnerPatch.canonical.tapsEnabled, primaryAfterOwnerPatch.canonical.inventoryEnabled, primaryAfterOwnerPatch.canonical.quantidadeMesas], [true, true, 0]);
    const primaryContextAfterPatch = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: { cookie: ownerCookie } });
    assert.equal(primaryContextAfterPatch.statusCode, 200);
    assert.deepEqual([JSON.parse(primaryContextAfterPatch.body).tapsEnabled, JSON.parse(primaryContextAfterPatch.body).inventoryEnabled, JSON.parse(primaryContextAfterPatch.body).quantidadeMesas, JSON.parse(primaryContextAfterPatch.body).operationalSettingsSource], [true, true, 0, 'CANONICAL_PDV'], 'context immediately reflects the persisted canonical values');

    const adminConfigRead = await app.inject({ method: 'GET', url: `/api/admin/cervejarias/${encodeURIComponent(primaryCompany.id)}/configuracao-operacional`, headers: { cookie: adminCookie } });
    assert.equal(adminConfigRead.statusCode, 200, `admin reads through shared canonical config helper: ${adminConfigRead.body}`);
    assert.deepEqual([JSON.parse(adminConfigRead.body).configurationSource, JSON.parse(adminConfigRead.body).tapsEnabled, JSON.parse(adminConfigRead.body).quantidadeMesas], ['CANONICAL_PDV', true, 0]);
    const adminConfigPatch = await app.inject({ method: 'PATCH', url: `/api/admin/cervejarias/${encodeURIComponent(primaryCompany.id)}/configuracao-operacional`, headers: { cookie: adminCookie }, payload: { tapsEnabled: false, inventoryEnabled: false, confirmacaoEstoque: true } });
    assert.equal(adminConfigPatch.statusCode, 200, `admin writes canonical configuration: ${adminConfigPatch.body}`);
    const adminSaved = JSON.parse(adminConfigPatch.body);
    assert.deepEqual([adminSaved.tapsEnabled, adminSaved.inventoryEnabled, adminSaved.quantidadeMesas], [false, false, 0]);
    const primaryAfterAdminPatch = await settingState(primaryCompany.id, primaryPoint.id);
    assert.deepEqual(primaryAfterAdminPatch.legacy, primaryLegacyBeforeSettings.legacy, 'admin patch leaves divergent legacy flags intact');
    assert.deepEqual(primaryAfterAdminPatch.module, primaryLegacyBeforeSettings.module);

    const beforeCrossTenantSettings = {
      primary: await settingState(primaryCompany.id, primaryPoint.id),
      second: await settingState(secondCompany.id, secondPoint.id),
    };
    const crossTenantSettingsPatch = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: secondOwnerCookie }, payload: { cervejariaId: primaryCompany.id, tapsEnabled: true } });
    assert.equal(crossTenantSettingsPatch.statusCode, 400, 'owner cannot select another tenant through the strict config payload');
    assert.deepEqual({ primary: await settingState(primaryCompany.id, primaryPoint.id), second: await settingState(secondCompany.id, secondPoint.id) }, beforeCrossTenantSettings, 'cross-tenant settings attempt changes neither tenant');

    const secondLegacyModuleBefore = await db.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } });
    await db.configuracaoOperacao.update({ where: { cervejariaId: secondCompany.id }, data: { controlaEstoque: false, temCozinha: false } });
    const stockEnabled = await app.inject({ method: 'PATCH', url: '/api/operacao/capacidades', headers: { cookie: secondOwnerCookie }, payload: { controlaEstoque: true, confirmacaoEstoque: true } });
    assert.equal(stockEnabled.statusCode, 200, `confirmed stock capability writes canonical PDV: ${stockEnabled.body}`);
    assert.deepEqual([JSON.parse(stockEnabled.body).controlaEstoque, (await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } })).inventoryEnabled], [true, true]);
    assert.deepEqual([await db.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } }).then((row) => row.controlaEstoque), (await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).inventoryEnabled], [false, true], 'capability write does not mirror legacy stock fields');
    const stockDisabled = await app.inject({ method: 'PATCH', url: '/api/operacao/capacidades', headers: { cookie: secondOwnerCookie }, payload: { controlaEstoque: false, confirmacaoEstoque: true } });
    assert.equal(stockDisabled.statusCode, 200);
    assert.equal((await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } })).inventoryEnabled, false, 'explicit false remains persisted');
    assert.equal((await db.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).controlaEstoque, false);
    assert.equal((await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).inventoryEnabled, true, 'legacy operational flag remains unchanged');

    const secondConfigPatch = await app.inject({ method: 'PATCH', url: '/api/operacao/config', headers: { cookie: secondOwnerCookie }, payload: { quantidadeMesas: 0 } });
    assert.equal(secondConfigPatch.statusCode, 200, `existing mesas endpoint writes canonical zero: ${secondConfigPatch.body}`);
    assert.equal(JSON.parse(secondConfigPatch.body).quantidadeMesas, 0);
    assert.equal((await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } })).quantidadeMesas, 0);
    assert.equal((await db.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).quantidadeMesas, secondLegacyModuleBefore.quantidadeMesas, 'legacy mesas count is not synchronized');

    const kitchenEnabled = await app.inject({ method: 'PATCH', url: '/api/operacao/capacidades', headers: { cookie: secondOwnerCookie }, payload: { temCozinha: true } });
    assert.equal(kitchenEnabled.statusCode, 200, `capacities endpoint writes canonical kitchen flag: ${kitchenEnabled.body}`);
    assert.equal((await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } })).kitchenEnabled, true);
    assert.equal((await db.configuracaoOperacao.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).temCozinha, false);

    const settingsCash = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: secondOwnerCookie }, payload: { pontoVendaId: secondPoint.id, trocoInicial: 0, cardapioId: secondMenu.id } });
    assert.equal(settingsCash.statusCode, 201, `settings-proof cash opens: ${settingsCash.body}`);
    const settingsSessionId = JSON.parse(settingsCash.body).id;
    const settingsCommandResponse = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie: secondOwnerCookie }, payload: { pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `settings-kitchen-${runId}` } });
    assert.equal(settingsCommandResponse.statusCode, 201);
    const settingsCommandId = JSON.parse(settingsCommandResponse.body).id;
    const settingsLaunch = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(settingsCommandId)}/pedidos`, headers: { cookie: secondOwnerCookie }, payload: { itens: [{ produtoId: kitchenProduct.id, quantidade: 1 }] } });
    assert.equal(settingsLaunch.statusCode, 201, `active prep order exists before settings changes: ${settingsLaunch.body}`);
    const settingsItemBefore = await db.itemComanda.findFirstOrThrow({ where: { comandaId: settingsCommandId } });
    const totalBeforeKitchenCharge = await db.comanda.findUniqueOrThrow({ where: { id: settingsCommandId }, select: { total: true } });
    assert.equal(centsExact(totalBeforeKitchenCharge.total), '0');

    const kitchenOffBefore = await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } });
    const kitchenOffBlocked = await app.inject({ method: 'PATCH', url: '/api/operacao/capacidades', headers: { cookie: secondOwnerCookie }, payload: { temCozinha: false } });
    assert.equal(kitchenOffBlocked.statusCode, 409, `cannot disable kitchen with an active order: ${kitchenOffBlocked.body}`);
    assert.deepEqual(await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } }), kitchenOffBefore, 'blocked kitchen disable makes no config write');

    const chargeChanged = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: secondOwnerCookie }, payload: { kitchenItemsChargeAtLaunch: true } });
    assert.equal(chargeChanged.statusCode, 200, `kitchen charge change recalc succeeds atomically: ${chargeChanged.body}`);
    assert.deepEqual([JSON.parse(chargeChanged.body).kitchenItemsChargeAtLaunch, JSON.parse(chargeChanged.body).allowCloseComandaWithPendingKitchenOrders], [true, false], 'PATCH response preserves the independent pending-close setting');
    const contextAfterChargePatch = await app.inject({ method: 'GET', url: '/api/operacao/contexto', headers: { cookie: secondOwnerCookie } });
    assert.equal(contextAfterChargePatch.statusCode, 200);
    assert.deepEqual([JSON.parse(contextAfterChargePatch.body).kitchenItemsChargeAtLaunch, JSON.parse(contextAfterChargePatch.body).allowCloseComandaWithPendingKitchenOrders, JSON.parse(contextAfterChargePatch.body).operationalSettingsSource], [true, false, 'CANONICAL_PDV'], 'context reads the canonical value immediately after PATCH');
    const repricedCommand = await db.comanda.findUniqueOrThrow({ where: { id: settingsCommandId }, include: { itens: true, pagamentos: true } });
    assert.deepEqual([centsExact(repricedCommand.total), repricedCommand.status, repricedCommand.itens.length, repricedCommand.pagamentos.length], ['1000', 'ABERTA', 1, 0], 'open command total follows new setting while item snapshot/financial rows stay intact');
    const settingsItemAfter = await db.itemComanda.findUniqueOrThrow({ where: { id: settingsItemBefore.id } });
    assert.deepEqual(plain(settingsItemAfter), plain(settingsItemBefore), 'setting recalc leaves sold-item snapshot and timestamps unchanged');
    const rejectedPendingPayment = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(settingsCommandId)}/pagamentos`, headers: { cookie: secondOwnerCookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 10 }] } });
    assert.equal(rejectedPendingPayment.statusCode, 409, 'charge-at-launch does not implicitly permit closing with pending prep');
    assert.equal(await db.pagamento.count({ where: { comandaId: settingsCommandId } }), 0);
    const cancelledSettingsCommand = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(settingsCommandId)}/cancelar`, headers: { cookie: secondOwnerCookie }, payload: {} });
    assert.equal(cancelledSettingsCommand.statusCode, 200, `settings fixture command is closed through the existing route: ${cancelledSettingsCommand.body}`);
    const pendingKitchenCancellation = await db.pedidoOperacao.findFirstOrThrow({ where: { comandaId: settingsCommandId, status: 'CANCELAMENTO_PENDENTE' } });
    const kitchenCancellationConfirmed = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(pendingKitchenCancellation.id)}/status`, headers: { cookie: secondOwnerCookie }, payload: { status: 'CANCELADO' } });
    assert.equal(kitchenCancellationConfirmed.statusCode, 200, `owner confirms the kitchen cancellation through the real kitchen route: ${kitchenCancellationConfirmed.body}`);
    assert.equal((await db.pedidoOperacao.findUniqueOrThrow({ where: { id: pendingKitchenCancellation.id } })).status, 'CANCELADO', 'only a resolved order stops blocking kitchen disable');
    const kitchenOffAfterCancel = await app.inject({ method: 'PATCH', url: '/api/operacao/capacidades', headers: { cookie: secondOwnerCookie }, payload: { temCozinha: false } });
    assert.equal(kitchenOffAfterCancel.statusCode, 200, 'kitchen can be disabled after active preparation is resolved');
    const settingsCashClose = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: secondOwnerCookie }, payload: { pontoVendaId: secondPoint.id, contadoDinheiro: 0, contadoPix: 0, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
    assert.equal(settingsCashClose.statusCode, 200, `settings proof cash closes: ${settingsCashClose.body}`);
    assert.equal((await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: settingsSessionId } })).status, 'FECHADO');

    const secondCanonicalBeforeLegacyMode = plain(await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } }));
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: secondPoint.id }, data: { tapsEnabled: true } });
    await db.configuracaoOperacional.update({ where: { cervejariaId: secondCompany.id }, data: { tapsEnabled: false } });
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    const legacyConfigRead = await app.inject({ method: 'GET', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: secondOwnerCookie } });
    assert.equal(legacyConfigRead.statusCode, 200);
    assert.deepEqual([JSON.parse(legacyConfigRead.body).configuration.configurationSource ?? 'LEGACY', JSON.parse(legacyConfigRead.body).configuration.tapsEnabled], ['LEGACY', false], 'disabled activation reads the existing legacy settings');
    const legacyConfigWrite = await app.inject({ method: 'PATCH', url: '/api/cervejaria/configuracao-operacional', headers: { cookie: secondOwnerCookie }, payload: { tapsEnabled: true } });
    assert.equal(legacyConfigWrite.statusCode, 200);
    assert.equal((await db.configuracaoOperacional.findUniqueOrThrow({ where: { cervejariaId: secondCompany.id } })).tapsEnabled, true);
    assert.equal((await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: secondPoint.id } })).tapsEnabled, true, 'legacy-mode write does not implicitly rewrite the canonical record');
    assert.equal(secondCanonicalBeforeLegacyMode.tapsEnabled, false, 'fixture made the two authorities diverge before disabling activation');
    process.env.PDV_CANONICAL_CONFIG_QA = '1';

    const occurrenceAgenda = await db.agendaOperacional.create({ data: {
      id: `cash-context-agenda-${runId}`, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id,
      nome: 'Synthetic recurring context', frequencia: 'SEMANAL', diaSemana: 0,
    } });
    const oneOffOccurrence = await db.ocorrenciaOperacional.create({ data: {
      id: `cash-context-oneoff-${runId}`, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id,
      nome: 'Synthetic one-off', data: new Date('2026-11-01T00:00:00.000Z'), status: 'PROGRAMADA',
    } });
    const recurringOccurrences = await Promise.all(['2026-11-02', '2026-11-03'].map((day, index) => db.ocorrenciaOperacional.create({ data: {
      id: `cash-context-recurring-${index}-${runId}`, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id,
      agendaId: occurrenceAgenda.id, nome: `Synthetic recurring ${index + 1}`, data: new Date(`${day}T00:00:00.000Z`), status: index === 0 ? 'PROGRAMADA' : 'ABERTA',
    } })));
    const otherAgenda = await db.agendaOperacional.create({ data: {
      id: `cash-context-other-agenda-${runId}`, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id,
      nome: 'Synthetic second agenda', frequencia: 'SEMANAL', diaSemana: 1,
    } });
    const otherAgendaOccurrence = await db.ocorrenciaOperacional.create({ data: {
      id: `cash-context-other-agenda-occurrence-${runId}`, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id,
      agendaId: otherAgenda.id, nome: 'Synthetic second-agenda occurrence', data: new Date('2026-11-04T00:00:00.000Z'), status: 'PROGRAMADA',
    } });
    const foreignAgenda = await db.agendaOperacional.create({ data: {
      id: `cash-context-foreign-agenda-${runId}`, cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id,
      nome: 'Synthetic foreign agenda', frequencia: 'SEMANAL', diaSemana: 2,
    } });
    const foreignOccurrence = await db.ocorrenciaOperacional.create({ data: {
      id: `cash-context-foreign-occurrence-${runId}`, cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id,
      agendaId: foreignAgenda.id, nome: 'Synthetic foreign occurrence', data: new Date('2026-11-05T00:00:00.000Z'), status: 'PROGRAMADA',
    } });
    const occurrenceClient = await db.cliente.create({ data: {
      id: `cash-context-customer-${runId}`, cervejariaId: primaryCompany.id, nome: 'Synthetic occurrence customer',
      telefone: `119${String(runId).replaceAll(/[^0-9]/g, '').slice(-8).padStart(8, '0')}`,
    } });
    const primaryCashFlow = operationFlows.find((flow) => flow.tenantId === primaryCompany.id);
    assert(primaryCashFlow, 'primary synthetic cash flow exists');
    const unitPrice = Number(primaryCashFlow.itemPriceCents) / 100;
    const occurrenceProofs = [];
    const withOwnerAt = (day, operation) => withQaDate(day, async () => operation(await login(authOwner.email, ownerPassword, 'DONO')));
    const withSecondOwnerAt = (day, operation) => withQaDate(day, async () => operation(await login(secondOwner.email, secondOwnerPassword, 'DONO')));
    const agendaCreate = await app.inject({ method: 'POST', url: '/api/operacao/agenda/agendas', headers: { cookie: ownerCookie }, payload: { nome: `Sábado no PDV ${runId}`, diaSemana: 6, horaInicio: '18:00' } });
    assert.equal(agendaCreate.statusCode, 201, `authenticated weekly agenda create: ${agendaCreate.body}`);
    const managedAgenda = JSON.parse(agendaCreate.body);
    const generateUrl = `/api/operacao/agenda/agendas/${encodeURIComponent(managedAgenda.id)}/gerar`;
    const generatedRange = { inicio: '2026-11-01', fim: '2026-11-30' };
    const readOnlyBefore = await counts();
    const attendantScheduleRead = await app.inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-11-01&fim=2026-11-30', headers: { cookie: attendantCookie } });
    assert.equal(attendantScheduleRead.statusCode, 200, 'users who can operate cash can read the operational schedule');
    await assertNoApiWrites(readOnlyBefore, 'agenda GET');
    const attendeeWrite = await app.inject({ method: 'POST', url: '/api/operacao/agenda/agendas', headers: { cookie: attendantCookie }, payload: { nome: 'No permission', diaSemana: 6 } });
    assert.equal(attendeeWrite.statusCode, 403, 'agenda management remains protected by the existing owner authorization');
    await assertNoApiWrites(readOnlyBefore, 'attendant agenda write');
    const [generateA, generateB] = await Promise.all([
      app.inject({ method: 'POST', url: generateUrl, headers: { cookie: ownerCookie }, payload: generatedRange }),
      app.inject({ method: 'POST', url: generateUrl, headers: { cookie: ownerCookie }, payload: generatedRange }),
    ]);
    assert.deepEqual([generateA.statusCode, generateB.statusCode], [200, 200], 'concurrent explicit recurrence generation completes');
    assert.equal([JSON.parse(generateA.body).criadas, JSON.parse(generateB.body).criadas].reduce((sum, count) => sum + count, 0), 4, 'concurrent generation creates each Saturday once');
    const generatedListResponse = await app.inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-11-01&fim=2026-11-30', headers: { cookie: ownerCookie } });
    assert.equal(generatedListResponse.statusCode, 200);
    const generatedList = JSON.parse(generatedListResponse.body);
    const generatedSaturdays = generatedList.ocorrencias.filter((item) => item.agendaId === managedAgenda.id);
    assert.deepEqual(generatedSaturdays.map((item) => item.data), ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'], 'two Saturdays in one recurrence period are distinct date occurrences');
    const repeatedGeneration = await app.inject({ method: 'POST', url: generateUrl, headers: { cookie: ownerCookie }, payload: generatedRange });
    assert.equal(JSON.parse(repeatedGeneration.body).criadas, 0, 'repeated generation creates no duplicate agenda/date');
    const generatedIdsBeforeEdit = generatedSaturdays.map((item) => [item.id, item.data, item.nome]);
    const agendaEdit = await app.inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${encodeURIComponent(managedAgenda.id)}`, headers: { cookie: ownerCookie }, payload: { nome: 'Agenda editada depois da geração', diaSemana: 6 } });
    assert.equal(agendaEdit.statusCode, 200, `weekly agenda edit: ${agendaEdit.body}`);
    const afterAgendaEdit = await db.ocorrenciaOperacional.findMany({ where: { agendaId: managedAgenda.id }, orderBy: { data: 'asc' } });
    assert.deepEqual(afterAgendaEdit.map((item) => [item.id, item.data.toISOString().slice(0, 10), item.nome]), generatedIdsBeforeEdit, 'editing recurrence preserves generated occurrence IDs, dates and historical names');
    const avulsaCreate = await app.inject({ method: 'POST', url: '/api/operacao/agenda/ocorrencias', headers: { cookie: ownerCookie }, payload: { nome: 'Avulsa da agenda canônica', data: '2026-11-09' } });
    assert.equal(avulsaCreate.statusCode, 201, `authenticated one-off occurrence create: ${avulsaCreate.body}`);
    const beforeForeignAgendaEdit = await db.agendaOperacional.count({ where: { id: managedAgenda.id, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id } });
    const foreignAgendaEdit = await app.inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${encodeURIComponent(managedAgenda.id)}`, headers: { cookie: secondOwnerCookie }, payload: { nome: 'Tenant cruzado' } });
    assert.equal(foreignAgendaEdit.statusCode, 404, 'another tenant cannot edit the first tenant agenda');
    assert.equal(await db.agendaOperacional.count({ where: { id: managedAgenda.id, cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id } }), beforeForeignAgendaEdit, 'cross-tenant agenda edit performs no write');
    const openOccurrenceCash = async (day, occurrenceId, confirmOtherDate = false) => withOwnerAt(day, async (cookie) => {
      const response = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: {
        pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ...(occurrenceId ? { ocorrenciaId: occurrenceId } : {}), ...(confirmOtherDate ? { confirmarDataDiferente: true } : {}),
      } });
      assert.equal(response.statusCode, 201, `occurrence cash opens ${day}: ${response.body}`);
      const session = JSON.parse(response.body);
      assert.equal(session.ocorrenciaId ?? null, occurrenceId ?? null);
      const responseContext = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${encodeURIComponent(primaryPoint.id)}`, headers: { cookie } });
      assert.equal(responseContext.statusCode, 200);
      const context = JSON.parse(responseContext.body);
      assert.equal(context.sessao.ocorrenciaId ?? null, occurrenceId ?? null, 'read API exposes persisted session context');
      if (occurrenceId) assert(context.sessao.ocorrencia?.data, 'read API exposes persisted occurrence name/date context');
      return session;
    });
    const closeOccurrenceCash = async (day, pix) => withOwnerAt(day, async (cookie) => {
      const response = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie }, payload: {
        pontoVendaId: primaryPoint.id, contadoDinheiro: 0, contadoPix: pix, contadoCartaoDebito: 0, contadoCartaoCredito: 0,
      } });
      assert.equal(response.statusCode, 200, `occurrence cash closes ${day}: ${response.body}`);
      const closed = JSON.parse(response.body);
      const persisted = await db.sessaoCaixaOperacao.findFirstOrThrow({ where: {
        cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id,
        diaOperacional: new Date(`${day}T00:00:00.000Z`),
      }, orderBy: { abertoEm: 'desc' } });
      assert.equal(closed.ocorrenciaId ?? null, persisted.ocorrenciaId ?? null, 'close response retains persisted occurrence');
      return closed;
    });

    const noOccurrenceSession = await withOwnerAt('2026-11-09', async (cookie) => {
      const response = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id } });
      assert.equal(response.statusCode, 201, `cash without an occurrence opens: ${response.body}`);
      const context = await app.inject({ method: 'GET', url: `/api/operacao/caixa?pontoVendaId=${encodeURIComponent(primaryPoint.id)}`, headers: { cookie } });
      assert.equal(JSON.parse(context.body).sessao.ocorrenciaId ?? null, null, 'persisted session without selection stays unlinked');
      return JSON.parse(response.body);
    });
    assert.equal(noOccurrenceSession.ocorrenciaId ?? null, null, 'cash opens without an occurrence');
    await closeOccurrenceCash('2026-11-09', 0);
    const crossDateUnconfirmed = await withOwnerAt('2026-11-10', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: JSON.parse(avulsaCreate.body).id } }));
    assert.equal(crossDateUnconfirmed.statusCode, 409, 'different occurrence date is rejected without explicit confirmation');
    const crossDateSession = await withOwnerAt('2026-11-10', async (cookie) => {
      const opened = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: JSON.parse(avulsaCreate.body).id, confirmarDataDiferente: true } });
      assert.equal(opened.statusCode, 201, `different occurrence date accepts explicit confirmation: ${opened.body}`);
      return JSON.parse(opened.body);
    });
    assert.equal(crossDateSession.ocorrenciaId, JSON.parse(avulsaCreate.body).id);
    await closeOccurrenceCash('2026-11-10', 0);
    for (const [status, day] of [['FECHADA', '2026-11-11'], ['CANCELADA', '2026-11-12']]) {
      const blockedOccurrence = await db.ocorrenciaOperacional.create({ data: { cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id, nome: `Blocked ${status}`, data: new Date('2026-11-01T00:00:00.000Z'), status } });
      const blocked = await withOwnerAt(day, (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: blockedOccurrence.id, confirmarDataDiferente: true } }));
      assert.equal(blocked.statusCode, 409, `${status} occurrence remains ineligible even with date confirmation`);
      assert.equal(await db.sessaoCaixaOperacao.count({ where: { cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id, diaOperacional: new Date(`${day}T00:00:00.000Z`) } }), 0, `${status} rejection performs no session write`);
    }

    const stockBeforeOccurrenceSale = plain({
      balances: await db.inventoryBalance.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }),
      movements: await db.inventoryMovement.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }),
    });
    const oneOffSession = await openOccurrenceCash('2026-11-01', oneOffOccurrence.id);
    const beforeClientSaleOverride = await counts();
    const clientSaleOverride = await withOwnerAt('2026-11-01', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, clienteId: occurrenceClient.id, ocorrenciaId: recurringOccurrences[0].id,
      itens: [{ produtoId: product.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: unitPrice }],
    } }));
    assert.equal(clientSaleOverride.statusCode, 400, 'sale API rejects a client-supplied occurrence override');
    await assertNoApiWrites(beforeClientSaleOverride, 'sale occurrence override');
    const oneOffSaleResponse = await withOwnerAt('2026-11-01', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/vendas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, clienteId: occurrenceClient.id, itens: [{ produtoId: product.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: unitPrice }],
    } }));
    assert.equal(oneOffSaleResponse.statusCode, 201, `one-off sale uses selected context: ${oneOffSaleResponse.body}`);
    const oneOffSale = JSON.parse(oneOffSaleResponse.body);
    const oneOffCommand = await db.comanda.findUniqueOrThrow({ where: { id: oneOffSale.id }, include: { itens: true, pagamentos: true } });
    assert.deepEqual([oneOffCommand.origem, oneOffCommand.tipo, oneOffCommand.ocorrenciaId, oneOffCommand.itens[0].produtoId, oneOffCommand.itens[0].quantidade, centsExact(oneOffCommand.itens[0].precoUnit), oneOffCommand.pagamentos[0].sessaoCaixaId], ['CAIXA', 'AVULSA', oneOffOccurrence.id, product.id, 1, String(primaryCashFlow.itemPriceCents), oneOffSession.id]);
    assert.deepEqual(plain({ balances: await db.inventoryBalance.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }), movements: await db.inventoryMovement.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }) }), stockBeforeOccurrenceSale, 'stock behavior remains controlled by the existing Por Caixa configuration');
    await closeOccurrenceCash('2026-11-01', unitPrice);
    occurrenceProofs.push({ kind: 'one-off-avulsa', sessionId: oneOffSession.id, commandId: oneOffCommand.id, occurrenceId: oneOffCommand.ocorrenciaId, paymentSessionId: oneOffCommand.pagamentos[0].sessaoCaixaId });

    const recurringSession1 = await openOccurrenceCash('2026-11-02', recurringOccurrences[0].id);
    const beforeCommandOverride = await counts();
    const commandOverride = await withOwnerAt('2026-11-02', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: 'Client override forbidden', clienteId: occurrenceClient.id, ocorrenciaId: recurringOccurrences[1].id,
    } }));
    assert.equal(commandOverride.statusCode, 400, 'command API rejects a client-supplied occurrence override');
    await assertNoApiWrites(beforeCommandOverride, 'command occurrence override');
    const recurringCommand1Response = await withOwnerAt('2026-11-02', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: 'Recurring customer', clienteId: occurrenceClient.id } }));
    assert.equal(recurringCommand1Response.statusCode, 201, `first recurring comanda: ${recurringCommand1Response.body}`);
    const recurringCommand1 = JSON.parse(recurringCommand1Response.body);
    assert.equal(recurringCommand1.ocorrenciaId, recurringOccurrences[0].id);
    const recurringLaunch1 = await withOwnerAt('2026-11-02', (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(recurringCommand1.id)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(recurringLaunch1.statusCode, 201, `first recurring consumption: ${recurringLaunch1.body}`);
    const beforeCommandOrderOverride = await counts();
    const commandOrderOverride = await withOwnerAt('2026-11-02', (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(recurringCommand1.id)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }], ocorrenciaId: recurringOccurrences[1].id } }));
    assert.equal(commandOrderOverride.statusCode, 400, 'order API rejects a client-supplied occurrence override');
    await assertNoApiWrites(beforeCommandOrderOverride, 'command order occurrence override');

    const recurringSession2 = await openOccurrenceCash('2026-11-03', recurringOccurrences[1].id);
    const recurringCommand2Response = await withOwnerAt('2026-11-03', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: 'Recurring customer', clienteId: occurrenceClient.id } }));
    assert.equal(recurringCommand2Response.statusCode, 201, `same customer gets a separate command for occurrence two: ${recurringCommand2Response.body}`);
    const recurringCommand2 = JSON.parse(recurringCommand2Response.body);
    assert.equal(recurringCommand2.ocorrenciaId, recurringOccurrences[1].id);
    assert.notEqual(recurringCommand1.id, recurringCommand2.id);
    const recurringLaunch2 = await withOwnerAt('2026-11-03', (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(recurringCommand2.id)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(recurringLaunch2.statusCode, 201, `second recurring consumption: ${recurringLaunch2.body}`);
    for (const [day, session, command] of [['2026-11-03', recurringSession2, recurringCommand2], ['2026-11-02', recurringSession1, recurringCommand1]]) {
      const payment = await withOwnerAt(day, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(command.id)}/pagamentos`, headers: { cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: unitPrice }] } }));
      assert.equal(payment.statusCode, 200, `recurring payment ${day}: ${payment.body}`);
      const persisted = await db.comanda.findUniqueOrThrow({ where: { id: command.id }, include: { itens: true, pagamentos: true } });
      assert.deepEqual([persisted.origem, persisted.ocorrenciaId, persisted.itens.length, persisted.pagamentos[0].sessaoCaixaId], ['CAIXA', command.ocorrenciaId, 1, session.id]);
      assert.deepEqual([persisted.itens[0].produtoId, persisted.itens[0].quantidade, centsExact(persisted.itens[0].precoUnit), centsExact(persisted.pagamentos[0].valor)], [product.id, 1, String(primaryCashFlow.itemPriceCents), String(primaryCashFlow.itemPriceCents)], 'occurrence context does not alter catalog snapshots or amount paid');
      assert.equal(persisted.status, 'FECHADA', `full payment closes recurring command before cash close ${day}`);
      occurrenceProofs.push({ kind: 'recurring-command', sessionId: session.id, commandId: persisted.id, occurrenceId: persisted.ocorrenciaId, paymentSessionId: persisted.pagamentos[0].sessaoCaixaId });
    }
    // The existing cash close route blocks while any company command remains open,
    // so settle both occurrence-separated commands before closing either session.
    await closeOccurrenceCash('2026-11-03', unitPrice);
    await closeOccurrenceCash('2026-11-02', unitPrice);

    const protectedHistoryBeforeAgendaEdit = plain({
      commands: await db.comanda.findMany({ where: { id: { in: [recurringCommand1.id, recurringCommand2.id] } }, include: { itens: true, pagamentos: true }, orderBy: { id: 'asc' } }),
      sessions: await db.sessaoCaixaOperacao.findMany({ where: { id: { in: [recurringSession1.id, recurringSession2.id] } }, orderBy: { id: 'asc' } }),
      balances: await db.inventoryBalance.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }),
      movements: await db.inventoryMovement.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }),
    });
    const historicalAgendaEdit = await app.inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${encodeURIComponent(occurrenceAgenda.id)}`, headers: { cookie: ownerCookie }, payload: { nome: 'Recorrência renomeada após vendas' } });
    assert.equal(historicalAgendaEdit.statusCode, 200, `agenda can be edited after occurrences are realized: ${historicalAgendaEdit.body}`);
    assert.deepEqual(plain({
      commands: await db.comanda.findMany({ where: { id: { in: [recurringCommand1.id, recurringCommand2.id] } }, include: { itens: true, pagamentos: true }, orderBy: { id: 'asc' } }),
      sessions: await db.sessaoCaixaOperacao.findMany({ where: { id: { in: [recurringSession1.id, recurringSession2.id] } }, orderBy: { id: 'asc' } }),
      balances: await db.inventoryBalance.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }),
      movements: await db.inventoryMovement.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }),
    }), protectedHistoryBeforeAgendaEdit, 'editing agenda leaves sales, payment records, cash sessions and stock history unchanged');

    const portalSession = await openOccurrenceCash('2026-11-04', otherAgendaOccurrence.id);
    const occurrencePortalOpen = await withQaDate('2026-11-04', () => app.inject({ method: 'POST', url: `/api/public/cervejarias/${encodeURIComponent(primaryCompany.slug)}/pontos-venda/${encodeURIComponent(primaryPoint.id)}/comandas`, payload: { nome: occurrenceClient.nome, telefone: occurrenceClient.telefone } }));
    assert.equal(occurrencePortalOpen.statusCode, 201, `portal opens a command in the active occurrence: ${occurrencePortalOpen.body}`);
    const occurrencePortalCookieHeader = occurrencePortalOpen.headers['set-cookie'];
    const occurrencePortalCookie = Array.isArray(occurrencePortalCookieHeader) ? occurrencePortalCookieHeader[0]?.split(';', 1)[0] : occurrencePortalCookieHeader?.split(';', 1)[0];
    assert(occurrencePortalCookie, 'portal returns the real cliente-PDV credential');
    const portalCommandId = JSON.parse(occurrencePortalOpen.body).comanda.id;
    assert.equal(JSON.parse(occurrencePortalOpen.body).comanda.ocorrenciaId, otherAgendaOccurrence.id);
    const occurrencePortalPath = `/api/public/cervejarias/${encodeURIComponent(primaryCompany.slug)}/pontos-venda/${encodeURIComponent(primaryPoint.id)}/comanda/pedidos`;
    const portalOverride = await withQaDate('2026-11-04', () => app.inject({ method: 'POST', url: occurrencePortalPath, headers: { cookie: occurrencePortalCookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }], ocorrenciaId: recurringOccurrences[0].id } }));
    assert.equal(portalOverride.statusCode, 400, 'portal cannot provide an occurrence override');
    const occurrencePortalValidOrder = await withQaDate('2026-11-04', () => app.inject({ method: 'POST', url: occurrencePortalPath, headers: { cookie: occurrencePortalCookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(occurrencePortalValidOrder.statusCode, 201, `portal order follows the session context: ${occurrencePortalValidOrder.body}`);
    assert.equal(JSON.parse(occurrencePortalValidOrder.body).ocorrenciaId, otherAgendaOccurrence.id);
    const portalCommand = await db.comanda.findUniqueOrThrow({ where: { id: portalCommandId }, include: { itens: true } });
    assert.deepEqual([portalCommand.origem, portalCommand.ocorrenciaId, portalCommand.itens.length], ['CAIXA', otherAgendaOccurrence.id, 1]);
    assert.deepEqual([portalCommand.itens[0].produtoId, portalCommand.itens[0].quantidade, centsExact(portalCommand.itens[0].precoUnit)], [product.id, 1, String(primaryCashFlow.itemPriceCents)]);
    await db.comanda.update({ where: { id: portalCommandId }, data: { ocorrenciaId: recurringOccurrences[0].id } });
    const itemsBeforeContextMismatch = await db.itemComanda.count({ where: { comandaId: portalCommandId } });
    const blockedPortalContext = await withQaDate('2026-11-04', () => app.inject({ method: 'POST', url: occurrencePortalPath, headers: { cookie: occurrencePortalCookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(blockedPortalContext.statusCode, 409, `portal refuses a command whose context differs from the session: ${blockedPortalContext.body}`);
    assert.equal(await db.itemComanda.count({ where: { comandaId: portalCommandId } }), itemsBeforeContextMismatch, 'mismatched portal context creates no order/item');
    await db.comanda.update({ where: { id: portalCommandId }, data: { ocorrenciaId: otherAgendaOccurrence.id } });
    const portalPaid = await withOwnerAt('2026-11-04', (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(portalCommandId)}/pagamentos`, headers: { cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: unitPrice }] } }));
    assert.equal(portalPaid.statusCode, 200, `portal-originated command stays in the existing payment flow: ${portalPaid.body}`);
    const occurrencePortalPayment = await db.pagamento.findFirstOrThrow({ where: { comandaId: portalCommandId } });
    assert.equal(occurrencePortalPayment.sessaoCaixaId, portalSession.id);
    await closeOccurrenceCash('2026-11-04', unitPrice);
    assert.deepEqual(plain({ balances: await db.inventoryBalance.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }), movements: await db.inventoryMovement.findMany({ where: { cervejariaId: primaryCompany.id, produtoId: product.id }, orderBy: { id: 'asc' } }) }), stockBeforeOccurrenceSale, 'all occurrence-scoped operation leaves existing inventory behavior unchanged');
    occurrenceProofs.push({ kind: 'different-agenda-portal', sessionId: portalSession.id, commandId: portalCommandId, occurrenceId: portalCommand.ocorrenciaId, paymentSessionId: occurrencePortalPayment.sessaoCaixaId });

    const beforeForeignOccurrence = await counts();
    const foreignAttempt = await withOwnerAt('2026-11-05', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: foreignOccurrence.id } }));
    assert.equal(foreignAttempt.statusCode, 409, `foreign tenant/PDV occurrence is rejected: ${foreignAttempt.body}`);
    assert.equal(await db.sessaoCaixaOperacao.count({ where: { cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id, diaOperacional: new Date('2026-11-05T00:00:00.000Z') } }), 0);
    await assertNoApiWrites(beforeForeignOccurrence, 'foreign occurrence opening');

    const scopeCompany = await db.cervejaria.create({ data: { id: `cash-context-scope-company-${runId}`, nome: 'Synthetic context scope', slug: `cash-context-scope-${runId}` } });
    const scopePointA = await db.pontoVenda.create({ data: { id: `cash-context-scope-a-${runId}`, cervejariaId: scopeCompany.id, nome: 'Synthetic point A' } });
    const scopePointB = await db.pontoVenda.create({ data: { id: `cash-context-scope-b-${runId}`, cervejariaId: scopeCompany.id, nome: 'Synthetic point B' } });
    const scopeOccurrence = await db.ocorrenciaOperacional.create({ data: { id: `cash-context-scope-occurrence-${runId}`, cervejariaId: scopeCompany.id, pontoVendaId: scopePointB.id, nome: 'Synthetic wrong point', data: new Date('2026-11-06T00:00:00.000Z') } });
    const { validateCashOccurrenceSelection } = await import('../src/lib/operacao/contexto-ocorrencia.ts');
    await assert.rejects(db.$transaction((tx) => validateCashOccurrenceSelection(tx, { cervejariaId: scopeCompany.id, pontoVendaId: scopePointA.id, ocorrenciaId: scopeOccurrence.id, diaOperacional: new Date('2026-11-06T00:00:00.000Z') })), (error) => error?.code === 'CASH_OCCURRENCE_SCOPE_MISMATCH');

    const previousOccurrenceActivation = process.env.PDV_CANONICAL_CONFIG_QA;
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    let legacyOccurrenceTableReads = 0;
    const legacyOccurrenceDb = { ocorrenciaOperacional: { findFirst: async () => { legacyOccurrenceTableReads++; throw new Error('legacy path queried additive occurrence table'); } } };
    assert.equal(await validateCashOccurrenceSelection(legacyOccurrenceDb, { cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id }), undefined);
    await assert.rejects(validateCashOccurrenceSelection(legacyOccurrenceDb, { cervejariaId: secondCompany.id, pontoVendaId: secondPoint.id, ocorrenciaId: oneOffOccurrence.id }), (error) => error?.code === 'CASH_OCCURRENCE_CONTEXT_DISABLED');
    assert.equal(legacyOccurrenceTableReads, 0, 'disabled selection path does not query the additive occurrence table');
    const beforeDisabledOccurrence = await counts();
    const disabledOccurrence = await withSecondOwnerAt('2026-11-06', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, trocoInicial: 0, cardapioId: secondMenu.id, ocorrenciaId: foreignOccurrence.id } }));
    assert.equal(disabledOccurrence.statusCode, 409, `disabled activation refuses a dropped occurrence: ${disabledOccurrence.body}`);
    assert.match(disabledOccurrence.body, /CASH_OCCURRENCE_CONTEXT_DISABLED|ativa[cç][aã]o da configura[cç][aã]o can[oô]nica/i);
    await assertNoApiWrites(beforeDisabledOccurrence, 'occurrence request while canonical activation is off');

    const legacySession = await withSecondOwnerAt('2026-11-08', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, trocoInicial: 0, cardapioId: secondMenu.id } }));
    assert.equal(legacySession.statusCode, 201, `legacy activation off still opens the existing Por Caixa flow: ${legacySession.body}`);
    assert.equal(JSON.parse(legacySession.body).ocorrenciaId ?? null, null);
    const legacyCommandResponse = await withSecondOwnerAt('2026-11-08', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `legacy-off-${runId}` } }));
    assert.equal(legacyCommandResponse.statusCode, 201, `legacy command creation remains available: ${legacyCommandResponse.body}`);
    assert.equal(JSON.parse(legacyCommandResponse.body).ocorrenciaId ?? null, null);
    const legacyCommandId = JSON.parse(legacyCommandResponse.body).id;
    await db.produto.update({ where: { id: secondProduct.id }, data: { controlaEstoque: false } });
    const legacyLaunch = await withSecondOwnerAt('2026-11-08', (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(legacyCommandId)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: secondProduct.id, quantidade: 1 }] } }));
    assert.equal(legacyLaunch.statusCode, 201, `legacy order launch remains available: ${legacyLaunch.body}`);
    const legacyItemId = JSON.parse(legacyLaunch.body).pedidos[0].itens[0].id;
    const legacyIncrease = await withSecondOwnerAt('2026-11-08', (cookie) => app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(legacyCommandId)}/itens/${encodeURIComponent(legacyItemId)}`, headers: { cookie }, payload: { quantidade: 2, ocorrenciaId: oneOffOccurrence.id } }));
    assert.equal(legacyIncrease.statusCode, 200, `activation off keeps the legacy quantity update contract and ignores occurrence payload: ${legacyIncrease.body}`);
    const legacyUpdatedCommand = await db.comanda.findUniqueOrThrow({ where: { id: legacyCommandId }, include: { itens: true } });
    assert.deepEqual([legacyUpdatedCommand.itens[0].quantidade, centsExact(legacyUpdatedCommand.total), legacyUpdatedCommand.ocorrenciaId], [2, '800', null], 'disabled mode preserves quantity/total and ignores arbitrary occurrence payload');
    const legacyPaid = await withSecondOwnerAt('2026-11-08', (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(legacyCommandId)}/pagamentos`, headers: { cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 8 }] } }));
    assert.equal(legacyPaid.statusCode, 200, `legacy payment remains available: ${legacyPaid.body}`);
    const legacyPayment = await db.pagamento.findFirstOrThrow({ where: { comandaId: legacyCommandId } });
    assert.equal(legacyPayment.sessaoCaixaId, JSON.parse(legacySession.body).id);
    const legacyClose = await withSecondOwnerAt('2026-11-08', (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, contadoDinheiro: 0, contadoPix: 8, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } }));
    assert.equal(legacyClose.statusCode, 200, `legacy cash close remains available: ${legacyClose.body}`);
    await db.produto.update({ where: { id: secondProduct.id }, data: { controlaEstoque: true } });
    process.env.PDV_CANONICAL_CONFIG_QA = previousOccurrenceActivation;

    // Regression proof: create an item through the API, seed an incompatible
    // historical command context, then exercise the authenticated quantity API.
    process.env.PDV_CANONICAL_CONFIG_QA = '1';
    const productStockTrackingBefore = product.controlaEstoque;
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: primaryPoint.id }, data: { inventoryEnabled: true } });
    await db.produto.update({ where: { id: product.id }, data: { controlaEstoque: true } });
    await db.inventoryBalance.create({ data: {
      id: `cash-context-consumption-stock-${runId}`, cervejariaId: primaryCompany.id,
      pontoVendaId: primaryPoint.id, produtoId: product.id, quantidade: '10.000', estoqueMinimo: '0.000',
    } });
    const mismatchDay = '2026-11-09';
    const mismatchSession = await openOccurrenceCash(mismatchDay, recurringOccurrences[1].id, true);
    const mismatchCommandResponse = await withOwnerAt(mismatchDay, (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: `occurrence-mismatch-${runId}`,
    } }));
    assert.equal(mismatchCommandResponse.statusCode, 201, `mismatch command opens through authenticated API: ${mismatchCommandResponse.body}`);
    const mismatchCommandId = JSON.parse(mismatchCommandResponse.body).id;
    const mismatchLaunch = await withOwnerAt(mismatchDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(mismatchCommandId)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(mismatchLaunch.statusCode, 201, `non-kitchen consumption launches through authenticated API: ${mismatchLaunch.body}`);
    const mismatchItemId = JSON.parse(mismatchLaunch.body).pedidos[0].itens[0].id;
    await db.itemComandaOpcional.create({ data: { id: `cash-context-item-optional-${runId}`, itemComandaId: mismatchItemId, nome: 'Synthetic preserved add-on', precoAdicional: '1.25', quantidade: 1 } });
    await db.comanda.update({ where: { id: mismatchCommandId }, data: { total: '10.75' } });
    await db.comanda.update({ where: { id: mismatchCommandId }, data: { ocorrenciaId: recurringOccurrences[0].id } });
    const mismatchBefore = await db.comanda.findUniqueOrThrow({ where: { id: mismatchCommandId }, include: {
      itens: { include: { opcionais: true } }, pagamentos: true,
      pedidosOperacao: { include: { itensComanda: true, historicoStatus: true } },
    } });
    const stockBeforeMismatchIncrease = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    const movementsBeforeMismatchIncrease = await db.inventoryMovement.findMany({ where: { pedidoId: mismatchBefore.pedidosOperacao[0].id }, orderBy: { createdAt: 'asc' } });
    const mismatchIncrease = await withOwnerAt(mismatchDay, (cookie) => app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(mismatchCommandId)}/itens/${encodeURIComponent(mismatchItemId)}`, headers: { cookie }, payload: { quantidade: 2, ocorrenciaId: recurringOccurrences[1].id } }));
    assert.equal(mismatchIncrease.statusCode, 409, `incompatible occurrence increase is rejected despite client-supplied context: ${mismatchIncrease.body}`);
    const mismatchAfter = await db.comanda.findUniqueOrThrow({ where: { id: mismatchCommandId }, include: {
      itens: { include: { opcionais: true } }, pagamentos: true,
      pedidosOperacao: { include: { itensComanda: true, historicoStatus: true } },
    } });
    const stockAfterMismatchIncrease = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    const movementsAfterMismatchIncrease = await db.inventoryMovement.findMany({ where: { pedidoId: mismatchBefore.pedidosOperacao[0].id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(plain(mismatchAfter), plain(mismatchBefore), 'rejected mismatch leaves quantity, item/options snapshots, total, payments and order history intact');
    assert.deepEqual(plain(stockAfterMismatchIncrease), plain(stockBeforeMismatchIncrease), 'rejected mismatch leaves the stock balance intact');
    assert.deepEqual(movementsAfterMismatchIncrease.map(plain), movementsBeforeMismatchIncrease.map(plain), 'rejected mismatch leaves inventory movement history intact');
    const foreignIncrease = await withSecondOwnerAt(mismatchDay, (cookie) => app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(mismatchCommandId)}/itens/${encodeURIComponent(mismatchItemId)}`, headers: { cookie }, payload: { quantidade: 2 } }));
    assert.equal(foreignIncrease.statusCode, 404, 'a different tenant cannot increase an item on the command');
    const stockBeforeMismatchCancellation = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    const mismatchCancellation = await withOwnerAt(mismatchDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(mismatchCommandId)}/cancelar`, headers: { cookie }, payload: {} }));
    assert.equal(mismatchCancellation.statusCode, 200, `historical mismatch fixture still cancels through authenticated API: ${mismatchCancellation.body}`);
    const stockAfterMismatchCancellation = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    assert.deepEqual([centsExact(stockBeforeMismatchCancellation.quantidade), centsExact(stockAfterMismatchCancellation.quantidade)], ['900', '1000'], 'historical cancellation still reverses exactly the launched stock unit after a context mismatch');
    await closeOccurrenceCash(mismatchDay, 0);

    const correctDay = '2026-11-10';
    const correctSession = await openOccurrenceCash(correctDay, recurringOccurrences[0].id, true);
    const correctCommandResponse = await withOwnerAt(correctDay, (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: `occurrence-correct-${runId}`,
    } }));
    assert.equal(correctCommandResponse.statusCode, 201, `correct-context command opens: ${correctCommandResponse.body}`);
    const correctCommandId = JSON.parse(correctCommandResponse.body).id;
    const correctLaunch = await withOwnerAt(correctDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(correctCommandId)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(correctLaunch.statusCode, 201, `correct-context item launches: ${correctLaunch.body}`);
    const correctItemId = JSON.parse(correctLaunch.body).pedidos[0].itens[0].id;
    const correctOrderId = JSON.parse(correctLaunch.body).pedidos[0].id;
    const correctBefore = await db.comanda.findUniqueOrThrow({ where: { id: correctCommandId }, include: { itens: { include: { opcionais: true } }, pagamentos: true } });
    const correctStockBefore = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    const correctMovementsBefore = await db.inventoryMovement.count({ where: { pedidoId: correctOrderId } });
    const correctIncrease = await withOwnerAt(correctDay, (cookie) => app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(correctCommandId)}/itens/${encodeURIComponent(correctItemId)}`, headers: { cookie }, payload: { quantidade: 2 } }));
    assert.equal(correctIncrease.statusCode, 200, `correct-context increase succeeds: ${correctIncrease.body}`);
    const correctAfter = await db.comanda.findUniqueOrThrow({ where: { id: correctCommandId }, include: { itens: { include: { opcionais: true } }, pagamentos: true } });
    const correctStockAfter = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    assert.deepEqual([correctBefore.itens[0].quantidade, centsExact(correctBefore.total), correctAfter.itens[0].quantidade, centsExact(correctAfter.total)], [1, '950', 2, '1900'], 'correct context changes quantity by one and total by exactly one menu price');
    assert.deepEqual([centsExact(correctStockBefore.quantidade), centsExact(correctStockAfter.quantidade), await db.inventoryMovement.count({ where: { pedidoId: correctOrderId } }) - correctMovementsBefore], ['900', '800', 1], 'correct context consumes exactly one additional stock unit');
    assert.deepEqual([correctAfter.pagamentos.length, correctAfter.itens[0].precoUnit.toString(), correctAfter.itens[0].nome], [0, correctBefore.itens[0].precoUnit.toString(), correctBefore.itens[0].nome], 'increase preserves the sold item snapshot and payment ledger');
    const correctPaid = await withOwnerAt(correctDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(correctCommandId)}/pagamentos`, headers: { cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 19 }] } }));
    assert.equal(correctPaid.statusCode, 200, `correct-context command settles: ${correctPaid.body}`);
    await closeOccurrenceCash(correctDay, 19);

    const noSessionDay = '2026-11-11';
    const noSession = await openOccurrenceCash(noSessionDay, recurringOccurrences[0].id, true);
    const noSessionCommandResponse = await withOwnerAt(noSessionDay, (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: `occurrence-no-session-${runId}`,
    } }));
    assert.equal(noSessionCommandResponse.statusCode, 201);
    const noSessionCommandId = JSON.parse(noSessionCommandResponse.body).id;
    const noSessionLaunch = await withOwnerAt(noSessionDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(noSessionCommandId)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(noSessionLaunch.statusCode, 201);
    const noSessionItemId = JSON.parse(noSessionLaunch.body).pedidos[0].itens[0].id;
    await db.sessaoCaixaOperacao.update({ where: { id: noSession.id }, data: { status: 'FECHADO', fechadoEm: new Date() } });
    const noSessionBefore = await db.comanda.findUniqueOrThrow({ where: { id: noSessionCommandId }, include: { itens: { include: { opcionais: true } }, pagamentos: true } });
    const noSessionStockBefore = await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } });
    const blockedWithoutSession = await withOwnerAt(noSessionDay, (cookie) => app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(noSessionCommandId)}/itens/${encodeURIComponent(noSessionItemId)}`, headers: { cookie }, payload: { quantidade: 2 } }));
    assert.equal(blockedWithoutSession.statusCode, 400, `missing authorizing session blocks the increase: ${blockedWithoutSession.body}`);
    assert.deepEqual(plain(await db.comanda.findUniqueOrThrow({ where: { id: noSessionCommandId }, include: { itens: { include: { opcionais: true } }, pagamentos: true } })), plain(noSessionBefore), 'missing session leaves command, item snapshot and payments unchanged');
    assert.deepEqual(plain(await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } })), plain(noSessionStockBefore), 'missing session leaves stock unchanged');
    const noSessionCancel = await withOwnerAt(noSessionDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(noSessionCommandId)}/cancelar`, headers: { cookie }, payload: {} }));
    assert.equal(noSessionCancel.statusCode, 200, 'historical cancellation remains allowed when its authorizing session is closed');
    assert.deepEqual(
      centsExact((await db.inventoryBalance.findUniqueOrThrow({ where: { pontoVendaId_produtoId: { pontoVendaId: primaryPoint.id, produtoId: product.id } } })).quantidade),
      (BigInt(centsExact(noSessionStockBefore.quantidade)) + 100n).toString(),
      'historical cancellation without an open session reverses its launched inventory movement',
    );

    const closeRaceDay = '2026-11-12';
    const closeRaceSession = await openOccurrenceCash(closeRaceDay, recurringOccurrences[0].id, true);
    const closeRaceCommandResponse = await withOwnerAt(closeRaceDay, (cookie) => app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: {
      pontoVendaId: primaryPoint.id, tipo: 'APELIDO', identificador: `occurrence-close-race-${runId}`,
    } }));
    assert.equal(closeRaceCommandResponse.statusCode, 201);
    const closeRaceCommandId = JSON.parse(closeRaceCommandResponse.body).id;
    const closeRaceLaunch = await withOwnerAt(closeRaceDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(closeRaceCommandId)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: product.id, quantidade: 1 }] } }));
    assert.equal(closeRaceLaunch.statusCode, 201);
    const closeRaceItemId = JSON.parse(closeRaceLaunch.body).pedidos[0].itens[0].id;
    const cashLockDigest = createHash('sha256').update(`caixa-operacao:${primaryCompany.id}:${primaryPoint.id}:${closeRaceDay}`).digest();
    const cashLockKey = BigInt.asIntN(64, cashLockDigest.readBigUInt64BE(0));
    let signalCashLocked;
    let releaseCashLocked;
    const cashLocked = new Promise((resolve) => { signalCashLocked = resolve; });
    const cashRelease = new Promise((resolve) => { releaseCashLocked = resolve; });
    const cashHolder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${cashLockKey})`;
      signalCashLocked();
      await cashRelease;
      await tx.sessaoCaixaOperacao.update({ where: { id: closeRaceSession.id }, data: { status: 'FECHADO', fechadoEm: new Date() } });
    }, { maxWait: 15000, timeout: 30000 });
    await cashLocked;
    const concurrentIncrease = withOwnerAt(closeRaceDay, (cookie) => app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(closeRaceCommandId)}/itens/${encodeURIComponent(closeRaceItemId)}`, headers: { cookie }, payload: { quantidade: 2 } }));
    let cashLockWaiters = 0;
    const cashLockDeadline = process.hrtime.bigint() + 15_000_000_000n;
    try {
      while (process.hrtime.bigint() < cashLockDeadline) {
        const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query ILIKE '%pg_advisory_xact_lock%'`;
        cashLockWaiters = rows[0]?.count ?? 0;
        if (cashLockWaiters >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert(cashLockWaiters >= 1, `increase waits for cash close lock; waiters=${cashLockWaiters}`);
    } finally {
      releaseCashLocked();
      await cashHolder;
    }
    const closeRaceIncrease = await concurrentIncrease;
    assert.equal(closeRaceIncrease.statusCode, 400, `increase sees the closed session after waiting for the cash lock: ${closeRaceIncrease.body}`);
    const closeRaceAfter = await db.comanda.findUniqueOrThrow({ where: { id: closeRaceCommandId }, include: { itens: true, pagamentos: true } });
    assert.deepEqual([closeRaceAfter.itens[0].quantidade, centsExact(closeRaceAfter.total), closeRaceAfter.pagamentos.length], [1, '950', 0], 'close-vs-increase race leaves command and payment state unchanged');
    const closeRaceCancel = await withOwnerAt(closeRaceDay, (cookie) => app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(closeRaceCommandId)}/cancelar`, headers: { cookie }, payload: {} }));
    assert.equal(closeRaceCancel.statusCode, 200, 'cancellation remains available after a concurrent close blocks an increase');

    const kitchenGuardDay = '2026-11-13';
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: secondPoint.id }, data: { kitchenEnabled: true } });
    let preparedIncreaseStatus;
    let deliveredIncreaseStatus;
    await withSecondOwnerAt(kitchenGuardDay, async (cookie) => {
      const opened = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, trocoInicial: 0, cardapioId: secondMenu.id } });
      assert.equal(opened.statusCode, 201, `kitchen guard session opens: ${opened.body}`);
      const commandResponse = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, tipo: 'APELIDO', identificador: `kitchen-item-guard-${runId}` } });
      assert.equal(commandResponse.statusCode, 201);
      const commandId = JSON.parse(commandResponse.body).id;
      const launched = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/pedidos`, headers: { cookie }, payload: { itens: [{ produtoId: kitchenProduct.id, quantidade: 1 }] } });
      assert.equal(launched.statusCode, 201, `prepared item launches: ${launched.body}`);
      const order = JSON.parse(launched.body).pedidos[0];
      const itemId = order.itens[0].id;
      const preparedIncrease = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/itens/${encodeURIComponent(itemId)}`, headers: { cookie }, payload: { quantidade: 2 } });
      assert.equal(preparedIncrease.statusCode, 409, `item sent to kitchen keeps its quantity restriction: ${preparedIncrease.body}`);
      preparedIncreaseStatus = preparedIncrease.statusCode;
      for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) {
        const transition = await app.inject({ method: 'PATCH', url: `/api/operacao/cozinha/${encodeURIComponent(order.id)}/status`, headers: { cookie }, payload: { status } });
        assert.equal(transition.statusCode, 200, `historical kitchen confirmation to ${status} still works: ${transition.body}`);
      }
      const deliveredIncrease = await app.inject({ method: 'PATCH', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/itens/${encodeURIComponent(itemId)}`, headers: { cookie }, payload: { quantidade: 2 } });
      assert.equal(deliveredIncrease.statusCode, 409, `delivered item keeps its existing restriction: ${deliveredIncrease.body}`);
      deliveredIncreaseStatus = deliveredIncrease.statusCode;
      const paid = await app.inject({ method: 'POST', url: `/api/operacao/comandas/${encodeURIComponent(commandId)}/pagamentos`, headers: { cookie }, payload: { pagamentos: [{ forma: 'PIX', valor: 10 }] } });
      assert.equal(paid.statusCode, 200, `prepared/delivered item remains payable through historical flow: ${paid.body}`);
      const closed = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie }, payload: { pontoVendaId: secondPoint.id, contadoDinheiro: 0, contadoPix: 10, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
      assert.equal(closed.statusCode, 200, `kitchen guard cash closes: ${closed.body}`);
    });
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: secondPoint.id }, data: canonicalSettings });
    await db.configuracaoPontoVenda.update({ where: { pontoVendaId: primaryPoint.id }, data: { inventoryEnabled: false } });
    await db.produto.update({ where: { id: product.id }, data: { controlaEstoque: productStockTrackingBefore } });
    console.log(`QA_OCCURRENCE_ITEM_INCREASE=PASS; incompatible=${mismatchIncrease.statusCode}/no-write; valid=${correctIncrease.statusCode}/quantity:1->2/totalCents:950->1900/stockDelta:-1; missingSession=${blockedWithoutSession.statusCode}; cashCloseRace=${closeRaceIncrease.statusCode}/waiters:${cashLockWaiters}; tenant=${foreignIncrease.statusCode}; cancellation=reversal-verified; prepared=${preparedIncreaseStatus}; delivered=${deliveredIncreaseStatus}; legacy=${legacyIncrease.statusCode}`);

    const concurrentDay = '2026-11-07';
    const lockDigest = createHash('sha256').update(`caixa-operacao:${primaryCompany.id}:${primaryPoint.id}:${concurrentDay}`).digest();
    const lockKey = BigInt.asIntN(64, lockDigest.readBigUInt64BE(0));
    let signalLocked;
    let releaseLocked;
    const locked = new Promise((resolve) => { signalLocked = resolve; });
    const release = new Promise((resolve) => { releaseLocked = resolve; });
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
      signalLocked();
      await release;
    }, { maxWait: 15000, timeout: 30000 });
    await locked;
    const concurrentCalls = withOwnerAt(concurrentDay, (cookie) => Promise.all([
      app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: recurringOccurrences[0].id, confirmarDataDiferente: true } }),
      app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: recurringOccurrences[1].id, confirmarDataDiferente: true } }),
    ]));
    let lockWaiters = 0;
    const deadline = process.hrtime.bigint() + 15_000_000_000n;
    try {
      while (process.hrtime.bigint() < deadline) {
        const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query ILIKE '%pg_advisory_xact_lock%'`;
        lockWaiters = rows[0]?.count ?? 0;
        if (lockWaiters >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert(lockWaiters >= 2, `both API calls reached the PostgreSQL advisory lock; waiters=${lockWaiters}`);
    } finally {
      releaseLocked();
      await holder;
    }
    const concurrentResponses = await concurrentCalls;
    assert.equal(concurrentResponses.filter((response) => response.statusCode === 201).length, 1, `one concurrent opening wins: ${concurrentResponses.map((response) => response.statusCode)}`);
    assert.equal(concurrentResponses.filter((response) => response.statusCode >= 400).length, 1);
    const concurrentSession = await db.sessaoCaixaOperacao.findFirstOrThrow({ where: { cervejariaId: primaryCompany.id, pontoVendaId: primaryPoint.id, diaOperacional: new Date('2026-11-07T00:00:00.000Z') } });
    assert([recurringOccurrences[0].id, recurringOccurrences[1].id].includes(concurrentSession.ocorrenciaId));
    const retryOccurrence = concurrentSession.ocorrenciaId === recurringOccurrences[0].id ? recurringOccurrences[1].id : recurringOccurrences[0].id;
    const beforeRetry = plain(concurrentSession);
    const retry = await withOwnerAt(concurrentDay, (cookie) => app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie }, payload: { pontoVendaId: primaryPoint.id, trocoInicial: 0, cardapioId: menuA.id, ocorrenciaId: retryOccurrence } }));
    assert.equal(retry.statusCode, 400, `retry cannot change occurrence: ${retry.body}`);
    assert.deepEqual(plain(await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: concurrentSession.id } })), beforeRetry);
    await closeOccurrenceCash(concurrentDay, 0);
    occurrenceProofs.push({ kind: 'concurrent-open', winners: 1, advisoryLockWaiters: lockWaiters, sessionId: concurrentSession.id, occurrenceId: concurrentSession.ocorrenciaId, retryStatus: retry.statusCode });

    settingsApiProofs.push({ ownerGet: 200, ownerPatch: 200, adminGet: 200, adminPatch: 200, mesasZero: 0, explicitFalse: true, noStockConfirmation: 400, kitchenOffWithActiveOrder: 409, kitchenRecalcCents: [centsExact(totalBeforeKitchenCharge.total), centsExact(repricedCommand.total)], pendingPayment: rejectedPendingPayment.statusCode, modeChange: JSON.parse(eventModeRequest.body).code, legacyActivationOff: [legacyConfigRead.statusCode, legacyConfigWrite.statusCode] });

    const summary = {
      login: [200, 200, 200], missingCredential: missing.statusCode, invalidToken: invalid.statusCode,
      attendantOwnerOnly: attendantOwnerOnly.statusCode, crossTenantRead: foreignRead.statusCode, crossTenantWrite: foreignWrite.statusCode,
      canonicalBlockers: blockerFixtures.map(({ name, expectedCode }) => ({ name, code: expectedCode, status: 409 })),
      operationFlows, kitchenSettingProofs, settingsApiProofs, occurrenceProofs,
    };
    console.log(`QA_AUTHENTICATED_CASH=PASS; ${JSON.stringify(summary)}`);
  } finally {
    try {
      await app.close();
    } finally {
      try {
        await runtimePrisma.$disconnect();
      } finally {
        if (previousCanonicalFlag === undefined) delete process.env.PDV_CANONICAL_CONFIG_QA;
        else process.env.PDV_CANONICAL_CONFIG_QA = previousCanonicalFlag;
        if (previousQaMode === undefined) delete process.env.QA_MODE;
        else process.env.QA_MODE = previousQaMode;
      }
    }
  }
}
async function proveLegacyOrderContextPreflight(args) {
  const { history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, generatedClientDir, databaseUrl, runId } = args;
  const container = process.env.PDV_QA_CONTAINER;
  assert.match(container ?? '', /^codex-pdv-commerce-qa-[a-f0-9]+$/, 'preflight must run in the owned disposable container');
  // Exercise the actual shared include against a pinned pre-additive schema.
  // This database intentionally has no ConfiguracaoPontoVenda relation/table.
  const legacySchemaBytes = readPinnedBlob(core.baseCommit, manifest.preCommerceSchema.path);
  const legacyClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-no-canonical-client-${runId}`);
  const legacySchemaPath = path.join(tempRoot, 'pre-canonical-schema.prisma');
  const legacyGeneratePath = path.join(tempRoot, 'generate-pre-canonical-schema.prisma');
  const legacySchemaText = legacySchemaBytes.toString('utf8');
  await writeFile(legacySchemaPath, legacySchemaBytes);
  await writeFile(legacyGeneratePath, legacySchemaText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${legacyClientDir.replaceAll('\\', '/')}"`));
  runPrisma(['validate', '--schema', legacySchemaPath]);
  runPrisma(['generate', '--schema', legacyGeneratePath]);
  const noCanonicalDbName = `pdv_no_canonical_${runId.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`;
  const noCanonicalCreated = spawnSync('docker', ['exec', container, 'createdb', '-U', 'postgres', noCanonicalDbName], { encoding: 'utf8', windowsHide: true });
  assert.equal(noCanonicalCreated.status, 0, 'temporary no-additive-table database created in owned QA container');
  const noCanonicalUrl = new URL(databaseUrl); noCanonicalUrl.pathname = `/${noCanonicalDbName}`;
  const noCanonicalRoot = path.join(tempRoot, 'no-canonical-config');
  const noCanonicalBundle = await materializePinnedMigrationBundle(history, noCanonicalRoot);
  const legacyDeploy = runPrisma(['migrate', 'deploy', '--schema', noCanonicalBundle.schemaPath], noCanonicalUrl.toString());
  assert.equal(legacyDeploy.status, 0, 'pinned legacy schema deploys without canonical configuration migration');
  const { INCLUDE_COMANDA_OPERACAO } = await import('../src/lib/operacao/comanda-adapter.ts');
  assert.equal('configuracaoPdv' in INCLUDE_COMANDA_OPERACAO.pontoVenda.select, false, 'shared include omits the additive configuration relation');
  const { PrismaClient: LegacyPrismaClient } = await import(pathToFileURL(path.join(legacyClientDir, 'index.js')).href);
  const noCanonicalDb = new LegacyPrismaClient({ datasources: { db: { url: noCanonicalUrl.toString() } }, errorFormat: 'minimal' });
  try {
    const oldCompany = await noCanonicalDb.cervejaria.create({ data: { id: `no-canonical-company-${runId}`, nome: 'Synthetic legacy schema', slug: `no-canonical-${runId}` } });
    const oldPoint = await noCanonicalDb.pontoVenda.create({ data: { id: `no-canonical-point-${runId}`, cervejariaId: oldCompany.id, nome: 'Legacy point' } });
    const oldCommand = await noCanonicalDb.comanda.create({ data: { id: `no-canonical-command-${runId}`, origem: 'CAIXA', pontoVendaId: oldPoint.id, status: 'ABERTA', total: '10.00' } });
    const table = await noCanonicalDb.$queryRaw`SELECT to_regclass('"ConfiguracaoPontoVenda"')::text AS relation_name`;
    assert.equal(table[0].relation_name, null, 'additive canonical configuration table is absent in this database');
    const previousCanonicalFlag = process.env.PDV_CANONICAL_CONFIG_QA;
    delete process.env.PDV_CANONICAL_CONFIG_QA;
    try {
      const queried = await noCanonicalDb.comanda.findUnique({ where: { id: oldCommand.id }, include: INCLUDE_COMANDA_OPERACAO });
      assert.equal(queried?.id, oldCommand.id, 'the production-shared comanda include query succeeds without the additive table when activation is off');
    } finally {
      if (previousCanonicalFlag === undefined) delete process.env.PDV_CANONICAL_CONFIG_QA;
      else process.env.PDV_CANONICAL_CONFIG_QA = previousCanonicalFlag;
    }
    console.log('QA_STAGE=legacy-comanda-include-without-canonical-table; activation=off; query=PASS; relation=absent');
  } finally {
    await noCanonicalDb.$disconnect();
    const dropped = spawnSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', noCanonicalDbName], { encoding: 'utf8', windowsHide: true });
    assert.equal(dropped.status, 0, 'only owned disposable no-canonical QA database is removed');
  }
  const schemaBytes = readPinnedBlob(manifest.preCommerceSchema.commit, manifest.preCommerceSchema.path);
  assert.equal(sha256(schemaBytes), manifest.preCommerceSchema.sha256, 'pinned pre-commerce Prisma schema');
  const clientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-preflight-client-${runId}`);
  const schemaPath = path.join(tempRoot, 'pre-commerce-schema.prisma');
  const generatePath = path.join(tempRoot, 'generate-pre-commerce-schema.prisma');
  const schemaText = schemaBytes.toString('utf8');
  await writeFile(schemaPath, schemaBytes);
  await writeFile(generatePath, schemaText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${clientDir.replaceAll('\\', '/')}"`));
  runPrisma(['validate', '--schema', schemaPath]);
  runPrisma(['generate', '--schema', generatePath]);

  const databaseName = `pdv_preflight_${runId.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`;
  const created = spawnSync('docker', ['exec', container, 'createdb', '-U', 'postgres', databaseName], { encoding: 'utf8', windowsHide: true });
  assert.equal(created.status, 0, 'temporary preflight database created only inside this owned QA container');
  const target = new URL(databaseUrl); target.pathname = `/${databaseName}`;
  const preflightUrl = target.toString();
  const preflightRoot = path.join(tempRoot, 'legacy-preflight');
  const bundle = await materializePinnedMigrationBundle(history, preflightRoot);
  const coreSql = await readFile(path.join(repoRoot, core.migrationPath));
  const catalogSql = await readFile(path.join(repoRoot, catalog.delivery.migrationPath));
  const financeSql = await readFile(path.join(repoRoot, finance.delivery.migrationPath));
  const historicalProvenanceSql = await readFile(path.join(repoRoot, manifest.priorManifests.finance.historicalProvenanceMigration.path));
  for (const [name, sql] of [
    [core.migrationName, coreSql],
    [catalog.delivery.migrationName, catalogSql],
    [manifest.priorManifests.session.name, sessionSql],
    [finance.delivery.migrationName, financeSql],
    [manifest.priorManifests.finance.historicalProvenanceMigration.name, historicalProvenanceSql],
  ]) {
    const dir = path.join(bundle.migrationsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'migration.sql'), sql);
  }
  const beforeCommerce = runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], preflightUrl);
  assert.equal(beforeCommerce.status, 0, 'legacy preflight schema chain deploys through finance scope');
  const module = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
  const legacyDb = new module.PrismaClient({ datasources: { db: { url: preflightUrl } }, errorFormat: 'minimal' });
  try {
    const company = await legacyDb.cervejaria.create({ data: { id: `preflight-company-${runId}`, nome: 'Synthetic legacy preflight', slug: `preflight-${runId}` } });
    await legacyDb.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: false, quantidadeMesas: 2, createdAt: new Date('2026-12-01T08:00:00.000Z'), updatedAt: new Date('2026-12-01T09:00:00.000Z') } });
    const point = await legacyDb.pontoVenda.create({ data: { id: `preflight-point-${runId}`, cervejariaId: company.id, nome: 'Synthetic point' } });
    const product = await legacyDb.produto.create({ data: { id: `preflight-product-${runId}`, cervejariaId: company.id, nome: 'Synthetic legacy product' } });
    const operator = await legacyDb.usuario.create({ data: { id: `preflight-user-${runId}`, nome: 'Synthetic operator', email: `preflight-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
    const command = await legacyDb.comanda.create({ data: { id: `preflight-command-${runId}`, origem: 'CAIXA', pontoVendaId: point.id, status: 'ABERTA', total: '1.00' } });
    const order = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-order-a-${runId}`, cervejariaId: company.id, comandaId: command.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-01T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: operator.id } });
    const movementlessOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-order-b-${runId}`, cervejariaId: company.id, comandaId: command.id, pontoVendaId: null, numero: 2, diaOperacional: new Date('2026-12-01T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: operator.id } });
    const movement = await legacyDb.inventoryMovement.create({ data: { id: `preflight-movement-${runId}`, cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, pedidoId: order.id, tipo: 'SAIDA_VENDA', quantidade: '0.125', registradoPorId: operator.id } });
    const secondCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-second-company-${runId}`, nome: 'Synthetic second tenant', slug: `preflight-second-${runId}` } });
    const secondPoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-second-point-${runId}`, cervejariaId: secondCompany.id, nome: 'Synthetic second PDV' } });
    // Real EVENTO kitchen-order path: no initial PDV, one Trailer, dated Event,
    // and orders with/without stock movement. This runs before the commercial SQL.
    const eventCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-event-company-${runId}`, nome: 'Synthetic Event order tenant', slug: `preflight-event-${runId}` } });
    await legacyDb.configuracaoOperacao.create({ data: { cervejariaId: eventCompany.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: false, quantidadeMesas: 0, createdAt: new Date('2026-12-04T08:00:00.000Z'), updatedAt: new Date('2026-12-04T09:00:00.000Z') } });
    const eventTrailer = await legacyDb.trailer.create({ data: { id: `preflight-event-trailer-${runId}`, cervejariaId: eventCompany.id, nome: 'Synthetic Event trailer', identificador: `EVENT-${runId}` } });
    const eventOperator = await legacyDb.usuario.create({ data: { id: `preflight-event-user-${runId}`, nome: 'Synthetic Event operator', email: `preflight-event-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: eventCompany.id } });
    const eventProduct = await legacyDb.produto.create({ data: { id: `preflight-event-product-${runId}`, cervejariaId: eventCompany.id, nome: 'Synthetic Event product' } });
    const sourceEvent = await legacyDb.evento.create({ data: { id: `preflight-event-${runId}`, cervejariaId: eventCompany.id, trailerId: eventTrailer.id, nome: 'Synthetic dated Event', local: 'QA', data: new Date('2026-12-04T00:00:00.000Z'), horaInicio: '18:00', horaFim: '22:00', status: 'ABERTO', recorrencia: 'NENHUMA', createdAt: new Date('2026-12-04T10:00:00.000Z'), updatedAt: new Date('2026-12-04T11:00:00.000Z') } });
    const eventCommand = await legacyDb.comanda.create({ data: { id: `preflight-event-command-${runId}`, origem: 'EVENTO', eventoId: sourceEvent.id, status: 'ABERTA', total: '0.00', createdAt: new Date('2026-12-04T12:00:00.000Z'), updatedAt: new Date('2026-12-04T12:00:00.000Z') } });
    const eventOrderWithMovement = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-event-order-a-${runId}`, cervejariaId: eventCompany.id, comandaId: eventCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-04T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:01:00.000Z'), updatedAt: new Date('2026-12-04T12:02:00.000Z') } });
    const eventOrderWithoutMovement = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-event-order-b-${runId}`, cervejariaId: eventCompany.id, comandaId: eventCommand.id, pontoVendaId: null, numero: 2, diaOperacional: new Date('2026-12-04T00:00:00.000Z'), status: 'EM_PREPARO', criadoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:03:00.000Z'), updatedAt: new Date('2026-12-04T12:04:00.000Z') } });
    const eventCommandOrderLinked = await legacyDb.comanda.create({ data: { id: `preflight-event-command-order-linked-${runId}`, origem: 'EVENTO', eventoId: sourceEvent.id, status: 'ABERTA', total: '0.00' } });
    const eventOrderAlreadyLinked = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-event-order-linked-${runId}`, cervejariaId: eventCompany.id, comandaId: eventCommandOrderLinked.id, pontoVendaId: null, numero: 5, diaOperacional: new Date('2026-12-04T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:05:00.000Z'), updatedAt: new Date('2026-12-04T12:06:00.000Z') } });
    const commerceDir = path.join(bundle.migrationsDir, manifest.delivery.migrationName);
    await mkdir(commerceDir, { recursive: true });
    await writeFile(path.join(commerceDir, 'migration.sql'), commerceSql);
    const failedDeploy = runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], preflightUrl, true);
    assert.notEqual(failedDeploy.status, 0, 'legacy order with missing PDV must block the composite-FK migration before backfill');
    assert.match(failedDeploy.output, /PDV_COMMERCE_PREFLIGHT_ORDER_CONTEXT_REQUIRED/, 'migration reports the explicit preflight blocker');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, null, 'preflight does not invent a link');
    assert.equal((await legacyDb.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.125', 'legacy stock movement survives the blocked migration');
    const ddl = await legacyDb.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_constraint WHERE conname = 'MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey'`;
    assert.equal(ddl[0].count, 0, 'candidate DDL did not partially add the final constraint');
    console.log('QA_STAGE=legacy-preexisting-order-context-preflight-blocked; code=PDV_COMMERCE_PREFLIGHT_ORDER_CONTEXT_REQUIRED; orderLink=unchanged-null; stockMovement=preserved');

    // The preparation uses the same pre-commercial Prisma Client and the real restartable runner.
    // Confirm the canonical PDV map first, as required by the operational migration chain.
    const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
    const { runPdvCatalogMigration, runPdvKitchenOrderContextPreparation } = await import('./pdv-unico-catalog-migrator.ts');
    const { readPdvKitchenOrderPreparationSnapshot, buildPdvKitchenOrderPreparationItems, pdvKitchenPreparationPayloadHash, PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE } = await import('./pdv-unico-kitchen-order-preparation.ts');
    const business = await runPdvBusinessMigration({ db: legacyDb, companyId: company.id, runId: `preflight-business-${runId}` });
    assert.equal(business.status, 'COMPLETED', JSON.stringify(business));
    const catalogRunId = `preflight-catalog-${runId}`;
    const catalogResult = await runPdvCatalogMigration({ db: legacyDb, companyId: company.id, pointId: point.id, runId: catalogRunId });
    assert.equal(catalogResult.status, 'COMPLETED', JSON.stringify(catalogResult));
    const eventBusinessRunId = `preflight-event-business-${runId}`;
    assert.equal((await runPdvBusinessMigration({ db: legacyDb, companyId: eventCompany.id, runId: eventBusinessRunId })).status, 'COMPLETED');
    const eventPoint = await legacyDb.pontoVenda.findFirstOrThrow({ where: { cervejariaId: eventCompany.id } });
    assert.equal(eventPoint.id, eventTrailer.id, 'a sole Trailer creates a stable canonical PDV for Event-only tenant');
    await legacyDb.pedidoOperacao.update({ where: { id: eventOrderAlreadyLinked.id }, data: { pontoVendaId: eventPoint.id, updatedAt: new Date('2026-12-04T12:06:00.000Z') } });
    const eventCatalogRunId = `preflight-event-catalog-${runId}`;
    assert.equal((await runPdvCatalogMigration({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventCatalogRunId })).status, 'COMPLETED');
    const eventStockMovement = await legacyDb.inventoryMovement.create({ data: { id: `preflight-event-movement-${runId}`, cervejariaId: eventCompany.id, pontoVendaId: eventPoint.id, produtoId: eventProduct.id, pedidoId: eventOrderWithMovement.id, tipo: 'SAIDA_VENDA', quantidade: '0.375', registradoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:05:00.000Z') } });
    const legacyLinkedEventCommand = await legacyDb.comanda.create({ data: { id: `preflight-event-legacy-command-${runId}`, origem: 'EVENTO', eventoId: sourceEvent.id, pontoVendaId: eventPoint.id, status: 'ABERTA', total: '0.00', createdAt: new Date('2026-12-04T12:06:00.000Z'), updatedAt: new Date('2026-12-04T12:06:00.000Z') } });
    const legacyLinkedEventOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-event-legacy-order-${runId}`, cervejariaId: eventCompany.id, comandaId: legacyLinkedEventCommand.id, pontoVendaId: null, numero: 3, diaOperacional: new Date('2026-12-04T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:07:00.000Z'), updatedAt: new Date('2026-12-04T12:08:00.000Z') } });
    const legacyLinkedEventMovement = await legacyDb.inventoryMovement.create({ data: { id: `preflight-event-legacy-movement-${runId}`, cervejariaId: eventCompany.id, pontoVendaId: eventPoint.id, produtoId: eventProduct.id, pedidoId: legacyLinkedEventOrder.id, tipo: 'SAIDA_VENDA', quantidade: '0.250', registradoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:09:00.000Z') } });
    const legacyCommandOrderLinked = await legacyDb.comanda.create({ data: { id: `preflight-event-legacy-command-order-linked-${runId}`, origem: 'EVENTO', eventoId: sourceEvent.id, pontoVendaId: eventPoint.id, status: 'ABERTA', total: '0.00' } });
    const legacyOrderAlreadyLinked = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-event-legacy-order-linked-${runId}`, cervejariaId: eventCompany.id, comandaId: legacyCommandOrderLinked.id, pontoVendaId: eventPoint.id, numero: 4, diaOperacional: new Date('2026-12-04T00:00:00.000Z'), status: 'EM_PREPARO', criadoPorId: eventOperator.id, createdAt: new Date('2026-12-04T12:10:00.000Z'), updatedAt: new Date('2026-12-04T12:11:00.000Z') } });
    const legacyEventPreparationPayload = (snapshot, orderId) => {
      const order = snapshot.orders.find((row) => row.id === orderId);
      return { order: { ...order, pontoVendaId: null, pontoVenda: null }, command: { id: order.comanda.id, origem: order.comanda.origem, eventoId: order.comanda.eventoId, pontoVendaId: order.comanda.pontoVendaId, evento: order.comanda.evento, pontoVenda: order.comanda.pontoVenda }, movements: snapshot.movements.filter((row) => row.pedidoId === orderId), authoritativePointId: eventPoint.id };
    };
    const legacySourceSnapshot = await readPdvKitchenOrderPreparationSnapshot(legacyDb, eventCompany.id);
    const legacySourceCommand = legacySourceSnapshot.orders.find((row) => row.id === legacyLinkedEventOrder.id).comanda;
    assert.equal(legacySourceCommand.pontoVendaId, eventPoint.id);
    assert.equal(await legacyDb.pdvMigrationMap.count({ where: { sourceType: 'COMANDA', sourceId: legacyLinkedEventCommand.id } }), 0, 'legacy fixture has no commercial COMANDA map');
    await legacyDb.comanda.update({ where: { id: legacyLinkedEventCommand.id }, data: { pontoVendaId: secondPoint.id } });
    const foreignTenantLegacyLink = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-legacy-foreign-tenant-${runId}` });
    assert.deepEqual([foreignTenantLegacyLink.status, foreignTenantLegacyLink.code], ['BLOCKED', 'KITCHEN_ORDER_LEGACY_PDV_UNPROVEN'], 'pre-commercial EVENTO link to a different tenant is rejected by the real runner');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: legacyLinkedEventOrder.id } })).pontoVendaId, null, 'foreign-tenant rejection leaves the order unmodified');
    await legacyDb.comanda.update({ where: { id: legacyLinkedEventCommand.id }, data: { pontoVendaId: eventPoint.id } });
    console.log('QA_STAGE=legacy-event-command-pdv-regression-fixture; old-classifier-runtime-block=KITCHEN_ORDER_COMMERCE_MAP_MISSING (reproduced before fix); map=absent');
    const sourceBeforeEventPreparation = await readPdvKitchenOrderPreparationSnapshot(legacyDb, eventCompany.id);
    const alreadyLinkedSourceBeforePreparation = plain(sourceBeforeEventPreparation.orders.find((row) => row.id === eventOrderAlreadyLinked.id));
    const fourPdvStateOrderIds = new Set([eventOrderWithMovement.id, eventOrderAlreadyLinked.id, legacyLinkedEventOrder.id, legacyOrderAlreadyLinked.id]);
    assert.deepEqual(new Map(sourceBeforeEventPreparation.orders.filter((row) => fourPdvStateOrderIds.has(row.id)).map((row) => [row.id, [row.comanda.pontoVendaId, row.pontoVendaId]])), new Map([
      [eventOrderWithMovement.id, [null, null]],
      [eventOrderAlreadyLinked.id, [null, eventPoint.id]],
      [legacyLinkedEventOrder.id, [eventPoint.id, null]],
      [legacyOrderAlreadyLinked.id, [eventPoint.id, eventPoint.id]],
    ]), 'pre-commercial fixtures cover command/order PDV states null/null, null/set, set/null and set/set');
    const eventPreparationRunId = `preflight-event-preparation-${runId}`;
    const eventPreparation = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventPreparationRunId });
    assert.equal(eventPreparation.status, 'COMPLETED', JSON.stringify(eventPreparation));
    const eventOrderIds = [eventOrderWithMovement.id, eventOrderWithoutMovement.id, eventOrderAlreadyLinked.id, legacyLinkedEventOrder.id, legacyOrderAlreadyLinked.id].sort();
    const eventPreparationMaps = await legacyDb.pdvMigrationMap.findMany({ where: { sourceType: PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, sourceId: { in: eventOrderIds } }, orderBy: { sourceId: 'asc' } });
    assert.deepEqual(eventPreparationMaps.map((row) => row.sourceId), eventOrderIds, 'preparation certifies every eligible EVENTO order, including an already-correct PDV that needs no write');
    const evidenceByOrder = new Map(eventPreparationMaps.map((row) => [row.sourceId, row.sourcePayload.orderLinkEvidence]));
    assert.deepEqual(evidenceByOrder.get(eventOrderWithMovement.id), { sourcePdvId: null, origin: 'UNLINKED_SOURCE' });
    assert.deepEqual(evidenceByOrder.get(eventOrderAlreadyLinked.id), { sourcePdvId: eventPoint.id, origin: 'PREEXISTING_SOURCE_LINK' });
    assert.deepEqual(evidenceByOrder.get(legacyLinkedEventOrder.id), { sourcePdvId: null, origin: 'UNLINKED_SOURCE' });
    assert.deepEqual(evidenceByOrder.get(legacyOrderAlreadyLinked.id), { sourcePdvId: eventPoint.id, origin: 'PREEXISTING_SOURCE_LINK' });
    assert.deepEqual(new Map(eventPreparationMaps.map((row) => [row.sourceId, row.sourcePayload.commandLinkEvidence])).get(eventOrderAlreadyLinked.id), { sourcePdvId: null, origin: 'UNLINKED_SOURCE' });
    assert.deepEqual(new Map(eventPreparationMaps.map((row) => [row.sourceId, row.sourcePayload.commandLinkEvidence])).get(eventOrderWithMovement.id), { sourcePdvId: null, origin: 'UNLINKED_SOURCE' });
    assert.deepEqual(new Map(eventPreparationMaps.map((row) => [row.sourceId, row.sourcePayload.commandLinkEvidence])).get(legacyOrderAlreadyLinked.id), { sourcePdvId: eventPoint.id, origin: 'LEGACY_SOURCE_LINK' });
    assert.deepEqual(new Map(eventPreparationMaps.map((row) => [row.sourceId, row.sourcePayload.commandLinkEvidence])).get(legacyLinkedEventOrder.id), { sourcePdvId: eventPoint.id, origin: 'LEGACY_SOURCE_LINK' });
    const preparedAlreadyLinked = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: eventOrderAlreadyLinked.id }, select: { id: true, pontoVendaId: true, status: true, createdAt: true, updatedAt: true } });
    assert.deepEqual([preparedAlreadyLinked.id, preparedAlreadyLinked.pontoVendaId, preparedAlreadyLinked.status, preparedAlreadyLinked.createdAt.toISOString(), preparedAlreadyLinked.updatedAt.toISOString()], [eventOrderAlreadyLinked.id, eventPoint.id, eventOrderAlreadyLinked.status, eventOrderAlreadyLinked.createdAt.toISOString(), eventOrderAlreadyLinked.updatedAt.toISOString()], 'certifying an existing correct order PDV does not rewrite order fields or timestamps');
    assert.deepEqual(plain((await readPdvKitchenOrderPreparationSnapshot(legacyDb, eventCompany.id)).orders.find((row) => row.id === eventOrderAlreadyLinked.id)), alreadyLinkedSourceBeforePreparation, 'already-linked order fields, relation snapshots and timestamps are byte-equivalent across certification');
    const eventOrderMapBeforeRecovery = eventPreparationMaps.find((row) => row.sourceId === eventOrderWithMovement.id);
    assert.equal(eventOrderMapBeforeRecovery.lastRunId, eventPreparationRunId, 'lastRunId points to the exact preparation run used for the recovery test');
    const eventCheckpointBeforeTamper = plain((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: eventPreparationRunId } })).checkpoint);
    const eventBatchesBeforeTamper = plain(await legacyDb.pdvMigrationBatch.findMany({ where: { runId: eventPreparationRunId }, orderBy: { sequence: 'asc' } }));
    const originalTamperFixture = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: eventOrderWithMovement.id }, select: { observacao: true, updatedAt: true } });
    await legacyDb.pedidoOperacao.update({ where: { id: eventOrderWithMovement.id }, data: { observacao: 'temporary certification tamper' } });
    const blockedBySourceTamper = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventPreparationRunId });
    assert.equal(blockedBySourceTamper.status, 'BLOCKED', 'changed source content blocks the same certified preparation run');
    assert.equal((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: eventPreparationRunId } })).status, 'BLOCKED');
    const stillDivergent = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventPreparationRunId });
    assert.equal(stillDivergent.status, 'BLOCKED', 'the run remains blocked while the source divergence exists');
    assert.equal(stillDivergent.code, 'RUN_SCOPE_OR_SNAPSHOT_MISMATCH', 'the still-divergent source is rejected by full snapshot revalidation');
    assert.deepEqual(plain((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: eventPreparationRunId } })).checkpoint), eventCheckpointBeforeTamper, 'checkpoint remains at its original confirmed prefix while source is divergent');
    await legacyDb.pedidoOperacao.update({ where: { id: eventOrderWithMovement.id }, data: { observacao: originalTamperFixture.observacao, updatedAt: originalTamperFixture.updatedAt } });
    const eventPreparationRecovered = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventPreparationRunId });
    assert.equal(eventPreparationRecovered.status, 'COMPLETED', `same BLOCKED run resumes only after original source content is restored and fully revalidated: ${JSON.stringify(eventPreparationRecovered)}`);
    assert.deepEqual(plain(eventPreparationRecovered.checkpoint), eventCheckpointBeforeTamper, 'recovery reuses the existing confirmed checkpoint and receipts without rewriting them');
    assert.deepEqual(plain(await legacyDb.pdvMigrationBatch.findMany({ where: { runId: eventPreparationRunId }, orderBy: { sequence: 'asc' } })), eventBatchesBeforeTamper, 'same-run recovery does not rewrite historical confirmed batches or receipts');
    assert.equal((await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-preparation-new-run-${runId}` })).status, 'COMPLETED', 'new run revalidates and reuses stable maps after same-run recovery');
    const legacyPreparationMap = await legacyDb.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, sourceId: legacyLinkedEventOrder.id } } });
    assert.deepEqual(legacyPreparationMap.sourcePayload.commandLinkEvidence, { sourcePdvId: eventPoint.id, origin: 'LEGACY_SOURCE_LINK' }, 'preparation hash preserves the validated legacy source-link identity and provenance');
    const legacyWrongPdvSnapshot = { ...legacySourceSnapshot, orders: legacySourceSnapshot.orders.map((row) => row.id === legacyLinkedEventOrder.id ? { ...row, comanda: { ...row.comanda, pontoVendaId: 'wrong-pdv', pontoVenda: { id: 'wrong-pdv', cervejariaId: eventCompany.id } } } : row) };
    assert.throws(() => buildPdvKitchenOrderPreparationItems({ companyId: eventCompany.id, pointId: eventPoint.id, confirmedPdvSourceKey: `PDV:${eventPoint.id}`, snapshot: legacyWrongPdvSnapshot, confirmedOccurrences: { [sourceEvent.id]: { id: sourceEvent.id, companyId: eventCompany.id, pointId: eventPoint.id } }, confirmedCommercialCommands: new Set([legacyLinkedEventCommand.id]), commandLinkEvidence: new Map([[legacyLinkedEventCommand.id, { sourcePdvId: 'wrong-pdv', origin: 'LEGACY_SOURCE_LINK' }]]) }), (error) => error.code === 'KITCHEN_ORDER_COMMAND_PDV_CONFLICT', 'legacy link with a different PDV remains blocked');
    const legacyCrossTenantSnapshot = { ...legacySourceSnapshot, orders: legacySourceSnapshot.orders.map((row) => row.id === legacyLinkedEventOrder.id ? { ...row, comanda: { ...row.comanda, pontoVendaId: secondPoint.id, pontoVenda: { id: secondPoint.id, cervejariaId: secondCompany.id } } } : row) };
    assert.throws(() => buildPdvKitchenOrderPreparationItems({ companyId: eventCompany.id, pointId: eventPoint.id, confirmedPdvSourceKey: `PDV:${eventPoint.id}`, snapshot: legacyCrossTenantSnapshot, confirmedOccurrences: { [sourceEvent.id]: { id: sourceEvent.id, companyId: eventCompany.id, pointId: eventPoint.id } }, confirmedCommercialCommands: new Set([legacyLinkedEventCommand.id]), commandLinkEvidence: new Map([[legacyLinkedEventCommand.id, { sourcePdvId: secondPoint.id, origin: 'LEGACY_SOURCE_LINK' }]]) }), (error) => error.code === 'KITCHEN_ORDER_COMMAND_PDV_CONFLICT', 'legacy cross-tenant PDV link remains blocked');
    const eventPreparationBeforeCommercial = await readPdvKitchenOrderPreparationSnapshot(legacyDb, eventCompany.id);
    const legacyPreparationHashBeforeCommercial = pdvKitchenPreparationPayloadHash(legacyEventPreparationPayload(eventPreparationBeforeCommercial, eventOrderWithMovement.id));
    assert.deepEqual((await legacyDb.pedidoOperacao.findMany({ where: { id: { in: [eventOrderWithMovement.id, eventOrderWithoutMovement.id] } }, orderBy: { id: 'asc' }, select: { id: true, pontoVendaId: true, createdAt: true, updatedAt: true } })).map((row) => [row.id, row.pontoVendaId, row.createdAt.toISOString(), row.updatedAt.toISOString()]), [eventOrderWithMovement, eventOrderWithoutMovement].sort((a,b) => a.id.localeCompare(b.id)).map((row) => [row.id, eventPoint.id, row.createdAt.toISOString(), row.updatedAt.toISOString()]), 'pre-commercial Event preparation preserves IDs and timestamps with/without movement');
    const preparationRunId = `preflight-order-preparation-${runId}`;
    const paused = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId, batchSize: 1, maxBatches: 1 });
    assert.equal(paused.status, 'RUNNING', `one proven order is committed as one checkpointed batch: ${JSON.stringify(paused)}`);
    const failureCheckpoint = plain(paused.checkpoint);
    const orderBeforeFailure = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } });
    const movementlessOrderBeforeFailure = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } });
    await assert.rejects(runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId, afterDestinationWrite: (row) => { if (row.id === movementlessOrder.id) throw new Error('QA_KITCHEN_PREPARATION_ROLLBACK'); } }), /QA_KITCHEN_PREPARATION_ROLLBACK/);
    assert.deepEqual(plain((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: preparationRunId } })).checkpoint), failureCheckpoint, 'intra-batch failure retains the prior confirmed checkpoint');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, orderBeforeFailure.pontoVendaId, 'intra-batch write was rolled back');
    const failedOrderAfterRollback = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } });
    assert.equal(failedOrderAfterRollback.pontoVendaId, movementlessOrderBeforeFailure.pontoVendaId, 'the exact order whose write threw remains unlinked');
    assert.equal(await legacyDb.pdvMigrationMap.count({ where: { sourceType: PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, sourceId: movementlessOrder.id } }), 0, 'failed order has no map');
    const rollbackBatches = await legacyDb.pdvMigrationBatch.findMany({ where: { runId: preparationRunId }, orderBy: { sequence: 'asc' } });
    assert.equal(rollbackBatches.length, 1, 'failed second order has no partial batch');
    assert.equal(rollbackBatches[0].status, 'CONFIRMED');
    assert.deepEqual((rollbackBatches[0].checkpoint).receipts.map((row) => row.sourceId), [order.id], 'only the first confirmed order has a receipt');
    const prepared = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(prepared.status, 'COMPLETED', JSON.stringify(prepared));
    const preparedOrder = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(preparedOrder.pontoVendaId, point.id, 'only context proven by the comanda and canonical map is assigned');
    assert.equal(preparedOrder.id, order.id);
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).pontoVendaId, point.id, 'a same-tenant CAIXA comanda is sufficient authority even without stock movement');
    assert.equal((await legacyDb.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.125', 'movement identity and exact quantity are unchanged');
    const preparationReplay = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(preparationReplay.status, 'COMPLETED', 'same-run preparation replay revalidates');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id, 'replay does not alter the assignment');

    // Same-run and new-run corruption checks verify the certificate without repairing its destination.
    const newRunReplay = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: `preflight-order-preparation-replay-${runId}` });
    assert.equal(newRunReplay.status, 'COMPLETED', 'new run reuses stable preparation maps');
    const originalOrderState = await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } });
    const originalStatus = originalOrderState.status;
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { status: 'CANCELADO', updatedAt: originalOrderState.updatedAt } });
    const sourceTamper = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(sourceTamper.status, 'BLOCKED');
    assert.equal(sourceTamper.code, 'RUN_SCOPE_OR_SNAPSHOT_MISMATCH', 'the certified source photograph changes and invalidates the run');
    assert.equal((await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: preparationRunId } })).status, 'BLOCKED');
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { status: originalStatus, updatedAt: originalOrderState.updatedAt } });
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { pontoVendaId: secondPoint.id, updatedAt: (await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).updatedAt } });
    const destinationTamper = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId });
    assert.equal(destinationTamper.status, 'BLOCKED');
    assert.equal(destinationTamper.code, 'KITCHEN_ORDER_PREPARATION_ORIGIN_EVIDENCE_UNCONFIRMED');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).pontoVendaId, secondPoint.id, 'preparation does not overwrite an adulterated cross-tenant target');
    await legacyDb.pedidoOperacao.update({ where: { id: movementlessOrder.id }, data: { pontoVendaId: point.id, updatedAt: (await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: movementlessOrder.id } })).updatedAt } });
    assert.equal((await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId })).status, 'COMPLETED', 'restoring the certified values permits revalidation without advancing the checkpoint');
    const preparationRaceCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-preparation-race-company-${runId}`, nome: 'Synthetic preparation lock tenant', slug: `preflight-preparation-race-${runId}` } });
    const preparationRacePoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-preparation-race-point-${runId}`, cervejariaId: preparationRaceCompany.id, nome: 'Synthetic preparation lock PDV' } });
    assert.equal((await runPdvBusinessMigration({ db: legacyDb, companyId: preparationRaceCompany.id, runId: `preflight-preparation-race-business-${runId}` })).status, 'COMPLETED');
    const preparationRaceOperator = await legacyDb.usuario.create({ data: { id: `preflight-preparation-race-user-${runId}`, nome: 'Synthetic preparation lock operator', email: `preflight-preparation-race-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: preparationRaceCompany.id } });
    const preparationRaceCommand = await legacyDb.comanda.create({ data: { id: `preflight-preparation-race-command-${runId}`, origem: 'CAIXA', pontoVendaId: preparationRacePoint.id, status: 'ABERTA', total: '0.00' } });
    const pendingRaceOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-order-race-pending-${runId}`, cervejariaId: preparationRaceCompany.id, comandaId: preparationRaceCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-01T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: preparationRaceOperator.id } });
    let releasePreparationRace; let signalPreparedWrite;
    const preparedWrite = new Promise((resolve) => { signalPreparedWrite = resolve; });
    const preparationGate = new Promise((resolve) => { releasePreparationRace = resolve; });
    let holdingBackendPid;
    const preparationFirst = runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: preparationRaceCompany.id, pointId: preparationRacePoint.id, runId: `preflight-order-concurrent-a-${runId}`, afterDestinationWrite: async (row, tx) => {
      if (row.id === pendingRaceOrder.id) {
        holdingBackendPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
        signalPreparedWrite();
        await preparationGate;
      }
    } });
    await preparedWrite;
    const preparationSecond = runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: preparationRaceCompany.id, pointId: preparationRacePoint.id, runId: `preflight-order-concurrent-b-${runId}` });
    let preparationLockObserved = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await legacyDb.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid <> ${holdingBackendPid}`;
      if (waiting.length) { preparationLockObserved = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    releasePreparationRace();
    assert.equal(preparationLockObserved, true, 'second preparation call is visibly waiting for PostgreSQL scope advisory lock');
    assert.deepEqual((await Promise.all([preparationFirst, preparationSecond])).map((result) => result.status), ['COMPLETED', 'COMPLETED']);
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: pendingRaceOrder.id } })).pontoVendaId, preparationRacePoint.id, 'concurrent preparation assigns the still-pending order once');
    assert.equal(await legacyDb.pdvMigrationMap.count({ where: { sourceType: PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE, sourceId: pendingRaceOrder.id } }), 1, 'concurrent callers do not duplicate stable map');
    for (const concurrentRunId of [`preflight-order-concurrent-a-${runId}`, `preflight-order-concurrent-b-${runId}`]) {
      const concurrentRun = await legacyDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: concurrentRunId } });
      assert.equal(await legacyDb.pdvMigrationBatch.count({ where: { runId: concurrentRunId } }), concurrentRun.checkpoint.totalRecords, 'each serialized run has a complete receipt sequence');
      assert.equal(concurrentRun.checkpoint.completedSourceKeys.filter((key) => key === `${PDV_KITCHEN_ORDER_PREPARATION_SOURCE_TYPE}:${pendingRaceOrder.id}`).length, 1, 'checkpoint includes the pending order once');
    }

    // A prior point map cannot resolve a later-created second PDV, even for a
    // CAIXA-only company and an order without any inventory movements.
    const ambiguousCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-ambiguous-company-${runId}`, nome: 'Synthetic ambiguous CAIXA tenant', slug: `preflight-ambiguous-${runId}` } });
    const firstAmbiguousPoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-ambiguous-point-a-${runId}`, cervejariaId: ambiguousCompany.id, nome: 'First candidate PDV' } });
    assert.equal((await runPdvBusinessMigration({ db: legacyDb, companyId: ambiguousCompany.id, runId: `preflight-ambiguous-business-${runId}` })).status, 'COMPLETED');
    const ambiguousOperator = await legacyDb.usuario.create({ data: { id: `preflight-ambiguous-user-${runId}`, nome: 'Synthetic ambiguous operator', email: `preflight-ambiguous-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: ambiguousCompany.id } });
    const firstCashCommand = await legacyDb.comanda.create({ data: { id: `preflight-ambiguous-command-a-${runId}`, origem: 'CAIXA', pontoVendaId: firstAmbiguousPoint.id, status: 'ABERTA', total: '0.00' } });
    const firstCashOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-ambiguous-order-a-${runId}`, cervejariaId: ambiguousCompany.id, comandaId: firstCashCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-05T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: ambiguousOperator.id } });
    const ambiguousPreparationRunId = `preflight-ambiguous-preparation-${runId}`;
    assert.equal((await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: ambiguousCompany.id, pointId: firstAmbiguousPoint.id, runId: ambiguousPreparationRunId })).status, 'COMPLETED', 'single mapped point is sufficient before ambiguity appears');
    const secondAmbiguousPoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-ambiguous-point-b-${runId}`, cervejariaId: ambiguousCompany.id, nome: 'Second candidate PDV' } });
    const secondCashCommand = await legacyDb.comanda.create({ data: { id: `preflight-ambiguous-command-b-${runId}`, origem: 'CAIXA', pontoVendaId: secondAmbiguousPoint.id, status: 'ABERTA', total: '0.00' } });
    const pendingAmbiguousOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-ambiguous-order-b-${runId}`, cervejariaId: ambiguousCompany.id, comandaId: secondCashCommand.id, pontoVendaId: null, numero: 2, diaOperacional: new Date('2026-12-05T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: ambiguousOperator.id } });
    const ambiguousReplay = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: ambiguousCompany.id, pointId: firstAmbiguousPoint.id, runId: ambiguousPreparationRunId });
    assert.deepEqual([ambiguousReplay.status, ambiguousReplay.code], ['BLOCKED', 'KITCHEN_ORDER_CANONICAL_PDV_AMBIGUOUS']);
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: pendingAmbiguousOrder.id } })).pontoVendaId, null, 'second PDV is not selected for a movementless CAIXA order');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: firstCashOrder.id } })).pontoVendaId, firstAmbiguousPoint.id, 'prior assignment is preserved while certification becomes blocked');

    // A second tenant proves a movement-free assignment from its own comanda/PDV authority.
    const secondBusiness = await runPdvBusinessMigration({ db: legacyDb, companyId: secondCompany.id, runId: `preflight-second-business-${runId}` });
    assert.equal(secondBusiness.status, 'COMPLETED', JSON.stringify(secondBusiness));
    const secondOperator = await legacyDb.usuario.create({ data: { id: `preflight-second-user-${runId}`, nome: 'Synthetic second operator', email: `preflight-second-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: secondCompany.id } });
    const secondCommand = await legacyDb.comanda.create({ data: { id: `preflight-second-command-${runId}`, origem: 'CAIXA', pontoVendaId: secondPoint.id, status: 'ABERTA', total: '2.00' } });
    const secondOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-second-order-${runId}`, cervejariaId: secondCompany.id, comandaId: secondCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-02T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: secondOperator.id } });
    assert.equal((await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: secondCompany.id, pointId: secondPoint.id, runId: `preflight-second-prep-${runId}` })).status, 'COMPLETED');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: secondOrder.id } })).pontoVendaId, secondPoint.id, 'tenant two is independently attributed');

    // Conflicts use real rows from QA and the same transform; no expected blocker is injected.
    const conflictCompany = await legacyDb.cervejaria.create({ data: { id: `preflight-conflict-company-${runId}`, nome: 'Synthetic conflict tenant', slug: `preflight-conflict-${runId}` } });
    const conflictPoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-conflict-point-${runId}`, cervejariaId: conflictCompany.id, nome: 'Synthetic conflict canonical PDV' } });
    const conflictBusiness = await runPdvBusinessMigration({ db: legacyDb, companyId: conflictCompany.id, runId: `preflight-conflict-business-${runId}` });
    assert.equal(conflictBusiness.status, 'COMPLETED', JSON.stringify(conflictBusiness));
    const alternatePoint = await legacyDb.pontoVenda.create({ data: { id: `preflight-conflict-alt-point-${runId}`, cervejariaId: conflictCompany.id, nome: 'Synthetic noncanonical PDV' } });
    const conflictOperator = await legacyDb.usuario.create({ data: { id: `preflight-conflict-user-${runId}`, nome: 'Synthetic conflict operator', email: `preflight-conflict-${runId}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: conflictCompany.id } });
    const conflictProduct = await legacyDb.produto.create({ data: { id: `preflight-conflict-product-${runId}`, cervejariaId: conflictCompany.id, nome: 'Synthetic conflict product' } });
    const conflictCommand = await legacyDb.comanda.create({ data: { id: `preflight-conflict-command-${runId}`, origem: 'CAIXA', pontoVendaId: conflictPoint.id, status: 'ABERTA', total: '3.00' } });
    const conflictingOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-conflict-order-${runId}`, cervejariaId: conflictCompany.id, comandaId: conflictCommand.id, pontoVendaId: null, numero: 1, diaOperacional: new Date('2026-12-03T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: conflictOperator.id } });
    const conflictMovements = await legacyDb.inventoryMovement.createMany({ data: [
      { id: `preflight-conflict-movement-a-${runId}`, cervejariaId: conflictCompany.id, pontoVendaId: conflictPoint.id, produtoId: conflictProduct.id, pedidoId: conflictingOrder.id, tipo: 'SAIDA_VENDA', quantidade: '0.125', registradoPorId: conflictOperator.id },
      { id: `preflight-conflict-movement-b-${runId}`, cervejariaId: conflictCompany.id, pontoVendaId: alternatePoint.id, produtoId: conflictProduct.id, pedidoId: conflictingOrder.id, tipo: 'SAIDA_VENDA', quantidade: '0.250', registradoPorId: conflictOperator.id },
    ] });
    assert.equal(conflictMovements.count, 2);
    const conflictSnapshot = await readPdvKitchenOrderPreparationSnapshot(legacyDb, conflictCompany.id);
    assert.throws(() => buildPdvKitchenOrderPreparationItems({ companyId: conflictCompany.id, pointId: conflictPoint.id, confirmedPdvSourceKey: `PDV:${conflictPoint.id}`, snapshot: { ...conflictSnapshot, orders: conflictSnapshot.orders.filter((row) => row.id === conflictingOrder.id), movements: conflictSnapshot.movements.filter((row) => row.pedidoId === conflictingOrder.id) }, confirmedOccurrences: {} }), (error) => error.code === 'KITCHEN_ORDER_MULTIPLE_MOVEMENT_PDVS');
    const unprovenCommand = await legacyDb.comanda.create({ data: { id: `preflight-unproven-command-${runId}`, origem: 'CAIXA', status: 'ABERTA', total: '0.00' } });
    const unprovenOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-unproven-order-${runId}`, cervejariaId: conflictCompany.id, comandaId: unprovenCommand.id, pontoVendaId: null, numero: 2, diaOperacional: new Date('2026-12-03T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: conflictOperator.id } });
    const foreignCommand = await legacyDb.comanda.create({ data: { id: `preflight-foreign-command-${runId}`, origem: 'CAIXA', pontoVendaId: point.id, status: 'ABERTA', total: '0.00' } });
    const foreignOrder = await legacyDb.pedidoOperacao.create({ data: { id: `preflight-foreign-order-${runId}`, cervejariaId: conflictCompany.id, comandaId: foreignCommand.id, pontoVendaId: null, numero: 3, diaOperacional: new Date('2026-12-03T00:00:00.000Z'), status: 'RECEBIDO', criadoPorId: conflictOperator.id } });
    const withOtherBlocks = await readPdvKitchenOrderPreparationSnapshot(legacyDb, conflictCompany.id);
    const runTransformForOrder = (orderId) => buildPdvKitchenOrderPreparationItems({ companyId: conflictCompany.id, pointId: conflictPoint.id, confirmedPdvSourceKey: `PDV:${conflictPoint.id}`, snapshot: { ...withOtherBlocks, orders: withOtherBlocks.orders.filter((row) => row.id === orderId), movements: withOtherBlocks.movements.filter((row) => row.pedidoId === orderId) }, confirmedOccurrences: {} });
    assert.throws(() => runTransformForOrder(unprovenOrder.id), (error) => error.code === 'KITCHEN_ORDER_COMMAND_PDV_UNPROVEN');
    assert.throws(() => runTransformForOrder(foreignOrder.id), (error) => error.code === 'KITCHEN_ORDER_COMMAND_PDV_UNPROVEN');
    const blockedConflict = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: conflictCompany.id, pointId: conflictPoint.id, runId: `preflight-conflict-prep-${runId}` });
    assert.equal(blockedConflict.status, 'BLOCKED');
    assert.equal(blockedConflict.code, 'KITCHEN_ORDER_CANONICAL_PDV_AMBIGUOUS');
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: conflictingOrder.id } })).pontoVendaId, null, 'conflicting links remain untouched');
    await legacyDb.inventoryMovement.deleteMany({ where: { pedidoId: conflictingOrder.id } });
    await legacyDb.pedidoOperacao.delete({ where: { id: conflictingOrder.id } });
    await legacyDb.pedidoOperacao.deleteMany({ where: { id: { in: [unprovenOrder.id, foreignOrder.id] } } });
    await legacyDb.comanda.deleteMany({ where: { id: { in: [unprovenCommand.id, foreignCommand.id] } } });
    console.log('QA_STAGE=order-context-preparation-two-tenants; movementless=assigned; multiple-pdv-movements=blocked; source-target-tamper=blocked; pause-rollback-replay-concurrency=verified');

    const rolledBack = runPrisma(['migrate', 'resolve', '--rolled-back', manifest.delivery.migrationName], preflightUrl);
    assert.equal(rolledBack.status, 0, 'QA Prisma failed migration row is explicitly marked rolled back after verifying transactional preflight made no DDL changes');
    const recovered = runPrisma(['migrate', 'deploy', '--schema', bundle.schemaPath], preflightUrl);
    assert.equal(recovered.status, 0, 'commerce migration deploy succeeds after safe context preparation and QA migration recovery');
    const constraint = await legacyDb.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname = 'MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey'`;
    assert.equal(constraint.length, 1);
    assert.equal(constraint[0].confdeltype, 'r');
    assert.equal(constraint[0].convalidated, true);
    assert.equal((await legacyDb.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id, 'restrictive migration preserves the prepared order context');
    console.log('QA_STAGE=legacy-order-context-prepared-recovered-and-commerce-migration-applied; orderId=preserved; movement=0.125; constraint=validated-restrictive');
    await legacyDb.$disconnect();
    const { PrismaClient: MigratedPrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
    const migratedDb = new MigratedPrismaClient({ datasources: { db: { url: preflightUrl } }, errorFormat: 'minimal', omit: { produto: { prepararEmPedidoSeparado: true } } });
    try {
      const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
      const { runPdvCatalogMigration, runPdvCommerceMigration, runPdvKitchenOrderContextPreparation } = await import('./pdv-unico-catalog-migrator.ts');
      for (const [label, result] of [
        ['business', await runPdvBusinessMigration({ db: migratedDb, companyId: company.id, runId: `preflight-business-${runId}` })],
        ['catalog', await runPdvCatalogMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: catalogRunId })],
        ['preparation', await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: company.id, pointId: point.id, runId: preparationRunId })],
      ]) assert.equal(result.status, 'COMPLETED', `post-commercial SQL prior-scope revalidation ${label}: ${JSON.stringify(result)}`);
      const commerceRunId = `preflight-commerce-${runId}`;
      const commerce = await runPdvCommerceMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: commerceRunId });
      assert.equal(commerce.status, 'COMPLETED', `post-preparation commerce mapping: ${JSON.stringify(commerce)}`);
      assert.equal((await runPdvBusinessMigration({ db: migratedDb, companyId: eventCompany.id, runId: eventBusinessRunId })).status, 'COMPLETED');
      assert.equal((await runPdvCatalogMigration({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventCatalogRunId })).status, 'COMPLETED');
      assert.equal((await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventPreparationRunId })).status, 'COMPLETED');
      const eventCommerceRunId = `preflight-event-commerce-${runId}`;
      const eventCommerce = await runPdvCommerceMigration({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventCommerceRunId });
      assert.equal(eventCommerce.status, 'COMPLETED', `prepared Event commerce mapping: ${JSON.stringify(eventCommerce)}`);
      const eventPreparationAfterCommerceWrite = await readPdvKitchenOrderPreparationSnapshot(migratedDb, eventCompany.id);
      const migratedEventCommand = eventPreparationAfterCommerceWrite.orders.find((row) => row.id === eventOrderWithMovement.id).comanda;
      assert.equal(migratedEventCommand.pontoVendaId, eventPoint.id, 'commercial scope writes the confirmed command PDV link');
      assert.notEqual(pdvKitchenPreparationPayloadHash(legacyEventPreparationPayload(eventPreparationAfterCommerceWrite, eventOrderWithMovement.id)), legacyPreparationHashBeforeCommercial, 'legacy V1 evidence demonstrably diverges when commerce fills the command PDV');
      console.log('QA_STAGE=event-preparation-v1-regression-demonstrated; legacy-hash=diverged; confirmed-command-pdv=written');
      const eventCheckpointBeforeRevalidation = plain((await migratedDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: eventPreparationRunId } })).checkpoint);
      const eventPreparationAfterCommerce = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventPreparationRunId });
      assert.equal(eventPreparationAfterCommerce.status, 'COMPLETED', `confirmed commercial Comanda link is normalized by preparation V4: ${JSON.stringify(eventPreparationAfterCommerce)}`);
      assert.deepEqual(plain(eventPreparationAfterCommerce.checkpoint), eventCheckpointBeforeRevalidation, 'post-commerce certification reuses the original V4 receipts without rewriting checkpoint');
      assert.equal((await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-preparation-new-run-${runId}` })).status, 'COMPLETED', 'new V4 run reuses the stable preparation maps after commerce');
      const eventOrdersAfterCommerce = await migratedDb.pedidoOperacao.findMany({ where: { id: { in: eventOrderIds } }, orderBy: { id: 'asc' }, select: { id: true, pontoVendaId: true, status: true, createdAt: true, updatedAt: true } });
      assert.deepEqual(eventOrdersAfterCommerce.map((row) => [row.id, row.pontoVendaId, row.status, row.createdAt.toISOString(), row.updatedAt.toISOString()]), [eventOrderWithMovement, eventOrderWithoutMovement, eventOrderAlreadyLinked, legacyLinkedEventOrder, legacyOrderAlreadyLinked].sort((a,b) => a.id.localeCompare(b.id)).map((row) => [row.id, eventPoint.id, row.status, row.createdAt.toISOString(), row.updatedAt.toISOString()]), 'all four initial command/order PDV combinations retain IDs, status and timestamps across both migrations');
      const eventOrdersAfterCommercialSnapshot = await readPdvKitchenOrderPreparationSnapshot(migratedDb, eventCompany.id);
      assert.deepEqual(new Map(eventOrdersAfterCommercialSnapshot.orders.filter((row) => eventOrderIds.includes(row.id)).map((row) => [row.id, [row.comanda.pontoVendaId, row.pontoVendaId]])), new Map(eventOrderIds.map((orderId) => [orderId, [eventPoint.id, eventPoint.id]])), 'commercial migration and preparation revalidation leave all four source link combinations canonically linked');
      const eventMovementAfterCommerce = await migratedDb.inventoryMovement.findUniqueOrThrow({ where: { id: eventStockMovement.id } });
      assert.deepEqual([eventMovementAfterCommerce.id, eventMovementAfterCommerce.pedidoId, eventMovementAfterCommerce.pontoVendaId, eventMovementAfterCommerce.quantidade.toString(), eventMovementAfterCommerce.createdAt.toISOString()], [eventStockMovement.id, eventOrderWithMovement.id, eventPoint.id, '0.375', eventStockMovement.createdAt.toISOString()]);
      const legacyEventMovementAfterCommerce = await migratedDb.inventoryMovement.findUniqueOrThrow({ where: { id: legacyLinkedEventMovement.id } });
      assert.deepEqual([legacyEventMovementAfterCommerce.id, legacyEventMovementAfterCommerce.pedidoId, legacyEventMovementAfterCommerce.pontoVendaId, legacyEventMovementAfterCommerce.quantidade.toString(), legacyEventMovementAfterCommerce.createdAt.toISOString()], [legacyLinkedEventMovement.id, legacyLinkedEventOrder.id, eventPoint.id, '0.25', legacyLinkedEventMovement.createdAt.toISOString()], 'legacy-link order stock movement remains exact');
      const legacyCommandMap = await migratedDb.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: legacyLinkedEventCommand.id } } });
      assert.equal(legacyCommandMap.sourcePayload.pontoVendaId, undefined, 'commercial projection omits its migrator-owned PDV link; preparation evidence remains the authoritative legacy origin record');
      await migratedDb.pdvMigrationMap.delete({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: legacyLinkedEventCommand.id } } });
      const missingLegacyMap = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-legacy-map-missing-${runId}` });
      assert.deepEqual([missingLegacyMap.status, missingLegacyMap.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_MAP_MISSING'], 'deleted post-migration map is detected from durable commerce run/receipt evidence, never reclassified as legacy');
      assert.deepEqual(plain((await migratedDb.pdvMigrationRun.findUniqueOrThrow({ where: { id: eventPreparationRunId } })).checkpoint), plain(eventCheckpointBeforeRevalidation), 'missing commercial map does not alter the confirmed preparation checkpoint');
      await migratedDb.comanda.update({ where: { id: legacyLinkedEventCommand.id }, data: { pontoVendaId: null }, select: { id: true, pontoVendaId: true } });
      const missingLegacyMapAndLink = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-legacy-map-and-link-missing-${runId}` });
      assert.deepEqual([missingLegacyMapAndLink.status, missingLegacyMapAndLink.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_MAP_MISSING'], 'clearing the migrated link together with its map is still detected from durable commerce evidence');
      assert.equal((await migratedDb.comanda.findUniqueOrThrow({ where: { id: legacyLinkedEventCommand.id }, select: { id: true, pontoVendaId: true } })).pontoVendaId, null, 'blocked revalidation does not repair a cleared destination link');
      await migratedDb.comanda.update({ where: { id: legacyLinkedEventCommand.id }, data: { pontoVendaId: eventPoint.id }, select: { id: true, pontoVendaId: true } });
      await migratedDb.pdvMigrationMap.create({ data: { ...legacyCommandMap } });
      const eventCommandMap = await migratedDb.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: eventCommand.id } } });
      const commandPointBeforeTamper = (await migratedDb.comanda.findUniqueOrThrow({ where: { id: eventCommand.id }, select: { id: true, pontoVendaId: true } })).pontoVendaId;
      await migratedDb.comanda.update({ where: { id: eventCommand.id }, data: { pontoVendaId: null }, select: { id: true, pontoVendaId: true } });
      const destinationTamper = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-destination-tamper-${runId}` });
      assert.deepEqual([destinationTamper.status, destinationTamper.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_DESTINATION_DIVERGED']);
      assert.equal((await migratedDb.comanda.findUniqueOrThrow({ where: { id: eventCommand.id }, select: { id: true, pontoVendaId: true } })).pontoVendaId, null, 'preparation does not repair divergent commercial link');
      await migratedDb.comanda.update({ where: { id: eventCommand.id }, data: { pontoVendaId: commandPointBeforeTamper }, select: { id: true, pontoVendaId: true } });
      await migratedDb.pdvMigrationMap.delete({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: eventCommand.id } } });
      const missingMap = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-map-missing-${runId}` });
      assert.deepEqual([missingMap.status, missingMap.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_MAP_MISSING']);
      await migratedDb.pdvMigrationMap.create({ data: { ...eventCommandMap } });
      await migratedDb.pdvMigrationMap.update({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: eventCommand.id } }, data: { payloadHash: 'tampered-payload-hash' } });
      const divergentMap = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-map-diverged-${runId}` });
      assert.deepEqual([divergentMap.status, divergentMap.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_MAP_DIVERGED']);
      const secondLegacyCandidate = await migratedDb.pontoVenda.create({ data: { id: `preflight-event-second-point-${runId}`, cervejariaId: eventCompany.id, nome: 'Ambiguous second point' } });
      const legacyAmbiguity = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-legacy-ambiguous-${runId}` });
      assert.deepEqual([legacyAmbiguity.status, legacyAmbiguity.code], ['BLOCKED', 'KITCHEN_ORDER_CANONICAL_PDV_AMBIGUOUS'], 'a formerly confirmed legacy link is blocked after a second PDV makes canonical authority ambiguous');
      assert.equal((await migratedDb.comanda.findUniqueOrThrow({ where: { id: legacyLinkedEventCommand.id }, select: { id: true, pontoVendaId: true } })).pontoVendaId, eventPoint.id, 'ambiguity does not rewrite the existing source link');
      const postMigrationRows = await migratedDb.pedidoOperacao.findMany({ where: { id: { in: [order.id, movementlessOrder.id] } }, orderBy: { id: 'asc' } });
      assert.deepEqual(postMigrationRows.map((row) => [row.id, row.pontoVendaId]), [[order.id, point.id], [movementlessOrder.id, point.id]]);
      assert.equal((await migratedDb.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.125');
      assert.equal((await runPdvCommerceMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'commerce same-run revalidation');
      assert.equal((await runPdvCommerceMigration({ db: migratedDb, companyId: company.id, pointId: point.id, runId: `preflight-commerce-replay-${runId}` })).status, 'COMPLETED', 'commerce new-run replay preserves prepared links');
      console.log('QA_STAGE=post-preparation-commercial-scope-completed-and-replayed; scopes=business,catalog,preparation,commerce; orders=5; movements=2; pdv-combinations=4; same/new-run-recovery=verified');
    } finally { await migratedDb.$disconnect(); }
  } finally {
    await legacyDb.$disconnect();
    const dropped = spawnSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', databaseName], { encoding: 'utf8', windowsHide: true });
    assert.equal(dropped.status, 0, 'only the temporary QA preflight database is removed');
  }
}
let db;
let consumerPrisma;
let preflightDb;
let preflightDatabaseName;
try {
  const history = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.historical.path), 'utf8'));
  await verifyPinnedManifest(history);
  const core = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.core.path), 'utf8'));
  const catalog = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.catalog.path), 'utf8'));
  const finance = JSON.parse(await readFile(path.join(repoRoot, manifest.priorManifests.finance.path), 'utf8'));
  const sessionSql = readPinnedBlob(manifest.priorManifests.session.commit, manifest.priorManifests.session.path);
  const candidates = [
    [core.migrationName, await readFile(path.join(repoRoot, core.migrationPath))],
    [catalog.delivery.migrationName, await readFile(path.join(repoRoot, catalog.delivery.migrationPath))],
    [manifest.priorManifests.session.name, sessionSql],
    [finance.delivery.migrationName, await readFile(path.join(repoRoot, finance.delivery.migrationPath))],
    [manifest.priorManifests.finance.historicalProvenanceMigration.name, historicalProvenanceSql],
    [manifest.delivery.migrationName, commerceSql],
    [saleSessionContextMigration.name, saleSessionContextSql],
    [tapMountMigration.name, tapMountSql],
    [independentKitchenMigration.name, independentKitchenSql],
  ];
  assert.equal(sha256(candidates[0][1]), core.migrationSha256, 'pinned core SQL');
  assert.equal(sha256(candidates[1][1]), catalog.delivery.migrationSha256, 'pinned catalog SQL');
  assert.equal(sha256(candidates[2][1]), manifest.priorManifests.session.sha256, 'pinned session SQL');
  assert.equal(sha256(candidates[3][1]), finance.delivery.migrationSha256, 'pinned finance SQL');
  assert.equal(sha256(candidates[4][1]), manifest.priorManifests.finance.historicalProvenanceMigration.sha256, 'pinned historical payment provenance SQL');
  assert.equal(sha256(candidates.at(-1)[1]), independentKitchenMigration.sha256, 'pinned independent kitchen migration SQL');
  const bundle = await materializePinnedMigrationBundle(history, tempRoot);
  for (const [name, sql] of candidates) {
    const dir = path.join(bundle.migrationsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'migration.sql'), sql);
  }
  const candidateText = candidateSchema.toString('utf8');
  await writeFile(bundle.schemaPath, candidateSchema);
  const validatePath = path.join(tempRoot, 'commerce-schema.prisma');
  await writeFile(validatePath, candidateSchema);
  const generatePath = path.join(tempRoot, 'generate-commerce-schema.prisma');
  const normalizedClientDir = generatedClientDir.replaceAll('\\', '/');
  await writeFile(generatePath, candidateText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${normalizedClientDir}"`));
  runPrisma(['validate', '--schema', validatePath]);
  runPrisma(['generate', '--schema', generatePath]);
  await proveLegacyOrderContextPreflight({ history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, generatedClientDir, databaseUrl, runId });
  const deploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', bundle.schemaPath], { cwd: backendRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl }, encoding: 'utf8', windowsHide: true });
  if (deploy.status !== 0) throw new Error(`QA-only migration deploy failed: ${(deploy.stderr || deploy.stdout).replaceAll(databaseUrl, '[QA URL REDACTED]').slice(0, 1800)}`);
  const regressionEnv = { ...process.env };
  for (const name of Object.keys(regressionEnv)) if (name === 'DATABASE_URL' || name === 'DIRECT_URL' || /_DATABASE_URL$/.test(name) || /^PROD/i.test(name)) delete regressionEnv[name];
  Object.assign(regressionEnv, { NODE_ENV: 'test', PDV_ISOLATED_QA: '1', QA_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl });
  const deletionRegression = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', 'scripts/event-deletion.isolated.test.ts'], { cwd: backendRoot, env: regressionEnv, encoding: 'utf8', windowsHide: true });
  const deletionOutput = `${deletionRegression.stdout ?? ''}\n${deletionRegression.stderr ?? ''}`;
  process.stdout.write(deletionOutput);
  if (deletionRegression.status !== 0) throw new Error(`Commercial-chain event deletion regression failed with exit code ${deletionRegression.status ?? 'unknown'}.`);
  const deletionTests = Number(deletionOutput.match(/^# tests (\d+)$/m)?.[1] ?? 0);
  const deletionPassed = Number(deletionOutput.match(/^# pass (\d+)$/m)?.[1] ?? -1);
  const deletionSkipped = Number(deletionOutput.match(/^# skipped (\d+)$/m)?.[1] ?? -1);
  if (deletionTests < 8 || deletionPassed !== deletionTests || deletionSkipped !== 0) throw new Error(`Commercial-chain event deletion gate requires at least 8 executed tests and zero skips (tests=${deletionTests}, pass=${deletionPassed}, skipped=${deletionSkipped}).`);
  const { PrismaClient } = await import(pathToFileURL(path.join(generatedClientDir, 'index.js')).href);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal', omit: { produto: { prepararEmPedidoSeparado: true } } });
  const applied = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  assert.equal(applied.length, history.migrations.length + 9, 'full historical + operational core/catalog/session/finance/provenance/commerce/sale-session/Tap-mount/independent-kitchen chain');
  assert(applied.some((row) => row.migration_name === manifest.priorManifests.finance.historicalProvenanceMigration.name), 'Payment.provenienciaHistorica migration is applied before commerce route regressions');
  const constraints = await db.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname IN ('Comanda_pontoVendaId_ocorrenciaId_fkey','Comanda_pontoVendaId_sessaoCaixaRealizacaoId_fkey','EstoqueSaldoQuiosque_pontoVendaId_cervejariaId_fkey','EstoqueSaldoQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pontoVendaId_cervejariaId_fkey','MovimentoEstoqueQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey') ORDER BY conname`;
  assert.equal(constraints.length, 7);
  assert(constraints.every((row) => row.confdeltype === 'r' && row.convalidated), 'tenant/context/history constraints are validated and restrictive');

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration, runPdvSessionMigration, runPdvFinanceMigration, runPdvCommerceMigration } = await import('./pdv-unico-catalog-migrator.ts');
  const { runPdvTapOwnershipMigration, PdvTapBlocker } = await import('./pdv-unico-tap-migrator.ts');
  const { readPdvCommerceSourceSnapshot } = await import('./pdv-unico-commerce-source.ts');
  const company = await db.cervejaria.create({ data: { nome: `QA commerce ${runId}`, slug: slug('commerce') } });
  await db.configuracaoOperacao.create({ data: { cervejariaId: company.id, ativo: true, controlaEstoque: true, temCozinha: true, exclusivo: false, quantidadeMesas: 4, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  await db.configuracaoOperacional.create({ data: { cervejariaId: company.id, plannedOperationsEnabled: false, tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: true, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  console.log('QA_STAGE=synthetic-unit-and-event-fixtures-created');
  const trailer = await db.trailer.create({ data: { id: id('trailer'), cervejariaId: company.id, nome: 'synthetic trailer', identificador: 'QA-COMMERCE' } });
  const existingPoint = await db.pontoVenda.create({ data: { id: id('existing-point'), cervejariaId: company.id, nome: 'canonical synthetic PDV' } });
  const events = [];
  for (const [name, date, status] of [['first-occurrence', '2026-11-05T00:00:00.000Z', 'FECHADO'], ['second-occurrence', '2026-11-12T00:00:00.000Z', 'ABERTO']]) events.push(await db.evento.create({ data: { id: id(name), cervejariaId: company.id, trailerId: trailer.id, nome: name, local: 'QA', data: new Date(date), horaInicio: '18:00', horaFim: '22:00', status, recorrencia: 'NENHUMA' } }));
  const weeklyAgenda = await db.evento.create({ data: { id: id('weekly-agenda'), cervejariaId: company.id, trailerId: trailer.id, nome: 'Synthetic weekly agenda', local: 'QA recurring location', data: null, recorrencia: 'SEMANAL', diaSemana: 4, horaInicio: '18:30', horaFim: '22:30', status: 'ABERTO' } });
  const recurringOccurrences = [];
  for (const [name, date] of [['weekly-occurrence-one', '2026-11-19T00:00:00.000Z'], ['weekly-occurrence-two', '2026-11-26T00:00:00.000Z']]) recurringOccurrences.push(await db.evento.create({ data: { id: id(name), cervejariaId: company.id, trailerId: trailer.id, serieId: weeklyAgenda.id, nome: name, local: 'QA recurring location', data: new Date(date), recorrencia: 'NENHUMA', status: 'FECHADO' } }));
  events.push(weeklyAgenda, ...recurringOccurrences);
  const product = await db.produto.create({ data: { id: id('product'), cervejariaId: company.id, nome: 'Synthetic unit product', tipo: 'COMIDA', controlaEstoque: true } });
  const draftProduct = await db.produto.create({ data: { id: id('draft-product'), cervejariaId: company.id, nome: 'Synthetic draft', tipo: 'BEBIDA', formato: 'CHOPE', categoria: 'Chope', controlaEstoque: true } });
  await db.preco.createMany({ data: [
    { id: id('price-unit'), produtoId: product.id, volumeMl: 1, preco: '6.25' },
    { id: id('price-draft-500'), produtoId: draftProduct.id, volumeMl: 500, preco: '8.50' },
    { id: id('price-draft-1000'), produtoId: draftProduct.id, volumeMl: 1000, preco: '13.00' },
  ] });
  const menuA = await db.cardapio.create({ data: { id: id('menu-a'), cervejariaId: company.id, nome: 'Synthetic menu A', ativo: true, chopeVolumesConfigurados: true } });
  const menuB = await db.cardapio.create({ data: { id: id('menu-b'), cervejariaId: company.id, nome: 'Synthetic menu B', ativo: true, chopeVolumesConfigurados: true } });
  await db.cardapioProduto.createMany({ data: [
    { id: id('menu-a-unit'), cardapioId: menuA.id, produtoId: product.id, volumeMl: 0, precoUnit: '4.00' },
    { id: id('menu-a-500'), cardapioId: menuA.id, produtoId: draftProduct.id, volumeMl: 500, precoUnit: '6.00' },
    { id: id('menu-a-1000'), cardapioId: menuA.id, produtoId: draftProduct.id, volumeMl: 1000, precoUnit: '10.00' },
    { id: id('menu-b-unit'), cardapioId: menuB.id, produtoId: product.id, volumeMl: 0, precoUnit: '5.00' },
    { id: id('menu-b-500'), cardapioId: menuB.id, produtoId: draftProduct.id, volumeMl: 500, precoUnit: '7.00' },
    { id: id('menu-b-1000'), cardapioId: menuB.id, produtoId: draftProduct.id, volumeMl: 1000, precoUnit: '12.00' },
  ] });
  await db.evento.update({ where: { id: events[0].id }, data: { cardapioId: menuB.id } });
  await db.eventoProduto.createMany({ data: events.slice(0, 2).flatMap((event) => [
    { id: id(`${event.id}-draft-selection`), eventoId: event.id, produtoId: draftProduct.id },
    { id: id(`${event.id}-unit-selection`), eventoId: event.id, produtoId: product.id },
  ]) });
  const { readPdvCatalogSourceSnapshot } = await import('./pdv-unico-catalog-source.ts');
  const { buildPdvCatalogMigrationItems, canonicalPdvPayloadHash, PDV_CATALOG_SCOPE, PDV_CATALOG_TRANSFORM_VERSION } = await import('./pdv-unico-catalog-transform.ts');
  const readCatalogPlan = async () => db.$transaction(async (tx) => {
    const [planning, catalogSource] = await Promise.all([
      readPdvPlanningSourceSnapshot(tx, company.id), readPdvCatalogSourceSnapshot(tx, company.id),
    ]);
    const snapshot = { ...planning, ...catalogSource };
    const maps = await tx.pdvMigrationMap.findMany({ where: { destinationType: 'PONTO_VENDA', destinationId: point.id, cervejariaId: company.id }, orderBy: [{ createdAt: 'asc' }, { sourceType: 'asc' }, { sourceId: 'asc' }] });
    const dependency = maps.find((map) => ['PDV', 'TRAILER'].includes(map.sourceType));
    assert(dependency, 'catalog plan diagnostic has a business-certified PDV map');
    const sourceKey = `${dependency.sourceType}:${dependency.sourceId}`;
    const items = buildPdvCatalogMigrationItems({ companyId: company.id, pointId: point.id, snapshot, confirmedPdvSourceKey: sourceKey });
    const sourceSnapshotHash = canonicalPdvPayloadHash({ scope: PDV_CATALOG_SCOPE, companyId: company.id, pointId: point.id, transformVersion: PDV_CATALOG_TRANSFORM_VERSION, items: items.map((item) => ({ sourceType: item.type, sourceId: item.id, sourcePayload: item.sourcePayload })) });
    return { sourceKey, sourceSnapshotHash, items: plain(items) };
  }, { isolationLevel: 'RepeatableRead' });
  const { readPdvPlanningSourceSnapshot } = await import('./pdv-unico-source-graph.ts');
  await db.$transaction((tx) => readPdvPlanningSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' });
  console.log('QA_STAGE=shared-source-graph-read');
  const businessRunId = id('business');
  const business = await runPdvBusinessMigration({ db, companyId: company.id, runId: businessRunId });
  assert.equal(business.status, 'COMPLETED', JSON.stringify(business));
  console.log('QA_STAGE=business-maps-confirmed');
  const point = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: company.id } });
  assert.equal(point.id, existingPoint.id, 'existing canonical PDV is preserved');
  const recurringTargets = await db.ocorrenciaOperacional.findMany({ where: { agendaId: weeklyAgenda.id }, orderBy: { data: 'asc' } });
  assert.deepEqual(recurringTargets.map((row) => [row.id, row.data.toISOString().slice(0, 10)]), recurringOccurrences.map((row) => [row.id, row.data.toISOString().slice(0, 10)]), 'recurring occurrences retain distinct dates and the agenda link');
  const catalogRunId = id('catalog');
  const catalogSourceAtStart = plain(await db.$transaction((tx) => readPdvCatalogSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' }));
  const catalogPlanAtStart = await readCatalogPlan();
  const catalogRun = await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: catalogRunId });
  assert.equal(catalogRun.status, 'COMPLETED', JSON.stringify(catalogRun));
  assert.equal(catalogPlanAtStart.sourceSnapshotHash, catalogRun.checkpoint.sourceSnapshotHash, 'directly rebuilt catalog contract equals the real runner checkpoint at start');
  const migratedMenuRows = await db.cardapioProduto.findMany({ where: { cardapioId: { in: [menuA.id, menuB.id] } }, orderBy: [{ cardapioId: 'asc' }, { produtoId: 'asc' }, { volumeMl: 'asc' }] });
  assert.equal(migratedMenuRows.length, 6, 'both distinct menus and every unit/volume line survive catalog migration');
  const expectedMigratedMenuRows = [
    [id('menu-a-unit'), menuA.id, product.id, 0, '400'], [id('menu-a-500'), menuA.id, draftProduct.id, 500, '600'], [id('menu-a-1000'), menuA.id, draftProduct.id, 1000, '1000'],
    [id('menu-b-unit'), menuB.id, product.id, 0, '500'], [id('menu-b-500'), menuB.id, draftProduct.id, 500, '700'], [id('menu-b-1000'), menuB.id, draftProduct.id, 1000, '1200'],
  ].sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3] - b[3]);
  assert.deepEqual(migratedMenuRows.map((row) => [row.id, row.cardapioId, row.produtoId, row.volumeMl, centsExact(row.precoUnit)]), expectedMigratedMenuRows, 'catalog migration preserves stable IDs, menu links, volume identity, and exact cents');
  const migratedDraftPrices = await db.preco.findMany({ where: { produtoId: draftProduct.id }, orderBy: { volumeMl: 'asc' } });
  assert.deepEqual(migratedDraftPrices.map((row) => [row.id, row.volumeMl, centsExact(row.preco)]), [[id('price-draft-500'), 500, '850'], [id('price-draft-1000'), 1000, '1300']]);
  const businessAfterCatalog = await runPdvBusinessMigration({ db, companyId: company.id, runId: businessRunId });
  assert.equal(businessAfterCatalog.status, 'COMPLETED', `business occurrence certification remains valid after catalog migration: ${JSON.stringify(businessAfterCatalog)}`);
  console.log('QA_STAGE=catalog-and-session-dependencies-confirmed');
  const owner = await db.usuario.create({ data: { nome: 'Synthetic operator', email: `${slug('owner')}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: company.id } });
  const client = await db.cliente.create({ data: { id: id('client'), cervejariaId: company.id, nome: 'Synthetic client' } });
  const eventSession = await db.sessaoCaixaEvento.create({ data: { id: id('event-session-integrated'), eventoId: events[0].id, status: 'FECHADO', trocoInicial: '12.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-05T17:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-05T23:00:00.000Z'), contadoDinheiro: '20.00', contadoPix: '8.25', contadoDebito: '0.00', contadoCredito: '0.00' } });
  const debtEventSession = await db.sessaoCaixaEvento.create({ data: { id: id('event-session-debt-occurrence'), eventoId: events[1].id, status: 'FECHADO', trocoInicial: '3.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-12T17:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-12T23:00:00.000Z'), contadoDinheiro: '2.00', contadoPix: '0.00', contadoDebito: '0.00', contadoCredito: '0.00' } });
  const cashSession = await db.sessaoCaixaOperacao.create({ data: { id: id('cash-session-integrated'), cervejariaId: company.id, pontoVendaId: point.id, trailerId: trailer.id, diaOperacional: new Date('2026-11-13T00:00:00.000Z'), status: 'FECHADO', trocoInicial: '5.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-13T10:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-13T22:00:00.000Z'), contadoDinheiro: '5.00', contadoPix: '0.00', contadoCartaoDebito: '0.00', contadoCartaoCredito: '4.00', cardapioId: menuA.id } });
  const overrideSession = await db.sessaoCaixaOperacao.create({ data: { id: id('cash-session-overrides'), cervejariaId: company.id, pontoVendaId: point.id, trailerId: trailer.id, diaOperacional: new Date('2026-11-14T00:00:00.000Z'), status: 'FECHADO', trocoInicial: '0.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-14T10:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-14T22:00:00.000Z'), contadoDinheiro: '0.00', contadoPix: '0.00', contadoCartaoDebito: '0.00', contadoCartaoCredito: '0.00', cardapioId: menuB.id } });
  const catalogFallbackSession = await db.sessaoCaixaOperacao.create({ data: { id: id('cash-session-catalog-fallback'), cervejariaId: company.id, pontoVendaId: point.id, trailerId: trailer.id, diaOperacional: new Date('2026-11-15T00:00:00.000Z'), status: 'FECHADO', trocoInicial: '0.00', abertoPorId: owner.id, abertoEm: new Date('2026-11-15T10:00:00.000Z'), fechadoPorId: owner.id, fechadoEm: new Date('2026-11-15T22:00:00.000Z'), contadoDinheiro: '0.00', contadoPix: '0.00', contadoCartaoDebito: '0.00', contadoCartaoCredito: '0.00' } });
  await db.sessaoCaixaProdutoOperacao.createMany({ data: [
    { id: id('cash-product-500-no-override'), sessaoCaixaId: cashSession.id, produtoId: draftProduct.id, volumeMl: 500 },
    { id: id('cash-product-1000-null-override'), sessaoCaixaId: cashSession.id, produtoId: draftProduct.id, volumeMl: 1000, precoUnit: null },
    { id: id('cash-product-unit-zero'), sessaoCaixaId: cashSession.id, produtoId: product.id, volumeMl: 0, precoUnit: '0.00' },
    { id: id('override-product-500-positive'), sessaoCaixaId: overrideSession.id, produtoId: draftProduct.id, volumeMl: 500, precoUnit: '8.75' },
    { id: id('override-product-1000-null'), sessaoCaixaId: overrideSession.id, produtoId: draftProduct.id, volumeMl: 1000, precoUnit: null },
    { id: id('override-product-unit-positive'), sessaoCaixaId: overrideSession.id, produtoId: product.id, volumeMl: 0, precoUnit: '5.50' },
    { id: id('fallback-product-500'), sessaoCaixaId: catalogFallbackSession.id, produtoId: draftProduct.id, volumeMl: 500 },
    { id: id('fallback-product-unit'), sessaoCaixaId: catalogFallbackSession.id, produtoId: product.id, volumeMl: 0 },
  ] });
  const sessionRunId = id('sessions');
  const sessionResult = await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: sessionRunId });
  assert.equal(sessionResult.status, 'COMPLETED', JSON.stringify(sessionResult));
  const [eventSessionTarget, debtEventSessionTarget, cashSessionTarget, overrideSessionTarget, fallbackSessionTarget] = await Promise.all([
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: eventSession.id } }),
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: debtEventSession.id } }),
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: cashSession.id } }),
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: overrideSession.id } }),
    db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: catalogFallbackSession.id } }),
  ]);
  assert.deepEqual([
    [eventSessionTarget.id, eventSessionTarget.cardapioId, eventSessionTarget.ocorrenciaId, eventSessionTarget.origemHistorica],
    [debtEventSessionTarget.id, debtEventSessionTarget.cardapioId, debtEventSessionTarget.ocorrenciaId, debtEventSessionTarget.origemHistorica],
    [cashSessionTarget.id, cashSessionTarget.cardapioId], [overrideSessionTarget.id, overrideSessionTarget.cardapioId], [fallbackSessionTarget.id, fallbackSessionTarget.cardapioId],
  ], [
    [eventSession.id, menuB.id, events[0].id, 'EVENTO'], [debtEventSession.id, null, events[1].id, 'EVENTO'],
    [cashSession.id, menuA.id], [overrideSession.id, menuB.id], [catalogFallbackSession.id, null],
  ], 'session transfer retains selected menus and occurrence, while sources without a selection remain unselected');
  assert.deepEqual((await db.sessaoCaixaProdutoOperacao.findMany({ where: { sessaoCaixaId: cashSession.id }, orderBy: [{ produtoId: 'asc' }, { volumeMl: 'asc' }] })).map((row) => [row.id, row.produtoId, row.volumeMl, row.precoUnit === null ? null : centsExact(row.precoUnit)]), [
    [id('cash-product-unit-zero'), product.id, 0, '0'],
    [id('cash-product-500-no-override'), draftProduct.id, 500, null],
    [id('cash-product-1000-null-override'), draftProduct.id, 1000, null],
  ].sort((a, b) => a[1].localeCompare(b[1]) || a[2] - b[2]), 'session transfer preserves exact row IDs and zero/null override states');
  const tap = await db.tap.create({ data: { id: id('price-consumer-tap'), numero: 91, nome: 'QA price consumer', cervejariaId: company.id, trailerId: trailer.id, pontoVendaId: point.id } });
  await db.tapMontagem.createMany({ data: [eventSession.id, debtEventSession.id, cashSession.id, overrideSession.id, catalogFallbackSession.id].map((sessaoCaixaId, index) => ({ id: id(`price-mount-${index}`), tapId: tap.id, produtoId: draftProduct.id, sessaoCaixaId })) });
  const tapAndMountBefore = plain({ tap: await db.tap.findUniqueOrThrow({ where: { id: tap.id } }), mounts: await db.tapMontagem.findMany({ where: { tapId: tap.id }, orderBy: { iniciadoEm: 'asc' } }) });
  const tapRunId = id('tap-owner-migration');
  const tapMigrationResults = await Promise.all([1, 2].map(() => runPdvTapOwnershipMigration({ db, companyId: company.id, pointId: point.id, runId: tapRunId })));
  assert.deepEqual(tapMigrationResults.map((row) => row.status).sort(), ['COMPLETED', 'COMPLETED']);
  assert.equal(tapMigrationResults.filter((row) => row.reusedCompletedRun).length, 1, 'same-run concurrent TAP migration serializes and reuses the confirmed receipt');
  assert.deepEqual(plain({ tap: await db.tap.findUniqueOrThrow({ where: { id: tap.id } }), mounts: await db.tapMontagem.findMany({ where: { tapId: tap.id }, orderBy: { iniciadoEm: 'asc' } }) }), tapAndMountBefore, 'canonical ownership update preserves the Tap and every mount ID/product/session/date/state');
  assert.deepEqual(tapMigrationResults[0].reconciledRecords.map((row) => [row.type, row.sourceId, row.destinationId]).sort(), [
    ['LEGACY_TAP', tap.id, tap.id],
    ...[eventSession.id, debtEventSession.id, cashSession.id, overrideSession.id, catalogFallbackSession.id].map((sessionId) => ['TAP_MONTAGEM', tapAndMountBefore.mounts.find((mount) => mount.sessaoCaixaId === sessionId).id, tapAndMountBefore.mounts.find((mount) => mount.sessaoCaixaId === sessionId).id]),
  ].sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`)), 'migration receipts reconcile every historical Tap/mount by source and destination ID');
  assert.equal(await db.pdvMigrationMap.count({ where: { lastRunId: tapRunId } }), 6, 'one Tap plus all five mount records have per-row map receipts');
  assert.equal(await db.pdvMigrationBatch.count({ where: { runId: tapRunId, status: 'CONFIRMED' } }), 1, 'destination changes, row maps, receipts and checkpoint commit in one batch');
  const completedTapRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: tapRunId } });
  const completedTapMap = await db.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'LEGACY_TAP', sourceId: tap.id } } });
  const tamperedCheckpoint = { ...completedTapRun.checkpoint, completedSourceKeys: [] };
  await db.pdvMigrationRun.update({ where: { id: tapRunId }, data: { checkpoint: tamperedCheckpoint } });
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: company.id, pointId: point.id, runId: tapRunId }), (error) => error instanceof PdvTapBlocker && error.code === 'RUN_CHECKPOINT_DIVERGED', 'empty completedSourceKeys blocks replay');
  assert.deepEqual(await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: tapRunId } }).then((row) => row.checkpoint), tamperedCheckpoint, 'checkpoint divergence is not repaired or rewritten');
  await db.pdvMigrationRun.update({ where: { id: tapRunId }, data: { checkpoint: completedTapRun.checkpoint } });
  await db.pdvMigrationMap.update({ where: { id: completedTapMap.id }, data: { destinationId: id('tampered-destination') } });
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: company.id, pointId: point.id, runId: tapRunId }), (error) => error instanceof PdvTapBlocker && error.code === 'MAP_IDENTITY_MISMATCH', 'destinationId tampering blocks replay');
  assert.equal((await db.pdvMigrationMap.findUniqueOrThrow({ where: { id: completedTapMap.id } })).destinationId, id('tampered-destination'), 'destinationId divergence is left untouched');
  await db.pdvMigrationMap.update({ where: { id: completedTapMap.id }, data: { destinationId: completedTapMap.destinationId } });
  await db.pdvMigrationMap.update({ where: { id: completedTapMap.id }, data: { sourcePayload: { ...completedTapMap.sourcePayload, nome: 'tampered source payload' } } });
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: company.id, pointId: point.id, runId: tapRunId }), (error) => error instanceof PdvTapBlocker && error.code === 'SOURCE_PAYLOAD_CHANGED', 'sourcePayload tampering blocks replay');
  assert.equal((await db.pdvMigrationMap.findUniqueOrThrow({ where: { id: completedTapMap.id } })).sourcePayload.nome, 'tampered source payload', 'sourcePayload divergence is left untouched');
  await db.pdvMigrationMap.update({ where: { id: completedTapMap.id }, data: { sourcePayload: completedTapMap.sourcePayload } });
  await db.tap.update({ where: { id: tap.id }, data: { nome: 'tampered Tap name' } });
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: company.id, pointId: point.id, runId: tapRunId }), (error) => error instanceof PdvTapBlocker && error.code === 'TAP_RUN_SCOPE_OR_SNAPSHOT_DIVERGED', 'source tampering blocks a completed run without overwrite');
  await db.tap.update({ where: { id: tap.id }, data: { nome: tapAndMountBefore.tap.nome } });
  const tapReplay = await runPdvTapOwnershipMigration({ db, companyId: company.id, pointId: point.id, runId: tapRunId });
  assert.equal(tapReplay.reusedCompletedRun, true, 'an unchanged completed Tap/mount snapshot replays from its exact receipt');
  const rollbackTenant = await db.cervejaria.create({ data: { nome: `QA tap rollback ${runId}`, slug: slug('tap-rollback') } });
  const rollbackPoint = await db.pontoVenda.create({ data: { id: id('tap-rollback-point'), cervejariaId: rollbackTenant.id, nome: 'Rollback PDV' } });
  const rollbackTrailer = await db.trailer.create({ data: { id: id('tap-rollback-trailer'), cervejariaId: rollbackTenant.id, nome: 'Rollback Trailer' } });
  const ambiguousTrailer = await db.trailer.create({ data: { id: id('tap-ambiguous-trailer'), cervejariaId: rollbackTenant.id, nome: 'Second legacy Trailer' } });
  const rollbackTap = await db.tap.create({ data: { id: id('tap-rollback'), numero: 92, nome: 'Rollback Tap', cervejariaId: rollbackTenant.id, trailerId: rollbackTrailer.id } });
  const collisionTap = await db.tap.create({ data: { id: id('tap-collision'), numero: 92, nome: 'Colliding Tap', cervejariaId: rollbackTenant.id, trailerId: ambiguousTrailer.id } });
  const collisionRunId = id('tap-collision-run');
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: rollbackTenant.id, pointId: rollbackPoint.id, runId: collisionRunId }), (error) => error instanceof PdvTapBlocker && error.code === 'MULTIPLE_TRAILERS_REQUIRE_MANUAL_MAPPING', 'same-number Taps across multiple legacy Trailers block without choosing a source Trailer');
  assert.deepEqual((await db.tap.findMany({ where: { cervejariaId: rollbackTenant.id }, orderBy: { id: 'asc' }, select: { id: true, pontoVendaId: true } })).map((row) => row.pontoVendaId), [null, null], 'ambiguous legacy ownership makes no write');
  assert.equal(await db.pdvMigrationRun.count({ where: { id: collisionRunId } }), 0, 'ambiguous legacy ownership leaves no run, checkpoint, receipt or map');
  await db.tap.delete({ where: { id: collisionTap.id } });
  await db.trailer.delete({ where: { id: ambiguousTrailer.id } });
  const rollbackTapRunId = id('tap-rollback-run');
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: rollbackTenant.id, pointId: rollbackPoint.id, runId: rollbackTapRunId, afterDestinationWrite: async () => { throw new Error('QA_TAP_ATOMIC_ROLLBACK'); } }), /QA_TAP_ATOMIC_ROLLBACK/);
  assert.equal((await db.tap.findUniqueOrThrow({ where: { id: rollbackTap.id } })).pontoVendaId, null, 'injected pre-commit failure rolls back Tap ownership');
  assert.equal(await db.pdvMigrationRun.count({ where: { id: rollbackTapRunId } }), 0, 'injected pre-commit failure rolls back run, batch, maps and checkpoint');
  const finalizeTamperRunId = id('tap-finalize-tamper-run');
  await assert.rejects(runPdvTapOwnershipMigration({ db, companyId: rollbackTenant.id, pointId: rollbackPoint.id, runId: finalizeTamperRunId, afterDestinationWrite: async (tx) => {
    const map = await tx.pdvMigrationMap.findUnique({ where: { sourceType_sourceId: { sourceType: 'LEGACY_TAP', sourceId: rollbackTap.id } } });
    if (map) await tx.pdvMigrationMap.update({ where: { id: map.id }, data: { sourcePayload: { ...map.sourcePayload, nome: 'hook mutation' } } });
  } }), (error) => error instanceof PdvTapBlocker && error.code === 'SOURCE_PAYLOAD_CHANGED', 'finalization revalidates evidence after writes and test hooks');
  assert.equal((await db.tap.findUniqueOrThrow({ where: { id: rollbackTap.id } })).pontoVendaId, null, 'hook-time evidence tampering rolls back the ownership write');
  assert.equal(await db.pdvMigrationRun.count({ where: { id: finalizeTamperRunId } }), 0, 'hook-time evidence tampering rolls back all run evidence');
  await db.tap.delete({ where: { id: rollbackTap.id } });
  const command = async (name, event, status = 'ABERTA') => db.comanda.create({ data: { id: id(name), origem: event ? 'EVENTO' : 'CAIXA', eventoId: event?.id ?? null, pontoVendaId: event ? null : point.id, clienteId: client.id, status, total: '18.25', desconto: '0.50', numero: name.length } });
  const eventCommand1 = await command('event-command-1', events[0]);
  const eventCommand2 = await command('event-command-2', events[1], 'FECHADA');
  const cashCommand = await command('cash-command', null, 'CANCELADA');
  const item1 = await db.itemComanda.create({ data: { id: id('item-prepared-togo'), comandaId: eventCommand1.id, produtoId: product.id, volumeMl: 0, quantidade: 2, precoUnit: '4.25', nome: 'Snapshot item', observacao: 'private source observation', exigePreparo: true, paraViagem: true } });
  await db.itemComanda.create({ data: { id: id('item-cancelled'), comandaId: eventCommand2.id, produtoId: product.id, volumeMl: 500, quantidade: 1, precoUnit: '9.75', nome: 'Cancelled snapshot', canceladoEm: new Date('2026-11-12T19:00:00.000Z') } });
  const soldOptional = await db.itemComandaOpcional.create({ data: { id: id('sold-optional'), itemComandaId: item1.id, nome: 'Historical optional snapshot', precoAdicional: '0.75', quantidade: 1 } });
  const order = await db.pedidoOperacao.create({ data: { id: id('kitchen-order-togo'), cervejariaId: company.id, comandaId: eventCommand1.id, pontoVendaId: point.id, numero: 9, diaOperacional: new Date('2026-11-05T00:00:00.000Z'), status: 'ENTREGUE', paraViagem: true, criadoPorId: owner.id, statusDesde: new Date('2026-11-05T19:00:00.000Z'), entregueEm: new Date('2026-11-05T19:10:00.000Z') } });
  const localCancelledOrder = await db.pedidoOperacao.create({ data: { id: id('kitchen-order-local-cancelled'), cervejariaId: company.id, comandaId: eventCommand2.id, numero: 10, diaOperacional: new Date('2026-11-12T00:00:00.000Z'), status: 'CANCELADO', paraViagem: false, criadoPorId: owner.id, statusDesde: new Date('2026-11-12T19:00:00.000Z') } });
  await db.itemComanda.update({ where: { id: item1.id }, data: { pedidoCozinhaId: order.id } });
  const item2 = await db.itemComanda.update({ where: { id: id('item-cancelled') }, data: { pedidoCozinhaId: localCancelledOrder.id } });
  await db.pedidoOperacaoStatusHistorico.createMany({ data: [
    { id: id('history-received'), pedidoId: order.id, status: 'RECEBIDO', registradoEm: new Date('2026-11-05T18:01:00.000Z') },
    { id: id('history-preparing'), pedidoId: order.id, status: 'EM_PREPARO', registradoEm: new Date('2026-11-05T18:30:00.000Z') },
    { id: id('history-ready'), pedidoId: order.id, status: 'PRONTO', registradoEm: new Date('2026-11-05T19:00:00.000Z') },
    { id: id('history-delivered'), pedidoId: order.id, status: 'ENTREGUE', registradoEm: new Date('2026-11-05T19:10:00.000Z') },
    { id: id('history-local-received'), pedidoId: localCancelledOrder.id, status: 'RECEBIDO', registradoEm: new Date('2026-11-12T18:01:00.000Z') },
    { id: id('history-local-cancelled'), pedidoId: localCancelledOrder.id, status: 'CANCELADO', registradoEm: new Date('2026-11-12T18:10:00.000Z') },
  ] });
  const portal = await db.pedidoCliente.create({ data: { id: id('portal-order'), eventoId: events[0].id, comandaId: eventCommand1.id, clienteId: client.id, status: 'PENDENTE' } });
  await db.pedidoClienteItem.create({ data: { id: id('portal-line'), pedidoId: portal.id, produtoId: product.id, volumeMl: 0, quantidade: 1, precoUnit: '4.25' } });
  const debtCommand = await db.comanda.create({ data: { id: id('event-debt-command'), origem: 'EVENTO', eventoId: events[1].id, clienteId: client.id, status: 'FECHADA', tipo: 'COMANDA', total: '6.00', fechadaEm: new Date('2026-11-12T22:00:00.000Z'), fechadoPorId: owner.id } });
  const debt = await db.contaReceber.create({ data: { id: id('event-debt'), comandaId: debtCommand.id, clienteId: client.id, valorOriginal: '6.00', criadoPorId: owner.id, createdAt: new Date('2026-11-12T20:00:00.000Z') } });
  await db.pagamento.createMany({ data: [
    { id: id('integrated-sale-payment'), comandaId: eventCommand1.id, sessaoCaixaEventoId: eventSession.id, forma: 'PIX', valor: '18.25', registradoPorId: owner.id, pagoEm: new Date('2026-11-05T20:00:00.000Z') },
    { id: id('integrated-debt-partial'), comandaId: debtCommand.id, contaReceberId: debt.id, sessaoCaixaEventoId: debtEventSession.id, forma: 'DINHEIRO', valor: '2.00', valorRecebido: '5.00', troco: '3.00', registradoPorId: owner.id, pagoEm: new Date('2026-11-12T21:00:00.000Z') },
    { id: id('integrated-debt-settlement'), comandaId: debtCommand.id, contaReceberId: debt.id, sessaoCaixaId: cashSession.id, forma: 'CARTAO_CREDITO', valor: '4.00', registradoPorId: owner.id, pagoEm: new Date('2026-11-13T15:00:00.000Z') },
  ] });
  const eventCashMovement = await db.movimentoCaixaEvento.create({ data: { id: id('integrated-event-supply'), sessaoId: eventSession.id, tipo: 'SUPRIMENTO', valor: '1.37', observacao: 'synthetic integrated movement', registradoPorId: owner.id, createdAt: new Date('2026-11-05T22:00:00.000Z') } });
  const financeRunId = id('finance');
  const financeResult = await runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: financeRunId });
  assert.equal(financeResult.status, 'COMPLETED', JSON.stringify(financeResult));
  const integratedFinanceRows = {
    payments: await db.pagamento.findMany({ where: { id: { in: [id('integrated-sale-payment'), id('integrated-debt-partial'), id('integrated-debt-settlement')] } }, orderBy: { id: 'asc' } }),
    debt: await db.contaReceber.findUniqueOrThrow({ where: { id: debt.id } }),
    movement: await db.movimentoCaixaOperacao.findUniqueOrThrow({ where: { id: eventCashMovement.id } }),
  };
  assert.deepEqual(integratedFinanceRows.payments.map((row) => [row.id, row.valor.toFixed(2), row.sessaoCaixaId, row.sessaoCaixaEventoId]), [
    [id('integrated-debt-partial'), '2.00', debtEventSession.id, debtEventSession.id],
    [id('integrated-debt-settlement'), '4.00', cashSession.id, null],
    [id('integrated-sale-payment'), '18.25', eventSession.id, eventSession.id],
  ]);
  assert.equal(integratedFinanceRows.debt.valorOriginal.toFixed(2), '6.00');
  assert.equal(integratedFinanceRows.movement.valor.toFixed(2), '1.37');
  const balance = await db.inventoryBalance.create({ data: { id: id('stock-balance'), cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, quantidade: '3.125', estoqueMinimo: '0.500' } });
  const movement = await db.inventoryMovement.create({ data: { id: id('stock-movement'), cervejariaId: company.id, pontoVendaId: point.id, produtoId: product.id, tipo: 'SAIDA_VENDA', quantidade: '0.875', registradoPorId: owner.id, pedidoId: order.id, createdAt: new Date('2026-11-05T19:05:00.000Z') } });
  const unattached = await db.comanda.create({ data: { id: id('unattached'), origem: 'EVENTO', eventoId: null, pontoVendaId: null, status: 'ABERTA', total: '0.00' } });
  const before = plain({
    commands: await db.comanda.findMany({ where: { id: { in: [eventCommand1.id, eventCommand2.id, debtCommand.id, cashCommand.id] } }, orderBy: { id: 'asc' } }),
    items: await db.itemComanda.findMany({ where: { comandaId: { in: [eventCommand1.id, eventCommand2.id] } }, orderBy: { id: 'asc' } }),
    optionals: await db.itemComandaOpcional.findMany({ where: { id: soldOptional.id } }),
    orders: await db.pedidoOperacao.findMany({ where: { id: { in: [order.id, localCancelledOrder.id] } }, orderBy: { id: 'asc' }, include: { historicoStatus: true } }),
    portal: await db.pedidoCliente.findMany({ where: { id: portal.id }, include: { itens: true } }),
    balance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } }), movement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } }),
  });
  const photograph = await db.$transaction((tx) => readPdvCommerceSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' });
  console.log('QA_STAGE=commerce-photograph-read');
  assert.deepEqual(photograph.coverage.unresolvedCommandIds, [unattached.id], 'unassignable records remain explicit in source coverage');
  assert.deepEqual([photograph.coverage.commandCount, photograph.coverage.itemCount, photograph.coverage.soldOptionalCount, photograph.coverage.kitchenOrderCount, photograph.coverage.kitchenStatusHistoryCount, photograph.coverage.inventoryBalanceCount, photograph.coverage.inventoryMovementCount], [4, 2, 1, 2, 6, 1, 1]);

  const commerceRunId = id('commerce-run');
  const paused = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId, batchSize: 1, maxBatches: 1 });
  assert.equal(paused.status, 'RUNNING', JSON.stringify(paused));
  const checkpoint = plain(paused.checkpoint);
  await assert.rejects(runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId, afterDestinationWrite: (row) => { if (row.type === 'COMANDA' && row.id === eventCommand1.id) throw new Error('QA_COMMERCE_ROLLBACK'); } }), /QA_COMMERCE_ROLLBACK/);
  assert.deepEqual(plain((await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: commerceRunId } })).checkpoint), checkpoint, 'failed batch retains last committed checkpoint');
  assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: eventCommand1.id } })).pontoVendaId, null, 'transaction rolled back link write');
  const completed = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId });
  console.log('QA_STAGE=commerce-run-completed');
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed));
  const linked1 = await db.comanda.findUniqueOrThrow({ where: { id: eventCommand1.id } });
  const linked2 = await db.comanda.findUniqueOrThrow({ where: { id: eventCommand2.id } });
  const linkedDebt = await db.comanda.findUniqueOrThrow({ where: { id: debtCommand.id } });
  assert.equal(linked1.pontoVendaId, point.id); assert.equal(linked1.ocorrenciaId, events[0].id);
  assert.equal(linked2.pontoVendaId, point.id); assert.equal(linked2.ocorrenciaId, events[1].id);
  assert.equal(linkedDebt.pontoVendaId, point.id); assert.equal(linkedDebt.ocorrenciaId, events[1].id);
  assert.notEqual(linked1.ocorrenciaId, linked2.ocorrenciaId, 'same client retains distinct historical occurrences');
  assert.equal((await db.pedidoOperacao.findUniqueOrThrow({ where: { id: order.id } })).pontoVendaId, point.id);
  assert.deepEqual(plain({ commands: await db.comanda.findMany({ where: { id: { in: [eventCommand1.id, eventCommand2.id, debtCommand.id, cashCommand.id] } }, orderBy: { id: 'asc' } }), items: await db.itemComanda.findMany({ where: { comandaId: { in: [eventCommand1.id, eventCommand2.id] } }, orderBy: { id: 'asc' } }), optionals: await db.itemComandaOpcional.findMany({ where: { id: soldOptional.id } }), orders: await db.pedidoOperacao.findMany({ where: { id: { in: [order.id, localCancelledOrder.id] } }, orderBy: { id: 'asc' }, include: { historicoStatus: true } }), portal: await db.pedidoCliente.findMany({ where: { id: portal.id }, include: { itens: true } }), balance: await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } }), movement: await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } }) }), {
    ...before,
    commands: before.commands.map((row) => ({ ...row, pontoVendaId: point.id, ocorrenciaId: row.id === eventCommand1.id ? events[0].id : row.id === eventCommand2.id ? events[1].id : row.id === debtCommand.id ? events[1].id : null })),
    orders: before.orders.map((row) => ({ ...row, ...(row.pontoVendaId === null ? { pontoVendaId: point.id } : {}) })),
  }, 'only additive PDV/occurrence links changed; commercial snapshots, item links, status history and stock values are exact');
  assert.equal((await db.pedidoOperacaoStatusHistorico.count({ where: { pedidoId: { in: [order.id, localCancelledOrder.id] } } })), 6);
  assert.equal((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantidade.toString(), '3.125');
  assert.equal((await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.875');
  assert.equal((await db.pdvMigrationMap.count({ where: { cervejariaId: company.id, sourceType: { in: ['COMANDA','ITEM_COMANDA','ITEM_COMANDA_OPCIONAL','PEDIDO_COZINHA','PEDIDO_COZINHA_STATUS','PEDIDO_CLIENTE','PEDIDO_CLIENTE_ITEM','ESTOQUE_SALDO','MOVIMENTO_ESTOQUE'] } } })), completed.checkpoint.totalRecords);
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'same run revalidates');
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('commerce-new-run') })).status, 'COMPLETED', 'new run reuses stable maps without duplicate rows');

  // Revalidate and replay every completed integrated scope before later adversarial tests mutate unrelated certification inputs.
  const catalogSourceAtCommercialFinish = plain(await db.$transaction((tx) => readPdvCatalogSourceSnapshot(tx, company.id), { isolationLevel: 'RepeatableRead' }));
  const catalogSourceDrift = changedJsonPaths(catalogSourceAtStart, catalogSourceAtCommercialFinish);
  const catalogPlanAtCommercialFinish = await readCatalogPlan();
  const catalogPlanDrift = changedJsonPaths(catalogPlanAtStart, catalogPlanAtCommercialFinish);
  console.log(`QA_STAGE=catalog-source-comparison; changedPaths=${JSON.stringify(catalogSourceDrift)}; planChangedPaths=${JSON.stringify(catalogPlanDrift)}; sourceKeys=${catalogPlanAtStart.sourceKey}->${catalogPlanAtCommercialFinish.sourceKey}; hashesEqual=${catalogPlanAtStart.sourceSnapshotHash === catalogPlanAtCommercialFinish.sourceSnapshotHash}`);
  assert.deepEqual(catalogSourceDrift, [], 'catalog source payload remains identical across sessions/finance/commercial migration before replay');
  assert.deepEqual(catalogPlanDrift, [], 'rebuilt catalog items remain identical across the integrated migration before replay');
  for (const [label, result] of [
    ['business', await runPdvBusinessMigration({ db, companyId: company.id, runId: businessRunId })],
    ['catalog', await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: catalogRunId })],
    ['sessions', await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: sessionRunId })],
    ['finance', await runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: financeRunId })],
    ['commerce', await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })],
  ]) assert.equal(result.status, 'COMPLETED', `same-run integrated revalidation ${label}: ${JSON.stringify(result)}`);
  for (const [label, result] of [
    ['business', await runPdvBusinessMigration({ db, companyId: company.id, runId: id('business-replay-new-run') })],
    ['catalog', await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: id('catalog-replay-new-run') })],
    ['sessions', await runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: id('sessions-replay-new-run') })],
    ['finance', await runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: id('finance-replay-new-run') })],
    ['commerce', await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('commerce-replay-new-run') })],
  ]) assert.equal(result.status, 'COMPLETED', `new-run integrated replay ${label}: ${JSON.stringify(result)}`);

  // Parent identity is historical payload. Reparenting between valid same-tenant parents
  // must invalidate the stable map even when the child's other fields and ID are unchanged.
  const historyForReparent = await db.pedidoOperacaoStatusHistorico.findFirstOrThrow({ where: { pedidoId: order.id } });
  const parentDriftCases = [
    { label: 'item-comanda-parent', mutate: () => db.itemComanda.update({ where: { id: item2.id }, data: { comandaId: eventCommand1.id } }), restore: () => db.itemComanda.update({ where: { id: item2.id }, data: { comandaId: eventCommand2.id } }), expected: 'COMMERCE_ORDER_ITEM_LINK_MISMATCH' },
    { label: 'sold-optional-parent', mutate: () => db.itemComandaOpcional.update({ where: { id: soldOptional.id }, data: { itemComandaId: item2.id } }), restore: () => db.itemComandaOpcional.update({ where: { id: soldOptional.id }, data: { itemComandaId: item1.id } }), expected: 'SOURCE_PAYLOAD_CHANGED' },
    { label: 'order-status-history-parent', mutate: () => db.pedidoOperacaoStatusHistorico.update({ where: { id: historyForReparent.id }, data: { pedidoId: localCancelledOrder.id } }), restore: () => db.pedidoOperacaoStatusHistorico.update({ where: { id: historyForReparent.id }, data: { pedidoId: order.id } }), expected: 'SOURCE_PAYLOAD_CHANGED' },
  ];
  for (const scenario of parentDriftCases) {
    await scenario.mutate();
    const result = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id(`parent-drift-${scenario.label}`) });
    assert.equal(result.status, 'BLOCKED', `${scenario.label} blocks re-certification`);
    assert.equal(result.code, scenario.expected, `${scenario.label} has a specific blocker`);
    await scenario.restore();
  }
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId })).status, 'COMPLETED', 'restoring original parents preserves original certification');

  // A deterministic in-transaction mutation between source planning and receipt hashing
  // must roll back both the mutation and the pending batch/checkpoint advancement.
  const midBatchRunId = id('commerce-mid-batch-drift');
  const beforeDrift = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId, batchSize: 1, maxBatches: completed.checkpoint.totalRecords - 1 });
  assert.equal(beforeDrift.status, 'RUNNING');
  const beforeDriftCheckpoint = plain(beforeDrift.checkpoint);
  const driftAttempt = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId, afterDestinationWrite: async (row, tx) => {
    if (row.type === 'MOVIMENTO_ESTOQUE' && row.id === movement.id) await tx.inventoryMovement.update({ where: { id: movement.id }, data: { quantidade: '0.876' } });
  } });
  assert.equal(driftAttempt.status, 'BLOCKED');
  assert.equal(driftAttempt.code, 'MAPPED_DESTINATION_DIVERGED');
  assert.deepEqual(plain((await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: midBatchRunId } })).checkpoint), beforeDriftCheckpoint, 'mid-batch divergence retains last confirmed checkpoint');
  assert.equal((await db.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).quantidade.toString(), '0.875', 'mid-batch mutation rolls back');
  assert.equal((await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId })).status, 'COMPLETED', 'resumes after rollback without altering historic rows');

  const raceCompany = await db.cervejaria.create({ data: { nome: `QA commerce race ${runId}`, slug: slug('race') } });
  await db.configuracaoOperacao.create({ data: { cervejariaId: raceCompany.id, ativo: true, controlaEstoque: false, temCozinha: false, exclusivo: false, quantidadeMesas: 0, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  await db.configuracaoOperacional.create({ data: { cervejariaId: raceCompany.id, plannedOperationsEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, createdAt: new Date('2026-10-01T10:00:00.000Z'), updatedAt: new Date('2026-10-02T10:00:00.000Z') } });
  const raceTrailer = await db.trailer.create({ data: { id: id('race-trailer'), cervejariaId: raceCompany.id, nome: 'race trailer', identificador: 'RACE' } });
  await db.evento.create({ data: { id: id('race-event'), cervejariaId: raceCompany.id, trailerId: raceTrailer.id, nome: 'race', local: 'QA', data: new Date('2026-12-02T00:00:00.000Z'), horaInicio: '18:00', status: 'ABERTO', recorrencia: 'NENHUMA' } });
  const raceBusinessRunId = id('race-business');
  assert.equal((await runPdvBusinessMigration({ db, companyId: raceCompany.id, runId: raceBusinessRunId })).status, 'COMPLETED');
  const racePoint = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: raceCompany.id } });
  assert.equal(racePoint.id, raceTrailer.id, 'Event-only tenant maps its sole Trailer to a stable PDV identity');
  const raceProduct = await db.produto.create({ data: { id: id('race-product'), cervejariaId: raceCompany.id, nome: 'Authenticated cash product', tipo: 'COMIDA', controlaEstoque: false } });
  await db.preco.create({ data: { produtoId: raceProduct.id, volumeMl: 1, preco: '12.50' } });
  const authMenuA = await db.cardapio.create({ data: { id: id('auth-menu-a'), cervejariaId: raceCompany.id, nome: 'Authenticated menu A', ativo: true } });
  const authMenuB = await db.cardapio.create({ data: { id: id('auth-menu-b'), cervejariaId: raceCompany.id, nome: 'Authenticated menu B', ativo: true } });
  await db.cardapioProduto.createMany({ data: [
    { id: id('auth-menu-a-line'), cardapioId: authMenuA.id, produtoId: raceProduct.id, volumeMl: 0, precoUnit: '9.50' },
    { id: id('auth-menu-b-line'), cardapioId: authMenuB.id, produtoId: raceProduct.id, volumeMl: 0, precoUnit: '8.25' },
  ] });
  const raceCatalogRunId = id('race-catalog');
  const raceCatalogResult = await runPdvCatalogMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceCatalogRunId });
  assert.equal(raceCatalogResult.status, 'COMPLETED', JSON.stringify(raceCatalogResult));
  assert.deepEqual(await db.cardapioProduto.findMany({ where: { cardapioId: { in: [authMenuA.id, authMenuB.id] } }, orderBy: { cardapioId: 'asc' }, select: { id: true, cardapioId: true, produtoId: true, volumeMl: true, precoUnit: true, cervejariaId: true, pontoVendaId: true } }).then((rows) => rows.map((row) => [row.id, row.cardapioId, row.produtoId, row.volumeMl, centsExact(row.precoUnit), row.cervejariaId, row.pontoVendaId])), [
    [id('auth-menu-a-line'), authMenuA.id, raceProduct.id, 0, '950', raceCompany.id, racePoint.id],
    [id('auth-menu-b-line'), authMenuB.id, raceProduct.id, 0, '825', raceCompany.id, racePoint.id],
  ], 'authenticated API fixture has a migrated canonical PDV, two mapped menus and a positive unit price');
  const authCatalogPrice = await db.preco.findUniqueOrThrow({ where: { produtoId_volumeMl: { produtoId: raceProduct.id, volumeMl: 1 } } });
  assert.equal(centsExact(authCatalogPrice.preco), '1250', 'authenticated unit product retains its positive migrated catalog price');
  const raceOperator = await db.usuario.create({ data: { id: id('race-operator'), nome: 'Synthetic race operator', email: `${slug('race-operator')}@example.invalid`, senhaHash: 'synthetic', papel: 'DONO', cervejariaId: raceCompany.id } });
  const raceClient = await db.cliente.create({ data: { id: id('race-client'), cervejariaId: raceCompany.id, nome: 'Synthetic race customer' } });
  const raceEvent = await db.evento.findUniqueOrThrow({ where: { id: id('race-event') } });
  const raceSessionSource = await db.sessaoCaixaEvento.create({ data: { id: id('race-event-session'), eventoId: raceEvent.id, status: 'FECHADO', trocoInicial: '1.00', abertoPorId: raceOperator.id, abertoEm: new Date('2026-12-02T17:00:00.000Z'), fechadoPorId: raceOperator.id, fechadoEm: new Date('2026-12-02T22:00:00.000Z'), contadoDinheiro: '0.00', contadoPix: '1.25', contadoDebito: '0.00', contadoCredito: '0.00' } });
  const raceCommand = await db.comanda.create({ data: { id: id('race-command'), origem: 'EVENTO', eventoId: raceEvent.id, clienteId: raceClient.id, status: 'FECHADA', total: '2.50', fechadaEm: new Date('2026-12-02T21:00:00.000Z'), fechadoPorId: raceOperator.id } });
  const raceDebt = await db.contaReceber.create({ data: { id: id('race-debt'), comandaId: raceCommand.id, clienteId: raceClient.id, valorOriginal: '2.50', criadoPorId: raceOperator.id, createdAt: new Date('2026-12-02T21:00:00.000Z') } });
  const racePayment = await db.pagamento.create({ data: { id: id('race-payment'), comandaId: raceCommand.id, contaReceberId: raceDebt.id, sessaoCaixaEventoId: raceSessionSource.id, forma: 'PIX', valor: '1.25', registradoPorId: raceOperator.id, pagoEm: new Date('2026-12-02T21:30:00.000Z') } });
  const raceFinanceBefore = plain({ session: await db.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: raceSessionSource.id } }), payment: await db.pagamento.findUniqueOrThrow({ where: { id: racePayment.id } }), debt: await db.contaReceber.findUniqueOrThrow({ where: { id: raceDebt.id } }) });
  const raceSessionRunId = id('race-sessions');
  assert.equal((await runPdvSessionMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceSessionRunId })).status, 'COMPLETED');
  const raceFinanceRunId = id('race-finance');
  const raceFinanceResult = await runPdvFinanceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceFinanceRunId });
  assert.equal(raceFinanceResult.status, 'COMPLETED', JSON.stringify(raceFinanceResult));
  const racePaymentAfter = await db.pagamento.findUniqueOrThrow({ where: { id: racePayment.id } });
  const raceDebtAfter = await db.contaReceber.findUniqueOrThrow({ where: { id: raceDebt.id } });
  assert.deepEqual([racePaymentAfter.id, racePaymentAfter.valor.toFixed(2), racePaymentAfter.sessaoCaixaId, racePaymentAfter.sessaoCaixaEventoId], [racePayment.id, '1.25', raceSessionSource.id, raceSessionSource.id]);
  const raceDebtPayments = await db.pagamento.findMany({ where: { contaReceberId: raceDebt.id } });
  const raceReceivedCents = raceDebtPayments.reduce((total, row) => total + BigInt(centsExact(row.valor)), 0n);
  const racePrincipalCents = BigInt(centsExact(raceDebtAfter.valorOriginal));
  assert.deepEqual([raceDebtAfter.valorOriginal.toFixed(2), raceReceivedCents.toString(), (racePrincipalCents - raceReceivedCents).toString()], ['2.50', '125', '125'], 'second tenant has a nonempty finance scope and exact decimal debt reconciliation');
  const raceFinanceAfter = plain({ session: await db.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: raceSessionSource.id } }), payment: racePaymentAfter, debt: raceDebtAfter });
  assert.deepEqual([raceFinanceBefore.session.id, raceFinanceAfter.session.id, raceFinanceBefore.payment.id, raceFinanceAfter.payment.id, centsExact(raceFinanceBefore.payment.valor), centsExact(raceFinanceAfter.payment.valor), raceFinanceBefore.payment.forma, raceFinanceAfter.payment.forma, centsExact(raceFinanceBefore.debt.valorOriginal), centsExact(raceFinanceAfter.debt.valorOriginal)], [raceSessionSource.id, raceSessionSource.id, racePayment.id, racePayment.id, '125', '125', 'PIX', 'PIX', '250', '250']);
  await db.itemComanda.create({ data: { id: id('race-item'), comandaId: raceCommand.id, produtoId: raceProduct.id, precoUnit: '2.50' } });
  const raceSecondCommand = await db.comanda.create({ data: { id: id('race-second-command'), origem: 'EVENTO', eventoId: raceEvent.id, clienteId: raceClient.id, status: 'ABERTA', total: '1.00' } });
  const reparentedItem = await db.itemComanda.create({ data: { id: id('race-reparented-item'), comandaId: raceSecondCommand.id, produtoId: raceProduct.id, precoUnit: '1.00', nome: 'No kitchen-order parent-change snapshot' } });
  const raceRunId = id('race-commerce-run');
  let release; let arrive;
  const arrived = new Promise((resolve) => { arrive = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId, batchSize: 1, afterDestinationWrite: async (row) => { if (row.type === 'COMANDA') { arrive(); await gate; } } });
  await arrived;
  const second = runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId, batchSize: 1 });
  let observedLockWait = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await db.$queryRaw`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
    if (waiting.length) { observedLockWait = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  release();
  assert.equal(observedLockWait, true, 'concurrent caller reached scope advisory lock');
  assert.deepEqual((await Promise.all([first, second])).map((row) => row.status), ['COMPLETED','COMPLETED']);
  assert.equal(await db.pdvMigrationMap.count({ where: { sourceType: 'COMANDA', sourceId: raceCommand.id } }), 1);
  assert.equal(await db.pdvMigrationBatch.count({ where: { runId: raceRunId } }), (await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: raceRunId } })).checkpoint.totalRecords);
  await db.itemComanda.update({ where: { id: reparentedItem.id }, data: { comandaId: raceCommand.id } });
  const parentTamper = await runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId });
  assert.equal(parentTamper.status, 'BLOCKED');
  assert.equal(parentTamper.code, 'RUN_SCOPE_OR_SNAPSHOT_MISMATCH', 'item parent change is rejected by the certified source photograph even without a kitchen order link');
  await db.itemComanda.update({ where: { id: reparentedItem.id }, data: { comandaId: raceSecondCommand.id } });
  assert.equal((await runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId })).status, 'COMPLETED', 'restoring original parent permits revalidation');

  const menuRowsAfterReplays = await db.cardapioProduto.findMany({ where: { cardapioId: { in: [menuA.id, menuB.id] } }, orderBy: [{ cardapioId: 'asc' }, { produtoId: 'asc' }, { volumeMl: 'asc' }] });
  assert.deepEqual(menuRowsAfterReplays.map((row) => [row.id, row.cardapioId, row.produtoId, row.volumeMl, centsExact(row.precoUnit)]), expectedMigratedMenuRows, 'same/new-run scope replay creates no duplicate menu or price rows');
  assert.equal(await db.cardapio.count({ where: { id: { in: [menuA.id, menuB.id] } } }), 2);
  const foreignTenant = await db.cervejaria.create({ data: { id: id('foreign-menu-tenant'), nome: 'Synthetic foreign menu tenant', slug: slug('foreign-menu-tenant') } });
  const foreignProduct = await db.produto.create({ data: { id: id('foreign-menu-product'), cervejariaId: foreignTenant.id, nome: 'Synthetic foreign menu product', tipo: 'COMIDA' } });
  const incompatibleMenuEntry = await db.cardapioProduto.create({ data: { id: id('foreign-menu-entry'), cardapioId: menuA.id, produtoId: foreignProduct.id, volumeMl: 0, precoUnit: '99.99' } });
  const catalogMapCountBeforeInvalidLink = await db.pdvMigrationMap.count({ where: { cervejariaId: company.id, sourceType: { in: ['CATALOGO_CARDAPIO', 'CATALOGO_CARDAPIO_ITEM'] } } });
  const incompatibleCatalog = await runPdvCatalogMigration({ db, companyId: company.id, pointId: point.id, runId: id('foreign-menu-link') });
  assert.deepEqual([incompatibleCatalog.status, incompatibleCatalog.code], ['BLOCKED', 'MENU_PRODUCT_TENANT_MISMATCH'], 'a menu linked to a product from another tenant blocks with a specific diagnostic');
  assert.equal(await db.pdvMigrationMap.count({ where: { cervejariaId: company.id, sourceType: { in: ['CATALOGO_CARDAPIO', 'CATALOGO_CARDAPIO_ITEM'] } } }), catalogMapCountBeforeInvalidLink, 'tenant mismatch performs no partial menu/map write');
  const rejectedEntryState = await db.cardapioProduto.findUniqueOrThrow({ where: { id: incompatibleMenuEntry.id }, select: { id: true, cardapioId: true, produtoId: true, cervejariaId: true, pontoVendaId: true, precoUnit: true } });
  assert.deepEqual([rejectedEntryState.id, rejectedEntryState.cardapioId, rejectedEntryState.produtoId, rejectedEntryState.cervejariaId, rejectedEntryState.pontoVendaId, centsExact(rejectedEntryState.precoUnit)], [incompatibleMenuEntry.id, menuA.id, foreignProduct.id, null, null, '9999'], 'rejected source link is preserved without assigning a tenant/PDV');
  await db.cardapioProduto.delete({ where: { id: incompatibleMenuEntry.id } });

  const [{ getCardapioTurno }, { resolverItens }, { prisma: appPrisma }] = await Promise.all([
    import('../src/lib/operacao/sessao-cardapio.ts'),
    import('../src/lib/operacao/venda.ts'),
    import('../src/lib/prisma.ts'),
  ]);
  consumerPrisma = appPrisma;
  const cardapioTurnoPrices = async (sessionId, label, expectedMenuId, expected) => {
    const view = await getCardapioTurno(sessionId, company.id);
    assert(view, `${label}: real getCardapioTurno returned a session`);
    assert.equal(view.cardapioId, expectedMenuId, `${label}: selected menu preserved`);
    const actual = expected.map(([productId, volumeMl]) => {
      const row = view.produtos.find((item) => item.id === productId && item.volumeMl === volumeMl);
      assert(row, `${label}: product ${productId} volume ${volumeMl} is present in real session menu consumer`);
      return [productId, volumeMl, centsExact(row.precoUnit)];
    });
    return actual;
  };
  const expectedCashTurn = [[draftProduct.id, 500, '600'], [draftProduct.id, 1000, '1000'], [product.id, 0, '0']];
  const expectedOverrideTurn = [[draftProduct.id, 500, '875'], [draftProduct.id, 1000, '1200'], [product.id, 0, '550']];
  const expectedEventTurn = [[draftProduct.id, 500, '700'], [draftProduct.id, 1000, '1200'], [product.id, 0, '500']];
  const expectedCatalogTurn = [[draftProduct.id, 500, '850'], [product.id, 0, '625']];
  const expectedEventCatalogTurn = [[draftProduct.id, 500, '850'], [draftProduct.id, 1000, '1300'], [product.id, 0, '625']];
  assert.deepEqual(await cardapioTurnoPrices(cashSession.id, 'Por Caixa menu A', menuA.id, expectedCashTurn), expectedCashTurn);
  assert.deepEqual(await cardapioTurnoPrices(overrideSession.id, 'Por Caixa menu B with overrides', menuB.id, expectedOverrideTurn), expectedOverrideTurn);
  assert.deepEqual(await cardapioTurnoPrices(eventSession.id, 'EVENTO menu B', menuB.id, expectedEventTurn), expectedEventTurn);
  assert.deepEqual(await cardapioTurnoPrices(catalogFallbackSession.id, 'Por Caixa without selected menu', null, expectedCatalogTurn), expectedCatalogTurn);
  assert.deepEqual(await cardapioTurnoPrices(debtEventSession.id, 'EVENTO without selected menu', null, expectedEventCatalogTurn), expectedEventCatalogTurn);

  const resolvedPriceCases = [
    { label: 'Por Caixa menu A: missing override, explicit NULL and explicit zero', sessionId: cashSession.id, lines: [
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 500, quantidade: 2 },
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 1000, quantidade: 1 },
      { produtoId: product.id, quantidade: 1 },
    ], expected: [['500', '600'], ['1000', '1000'], ['0', '0']], totalCents: '2200' },
    { label: 'Por Caixa menu B: positive override wins, NULL inherits menu and unit positive override wins', sessionId: overrideSession.id, lines: [
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 500, quantidade: 2 },
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 1000, quantidade: 1 },
      { produtoId: product.id, quantidade: 1 },
    ], expected: [['500', '875'], ['1000', '1200'], ['0', '550']], totalCents: '3500' },
    { label: 'EVENTO occurrence with selected menu', sessionId: eventSession.id, lines: [
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 500, quantidade: 1 },
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 1000, quantidade: 1 },
      { produtoId: product.id, quantidade: 1 },
    ], expected: [['500', '700'], ['1000', '1200'], ['0', '500']], totalCents: '2400' },
    { label: 'EVENTO without a selected menu falls back to catalog', sessionId: debtEventSession.id, lines: [
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 500, quantidade: 1 },
      { produtoId: product.id, quantidade: 2 },
    ], expected: [['500', '850'], ['0', '625']], totalCents: '2100' },
    { label: 'Por Caixa without selected menu falls back to catalog', sessionId: catalogFallbackSession.id, lines: [
      { produtoId: draftProduct.id, tapId: tap.id, volumeMl: 500, quantidade: 1 },
      { produtoId: product.id, quantidade: 2 },
    ], expected: [['500', '850'], ['0', '625']], totalCents: '2100' },
  ];
  const observedPriceRows = [];
  for (const scenario of resolvedPriceCases) {
    const resolved = await db.$transaction((tx) => resolverItens(tx, company.id, scenario.lines, { sessaoCaixaId: scenario.sessionId, tapsEnabled: true }));
    const actual = resolved.map((row) => [String(row.volumeMl), centsExact(row.precoUnit)]);
    assert.deepEqual(actual, scenario.expected, `${scenario.label}: real resolverItens result`);
    const total = resolved.reduce((sum, row) => sum + BigInt(centsExact(row.precoUnit)) * BigInt(row.quantidade), 0n).toString();
    assert.equal(total, scenario.totalCents, `${scenario.label}: exact total in cents`);
    observedPriceRows.push({ scenario: scenario.label, prices: actual, totalCents: total });
  }
  console.log(`QA_STAGE=real-menu-consumers-verified; prices=${JSON.stringify(observedPriceRows)}`);

  const historicSaleSnapshotBeforeCatalogEdit = plain({
    item: await db.itemComanda.findUniqueOrThrow({ where: { id: item1.id } }),
    optional: await db.itemComandaOpcional.findUniqueOrThrow({ where: { id: soldOptional.id } }),
  });
  const historicProductId = historicSaleSnapshotBeforeCatalogEdit.item.produtoId;
  const historicVolumeMl = historicSaleSnapshotBeforeCatalogEdit.item.volumeMl;
  assert.equal(historicProductId, product.id, 'the historical sale snapshot references the synthetic unit product');
  assert.equal(historicVolumeMl, 0, 'the historical sale snapshot references the unit volume');
  assert.equal(historicSaleSnapshotBeforeCatalogEdit.item.comandaId, eventCommand1.id);
  assert.deepEqual([
    historicSaleSnapshotBeforeCatalogEdit.item.id,
    historicSaleSnapshotBeforeCatalogEdit.item.produtoId,
    historicSaleSnapshotBeforeCatalogEdit.item.volumeMl,
    centsExact(historicSaleSnapshotBeforeCatalogEdit.item.precoUnit),
    historicSaleSnapshotBeforeCatalogEdit.item.quantidade,
    historicSaleSnapshotBeforeCatalogEdit.item.nome,
    historicSaleSnapshotBeforeCatalogEdit.optional.id,
    historicSaleSnapshotBeforeCatalogEdit.optional.itemComandaId,
    centsExact(historicSaleSnapshotBeforeCatalogEdit.optional.precoAdicional),
    historicSaleSnapshotBeforeCatalogEdit.optional.quantidade,
    historicSaleSnapshotBeforeCatalogEdit.optional.nome,
  ], [item1.id, product.id, 0, '425', 2, 'Snapshot item', soldOptional.id, item1.id, '75', 1, 'Historical optional snapshot'], 'record the exact historical product/volume, sale and optional snapshot before editing that product prices');
  const catalogUnitPriceBeforeEdit = await db.preco.findUniqueOrThrow({ where: { produtoId_volumeMl: { produtoId: historicProductId, volumeMl: 1 } } });
  const menuUnitPriceBeforeEdit = await db.cardapioProduto.findUniqueOrThrow({ where: { id: id('menu-b-unit') } });
  assert.deepEqual([
    [catalogUnitPriceBeforeEdit.produtoId, catalogUnitPriceBeforeEdit.volumeMl, centsExact(catalogUnitPriceBeforeEdit.preco)],
    [menuUnitPriceBeforeEdit.cardapioId, menuUnitPriceBeforeEdit.produtoId, menuUnitPriceBeforeEdit.volumeMl, centsExact(menuUnitPriceBeforeEdit.precoUnit)],
  ], [[historicProductId, 1, '625'], [menuB.id, historicProductId, historicVolumeMl, '500']], 'catalog unit volume 1 and menu unit volume 0 both identify the historical unit product; capture old prices');
  assert.equal(await db.sessaoCaixaProdutoOperacao.findUnique({ where: { sessaoCaixaId_produtoId_volumeMl: { sessaoCaixaId: catalogFallbackSession.id, produtoId: historicProductId, volumeMl: historicVolumeMl } } }).then((row) => row?.precoUnit ?? null), null, 'catalog fallback session has no explicit unit override');
  assert.equal(await db.sessaoCaixaProdutoOperacao.findUnique({ where: { sessaoCaixaId_produtoId_volumeMl: { sessaoCaixaId: eventSession.id, produtoId: historicProductId, volumeMl: historicVolumeMl } } }).then((row) => row?.precoUnit ?? null), null, 'selected menu session has only a null unit override, which cannot hide the menu edit');
  await db.preco.update({ where: { produtoId_volumeMl: { produtoId: historicProductId, volumeMl: catalogUnitPriceBeforeEdit.volumeMl } }, data: { preco: '7.77' } });
  await db.cardapioProduto.update({ where: { id: menuUnitPriceBeforeEdit.id }, data: { precoUnit: '8.88' } });
  const catalogFallbackAfterEdit = await cardapioTurnoPrices(catalogFallbackSession.id, 'Por Caixa without menu after editing the sold unit product', null, [[historicProductId, historicVolumeMl, '777']]);
  const menuAfterEdit = await cardapioTurnoPrices(eventSession.id, 'EVENTO menu B without unit override after editing the sold unit product', menuB.id, [[historicProductId, historicVolumeMl, '888']]);
  const resolvedCatalogFallbackAfterEdit = await db.$transaction((tx) => resolverItens(tx, company.id, [{ produtoId: historicProductId, quantidade: 1 }], { sessaoCaixaId: catalogFallbackSession.id, tapsEnabled: true }));
  const resolvedMenuAfterEdit = await db.$transaction((tx) => resolverItens(tx, company.id, [{ produtoId: historicProductId, quantidade: 1 }], { sessaoCaixaId: eventSession.id, tapsEnabled: true }));
  assert.deepEqual(resolvedCatalogFallbackAfterEdit.map((row) => [row.produtoId, row.volumeMl, centsExact(row.precoUnit)]), [[historicProductId, historicVolumeMl, '777']], 'real resolver observes the edited catalog price for the sold product/volume without an override');
  assert.deepEqual(resolvedMenuAfterEdit.map((row) => [row.produtoId, row.volumeMl, centsExact(row.precoUnit)]), [[historicProductId, historicVolumeMl, '888']], 'real resolver observes the edited menu price for the sold product/volume without an override');
  const historicSaleSnapshotAfterCatalogEdit = plain({
    item: await db.itemComanda.findUniqueOrThrow({ where: { id: item1.id } }),
    optional: await db.itemComandaOpcional.findUniqueOrThrow({ where: { id: soldOptional.id } }),
  });
  assert.deepEqual(historicSaleSnapshotAfterCatalogEdit, historicSaleSnapshotBeforeCatalogEdit, 'editing catalog and menu prices for the same sold product/volume after completed scope replays leaves the full historical item/optional snapshots byte-for-byte equivalent');
  assert.deepEqual([
    historicSaleSnapshotAfterCatalogEdit.item.id,
    historicSaleSnapshotAfterCatalogEdit.item.produtoId,
    historicSaleSnapshotAfterCatalogEdit.item.volumeMl,
    centsExact(historicSaleSnapshotAfterCatalogEdit.item.precoUnit),
    historicSaleSnapshotAfterCatalogEdit.item.quantidade,
    historicSaleSnapshotAfterCatalogEdit.item.nome,
    historicSaleSnapshotAfterCatalogEdit.optional.id,
    historicSaleSnapshotAfterCatalogEdit.optional.itemComandaId,
    centsExact(historicSaleSnapshotAfterCatalogEdit.optional.precoAdicional),
    historicSaleSnapshotAfterCatalogEdit.optional.quantidade,
    historicSaleSnapshotAfterCatalogEdit.optional.nome,
  ], [item1.id, historicProductId, historicVolumeMl, '425', 2, 'Snapshot item', soldOptional.id, item1.id, '75', 1, 'Historical optional snapshot'], 'historical sale remains at 425 cents with its original identity/quantity/name and the same optional snapshot although current prices are 777/888 cents');
  console.log(`QA_STAGE=sold-product-price-edits-preserve-history; product=${historicProductId}; soldVolume=${historicVolumeMl}; oldCatalogCents=625; newCatalogCents=777; oldMenuCents=500; newMenuCents=888; fallbackConsumer=${JSON.stringify(catalogFallbackAfterEdit)}; menuConsumer=${JSON.stringify(menuAfterEdit)}; historicalSaleCents=${centsExact(historicSaleSnapshotAfterCatalogEdit.item.precoUnit)}; historyUnchanged=true`);

  const raceCommerceRunId = raceRunId;
  for (const [label, result] of [
    ['business', await runPdvBusinessMigration({ db, companyId: raceCompany.id, runId: raceBusinessRunId })],
    ['catalog', await runPdvCatalogMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceCatalogRunId })],
    ['sessions', await runPdvSessionMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceSessionRunId })],
    ['finance', await runPdvFinanceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceFinanceRunId })],
    ['commerce', await runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceCommerceRunId })],
  ]) assert.equal(result.status, 'COMPLETED', `Por Caixa/Evento tenant revalidation ${label}: ${JSON.stringify(result)}`);
  assert.deepEqual(plain({ session: await db.sessaoCaixaEvento.findUniqueOrThrow({ where: { id: raceSessionSource.id } }), payment: await db.pagamento.findUniqueOrThrow({ where: { id: racePayment.id } }), debt: await db.contaReceber.findUniqueOrThrow({ where: { id: raceDebt.id } }) }), raceFinanceAfter, 'second tenant nonempty financial rows remain stable after replay');

  // Downstream scopes must reject a previously certified occurrence when its
  // date, agenda, or business content changes, without moving their checkpoints.
  const certifiedOccurrence = await db.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: events[0].id } });
  const occurrenceTamperCases = [
    { label: 'date', migrate: () => runPdvSessionMigration({ db, companyId: company.id, pointId: point.id, runId: id('occurrence-date-drift-session') }), update: { data: new Date('2026-11-06T00:00:00.000Z') }, restore: { data: certifiedOccurrence.data } },
    { label: 'agenda', migrate: () => runPdvFinanceMigration({ db, companyId: company.id, pointId: point.id, runId: id('occurrence-agenda-drift-finance') }), update: { agendaId: weeklyAgenda.id }, restore: { agendaId: null } },
    { label: 'content', migrate: () => runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('occurrence-content-drift-commerce') }), update: { nome: 'tampered certified occurrence' }, restore: { nome: certifiedOccurrence.nome } },
  ];
  for (const scenario of occurrenceTamperCases) {
    await db.ocorrenciaOperacional.update({ where: { id: certifiedOccurrence.id }, data: scenario.update });
    const result = await scenario.migrate();
    assert.equal(result.status, 'BLOCKED', `downstream ${scenario.label} tampering refuses dependency: ${JSON.stringify(result)}`);
    assert.match(result.blocker?.code ?? result.code ?? '', /OCCURRENCE_|DEPENDENCY_/, `downstream ${scenario.label} has a specific occurrence blocker`);
    if (result.runId) {
      const blockedRun = await db.pdvMigrationRun.findUnique({ where: { id: result.runId } });
      assert.equal(blockedRun?.checkpoint?.completedSourceKeys?.length ?? 0, 0, `downstream ${scenario.label} does not advance checkpoint or create a run before dependency validation`);
    }
    await db.ocorrenciaOperacional.update({ where: { id: certifiedOccurrence.id }, data: scenario.restore });
  }

  const stockTamper = await db.inventoryBalance.update({ where: { id: balance.id }, data: { quantidade: '3.126' } });
  assert.equal(stockTamper.quantidade.toString(), '3.126');
  const invalidated = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId });
  assert.equal(invalidated.status, 'BLOCKED');
  const invalidRun = await db.pdvMigrationRun.findUniqueOrThrow({ where: { id: commerceRunId } });
  assert.equal(invalidRun.status, 'BLOCKED');
  assert.equal((await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantidade.toString(), '3.126', 'divergence blocks without automatic repair');

  await proveAuthenticatedCashApi({ db, primaryCompany: raceCompany, primaryPoint: racePoint, menuA: authMenuA, menuB: authMenuB, product: raceProduct, secondCompany: company, secondPoint: point, secondMenu: menuA, secondProduct: product, runId });

  const alternatePoint = await db.pontoVenda.create({ data: { id: id('alternate-point'), cervejariaId: company.id, nome: 'QA alternate' } });
  await assert.rejects(db.comanda.create({ data: { id: id('cross-point-occurrence'), origem: 'EVENTO', eventoId: events[0].id, pontoVendaId: alternatePoint.id, ocorrenciaId: events[0].id, total: '1.00' } }), (error) => error?.code === 'P2003', 'occurrence and command PDV mismatch is rejected by the composite FK');
  const wrongPointCommand = await db.comanda.create({ data: { id: id('wrong-point-command'), origem: 'CAIXA', pontoVendaId: alternatePoint.id, status: 'ABERTA', total: '1.00' } });
  const blockedWrongPoint = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: id('wrong-point-run') });
  assert.deepEqual([blockedWrongPoint.status, blockedWrongPoint.code], ['BLOCKED', 'OCCURRENCE_MULTIPLE_CANONICAL_PDVS'], 'adding a second canonical PDV invalidates upstream occurrence certification before downstream commerce mapping');
  assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: wrongPointCommand.id } })).pontoVendaId, alternatePoint.id, 'incompatible historical link is preserved');

  // Prove that the legacy close path works with both the old database column
  // set and a Prisma Client generated from the pre-column model.
  const preColumnSchemaPath = path.join(tempRoot, 'pre-session-context-schema.prisma');
  const preColumnGenerateSchemaPath = path.join(tempRoot, 'generate-pre-session-context-schema.prisma');
  const preColumnClientDir = path.join(backendRoot, 'node_modules', '.prisma', `pdv-pre-session-context-${runId}`);
  let preColumnSchemaText = candidateSchema.toString('utf8')
    .replace(/^\s*sessaoCaixaRealizacaoId\s+String\?\s*\r?\n/m, '')
    .replace(/^\s*sessaoCaixaRealizacao\s+SessaoCaixaOperacao\?.*\r?\n/m, '')
    .replace(/^\s*prepararEmPedidoSeparado\s+Boolean\s+@default\(false\)\s*\r?\n/m, '')
    .replace(/^\s*vendasRealizadas\s+Comanda\[\]\s*\r?\n/m, '');
  assert(!preColumnSchemaText.includes('sessaoCaixaRealizacaoId') && !preColumnSchemaText.includes('prepararEmPedidoSeparado'), 'old client schema omits new realization-session and independent-kitchen columns');
  await writeFile(preColumnSchemaPath, preColumnSchemaText);
  preColumnSchemaText = preColumnSchemaText.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${preColumnClientDir.replaceAll('\\', '/')}"`);
  await writeFile(preColumnGenerateSchemaPath, preColumnSchemaText);
  runPrisma(['validate', '--schema', preColumnGenerateSchemaPath]);
  runPrisma(['generate', '--schema', preColumnGenerateSchemaPath]);

  const legacyCloseCompany = await db.cervejaria.create({ data: { nome: `Legacy close schema ${runId}`, slug: `legacy-close-schema-${runId}` } });
  const { hashPassword: hashLegacyClosePassword } = await import('../src/lib/utils.ts');
  const legacyCloseOwner = await db.usuario.create({ data: { id: id('legacy-close-owner'), nome: 'Legacy close owner', email: `legacy-close-owner-${runId}@example.invalid`, senhaHash: await hashLegacyClosePassword(`Qa-legacy-close-${runId}-only!`), papel: 'DONO', cervejariaId: legacyCloseCompany.id } });
  const legacyClosePoint = await db.pontoVenda.create({ data: { cervejariaId: legacyCloseCompany.id, nome: 'Legacy close PDV' } });
  const legacyCloseProduct = await db.produto.create({ data: { id: id('legacy-close-product'), cervejariaId: legacyCloseCompany.id, nome: 'Legacy close product', tipo: 'COMIDA', controlaEstoque: false } });
  const legacyCloseSession = await db.sessaoCaixaOperacao.create({ data: {
    cervejariaId: legacyCloseCompany.id, pontoVendaId: legacyClosePoint.id, diaOperacional: new Date('2026-11-20T00:00:00.000Z'),
    trocoInicial: '0.00', abertoPorId: legacyCloseOwner.id,
  } });
  const legacyCloseCommand = await db.comanda.create({ data: {
    origem: 'CAIXA', pontoVendaId: legacyClosePoint.id, tipo: 'AVULSA', status: 'ABERTA', total: '10.00', abertaPorId: legacyCloseOwner.id,
  } });
  const legacyApiPoint = await db.pontoVenda.create({ data: { cervejariaId: legacyCloseCompany.id, nome: 'Legacy API compatibility PDV' } });
  const legacyApiProducts = await Promise.all(['one', 'two'].map((suffix) => db.produto.create({ data: {
    id: id(`legacy-api-product-${suffix}`), cervejariaId: legacyCloseCompany.id, pontoVendaId: legacyApiPoint.id,
    nome: `Legacy API ${suffix}`, categoria: 'Porções', tipo: 'COMIDA', exigePreparo: true, controlaEstoque: false,
  } })));
  await db.preco.createMany({ data: legacyApiProducts.map((legacyProduct, index) => ({ id: id(`legacy-api-price-${index}`), produtoId: legacyProduct.id, volumeMl: 1, preco: '10.00' })) });
  await db.configuracaoOperacao.create({ data: { cervejariaId: legacyCloseCompany.id, ativo: true, controlaEstoque: false, temCozinha: true, exclusivo: false, quantidadeMesas: 0 } });
  await db.configuracaoOperacional.create({ data: { cervejariaId: legacyCloseCompany.id, inventoryEnabled: false, kitchenEnabled: true, kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: false } });
  const { diaOperacional: legacyApiDay } = await import('../src/lib/operacao/venda.ts');
  const legacyApiSession = await db.sessaoCaixaOperacao.create({ data: {
    cervejariaId: legacyCloseCompany.id, pontoVendaId: legacyApiPoint.id, diaOperacional: legacyApiDay(), trocoInicial: '0.00', abertoPorId: legacyCloseOwner.id,
  } });
  await db.$executeRawUnsafe('ALTER TABLE public."Comanda" DROP CONSTRAINT IF EXISTS "Comanda_pontoVendaId_sessaoCaixaRealizacaoId_fkey"');
  await db.$executeRawUnsafe('ALTER TABLE public."Comanda" DROP CONSTRAINT IF EXISTS "Comanda_sessaoRealizacao_requer_ponto_check"');
  await db.$executeRawUnsafe('DROP INDEX IF EXISTS public."Comanda_sessaoCaixaRealizacaoId_idx"');
  await db.$executeRawUnsafe('ALTER TABLE public."Comanda" DROP COLUMN "sessaoCaixaRealizacaoId"');
  await db.$executeRawUnsafe('ALTER TABLE public."Produto" DROP COLUMN "prepararEmPedidoSeparado"');
  const { Prisma: PreColumnPrisma, PrismaClient: PreColumnPrismaClient } = await import(pathToFileURL(path.join(preColumnClientDir, 'index.js')).href);
  const preColumnClient = new PreColumnPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const oldComandaModel = PreColumnPrisma.dmmf.datamodel.models.find((model) => model.name === 'Comanda');
  assert(oldComandaModel && !oldComandaModel.fields.some((field) => field.name === 'sessaoCaixaRealizacaoId'), 'generated Prisma Client predates the new realization-session column');
  const oldProductModel = PreColumnPrisma.dmmf.datamodel.models.find((model) => model.name === 'Produto');
  assert(oldProductModel && !oldProductModel.fields.some((field) => field.name === 'prepararEmPedidoSeparado'), 'generated Prisma Client predates the independent-kitchen column');
  const previousPdvFlag = process.env.PDV_CANONICAL_CONFIG_QA;
  delete process.env.PDV_CANONICAL_CONFIG_QA;
  try {
    const { fecharComandaComPagamentos } = await import('../src/lib/fechar-comanda.ts');
    const closed = await preColumnClient.$transaction((tx) => fecharComandaComPagamentos(tx, {
      comanda: { id: legacyCloseCommand.id, total: 10, tipo: 'AVULSA', origem: 'CAIXA', itens: [] },
      pagamentos: [{ forma: 'PIX', valor: 10 }], cervejariaId: legacyCloseCompany.id, usuarioId: legacyCloseOwner.id,
      fechadaEm: new Date('2026-11-20T15:00:00.000Z'), origem: 'CAIXA', sessaoCaixaId: legacyCloseSession.id,
    }));
    assert.equal(closed.status, 'FECHADA', 'legacy close succeeds with database column and generated client both predating the field');
    const { resolverItens } = await import('../src/lib/operacao/venda.ts');
    const legacyResolved = await preColumnClient.$transaction((tx) => resolverItens(tx, legacyCloseCompany.id, [{ produtoId: legacyCloseProduct.id, quantidade: 1 }]));
    assert.equal(legacyResolved[0]?.prepararEmPedidoSeparado, false, 'legacy resolver completes without selecting the absent independent-kitchen column');
    assert.equal((await preColumnClient.pagamento.findFirstOrThrow({ where: { comandaId: legacyCloseCommand.id } })).sessaoCaixaId, legacyCloseSession.id, 'legacy payment still records its cash session');
    assert.equal(await db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Comanda' AND column_name='sessaoCaixaRealizacaoId'`.then((rows) => rows.length), 0, 'legacy database has no realization-session column during close');
    const legacyApiPassword = `Qa-legacy-api-${runId}-only!`;
    await db.usuario.update({ where: { id: legacyCloseOwner.id }, data: { senhaHash: await hashLegacyClosePassword(legacyApiPassword) } });
    const apiChildEnv = {
      ...process.env,
      PDV_CANONICAL_CONFIG_QA: '',
      PDV_PRECOLUMN_API_FIXTURE: JSON.stringify({
        email: legacyCloseOwner.email, password: legacyApiPassword, companyId: legacyCloseCompany.id,
        pointId: legacyApiPoint.id, sessionId: legacyApiSession.id, productIds: legacyApiProducts.map((row) => row.id),
      }),
    };
    const apiChild = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pdv76-precolumn-api.isolated.test.mjs'], { cwd: backendRoot, env: apiChildEnv, encoding: 'utf8', windowsHide: true, timeout: 90000 });
    assert.equal(apiChild.status, 0, `real application singleton/authenticated Fastify.inject legacy-schema API proof passes: ${apiChild.stderr || apiChild.stdout}`);
    assert.match(apiChild.stdout, /PDV76_PRECOLUMN_API=PASS/);
    assert.equal(await db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Produto' AND column_name='prepararEmPedidoSeparado'`.then((rows) => rows.length), 0, 'legacy API ran while independent-kitchen column was absent');
  } finally {
    if (previousPdvFlag === undefined) delete process.env.PDV_CANONICAL_CONFIG_QA;
    else process.env.PDV_CANONICAL_CONFIG_QA = previousPdvFlag;
    await preColumnClient.$disconnect();
  }

  console.log(`PDV_COMMERCE_QA=PASS; migrations=${applied.length}; coverage=commands:4/items:2/sold-optionals:1/kitchen-orders:2/history:6/balances:1/movements:1/unattached:1; mapped=${completed.checkpoint.totalRecords}; rollback=atomic+mid-batch-divergence; parent-link-tamper=3-specific-blockers; same-db-scopes=business,catalog,sessions,finance,commerce; reexecution=same,new; concurrent-tenant-auth-cash-flows=2; canonical-blockers=3-specific-codes; provision=one-pdv+config/retry+concurrency+rollback; legacy-close=pre-column-schema-and-client; stock-tamper=BLOCKED; PROD_ACCESS_USED=NO`);
} finally {
  await consumerPrisma?.$disconnect();
  await db?.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
