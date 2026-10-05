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
  const [ownerHash, attendantHash, secondOwnerHash] = await Promise.all([
    hashPassword(ownerPassword), hashPassword(attendantPassword), hashPassword(secondOwnerPassword),
  ]);
  const blockerPasswords = ['no-point', 'no-config', 'multiple-points'].map((name) => `Qa-${name}-${runId}-only!`);
  const blockerHashes = await Promise.all(blockerPasswords.map(hashPassword));
  const authOwner = await db.usuario.create({ data: { id: `auth-owner-${runId}`, nome: 'Synthetic authenticated owner', email: `auth-owner-${runId}@example.invalid`, senhaHash: ownerHash, papel: 'DONO', cervejariaId: primaryCompany.id } });
  const authAttendant = await db.usuario.create({ data: { id: `auth-attendant-${runId}`, nome: 'Synthetic authenticated attendant', email: `auth-attendant-${runId}@example.invalid`, senhaHash: attendantHash, papel: 'ATENDENTE', cervejariaId: primaryCompany.id } });
  const secondOwner = await db.usuario.create({ data: { id: `auth-second-owner-${runId}`, nome: 'Synthetic second-tenant owner', email: `auth-second-owner-${runId}@example.invalid`, senhaHash: secondOwnerHash, papel: 'DONO', cervejariaId: secondCompany.id } });
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
    const [points, pointConfigs, sessions, commands, items, payments] = await Promise.all([
      db.pontoVenda.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.configuracaoPontoVenda.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.sessaoCaixaOperacao.count({ where: { cervejariaId: { in: tenantIds } } }),
      db.comanda.count({ where: commandTenantFilter }),
      db.itemComanda.count({ where: { comanda: commandTenantFilter } }),
      db.pagamento.count({ where: { comanda: commandTenantFilter } }),
    ]);
    return { points, pointConfigs, sessions, commands, items, payments };
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
      const opened = await app.inject({ method: 'POST', url: '/api/operacao/caixa/abrir', headers: { cookie: flow.cookie }, payload: { pontoVendaId: flow.point.id, trocoInicial: 5, cardapioId: flow.menu.id } });
      assert.equal(opened.statusCode, 201, `authenticated cash opens for ${flow.company.id}: ${opened.body}`);
      const openedBody = JSON.parse(opened.body);
      assert.deepEqual([openedBody.pontoVendaId, openedBody.status], [flow.point.id, 'ABERTO']);
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
      assert.deepEqual(paidCommand.pagamentos.map((payment) => [payment.forma, centsExact(payment.valor), payment.sessaoCaixaId, payment.sessaoCaixaEventoId, payment.registradoPorId]), [['PIX', totalCents, session.id, null, flow.owner.id]]);

      const closed = await app.inject({ method: 'POST', url: '/api/operacao/caixa/fechar', headers: { cookie: flow.cookie }, payload: { pontoVendaId: flow.point.id, contadoDinheiro: 5, contadoPix: total, contadoCartaoDebito: 0, contadoCartaoCredito: 0 } });
      assert.equal(closed.statusCode, 200, `cash close succeeds for ${flow.company.id}: ${closed.body}`);
      const persistedSession = await db.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: session.id } });
      assert.deepEqual([persistedSession.status, persistedSession.fechadoPorId, centsExact(persistedSession.trocoInicial), centsExact(persistedSession.contadoDinheiro), centsExact(persistedSession.contadoPix), centsExact(persistedSession.contadoCartaoDebito), centsExact(persistedSession.contadoCartaoCredito)], ['FECHADO', flow.owner.id, '500', '500', totalCents, '0', '0']);
      assert.equal(await db.itemComandaOpcional.count({ where: { itemComanda: { comandaId: commandId } } }), 0);
      operationFlows.push({ tenantId: flow.company.id, sessionId: session.id, commandId, productId: flow.product.id, menuId: flow.menu.id, itemPriceCents: flow.priceCents, quantity: 2, totalCents, payment: `PIX:${totalCents}`, sessionStatus: persistedSession.status, endpoints: [opened.statusCode, menuResponse.statusCode, openedCommand.statusCode, launched.statusCode, paid.statusCode, closed.statusCode] });
    }
    const summary = {
      login: [200, 200, 200], missingCredential: missing.statusCode, invalidToken: invalid.statusCode,
      attendantOwnerOnly: attendantOwnerOnly.statusCode, crossTenantRead: foreignRead.statusCode, crossTenantWrite: foreignWrite.statusCode,
      canonicalBlockers: blockerFixtures.map(({ name, expectedCode }) => ({ name, code: expectedCode, status: 409 })),
      operationFlows,
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
      }
    }
  }
}
async function proveLegacyOrderContextPreflight(args) {
  const { history, core, catalog, finance, sessionSql, tempRoot, manifest, commerceSql, runPrisma, sha256, repoRoot, backendRoot, generatedClientDir, databaseUrl, runId } = args;
  const container = process.env.PDV_QA_CONTAINER;
  assert.match(container ?? '', /^codex-pdv-commerce-qa-[a-f0-9]+$/, 'preflight must run in the owned disposable container');
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
  for (const [name, sql] of [
    [core.migrationName, coreSql],
    [catalog.delivery.migrationName, catalogSql],
    [manifest.priorManifests.session.name, sessionSql],
    [finance.delivery.migrationName, financeSql],
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
    const paused = await runPdvKitchenOrderContextPreparation({ db: legacyDb, companyId: company.id, pointId: point.id, runId: preparationRunId, maxBatches: 1 });
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
    const migratedDb = new MigratedPrismaClient({ datasources: { db: { url: preflightUrl } }, errorFormat: 'minimal' });
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
      assert.equal((await runPdvCommerceMigration({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: eventCommerceRunId })).status, 'COMPLETED');
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
      await migratedDb.comanda.update({ where: { id: legacyLinkedEventCommand.id }, data: { pontoVendaId: null } });
      const missingLegacyMapAndLink = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-legacy-map-and-link-missing-${runId}` });
      assert.deepEqual([missingLegacyMapAndLink.status, missingLegacyMapAndLink.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_MAP_MISSING'], 'clearing the migrated link together with its map is still detected from durable commerce evidence');
      assert.equal((await migratedDb.comanda.findUniqueOrThrow({ where: { id: legacyLinkedEventCommand.id } })).pontoVendaId, null, 'blocked revalidation does not repair a cleared destination link');
      await migratedDb.comanda.update({ where: { id: legacyLinkedEventCommand.id }, data: { pontoVendaId: eventPoint.id } });
      await migratedDb.pdvMigrationMap.create({ data: { ...legacyCommandMap } });
      const eventCommandMap = await migratedDb.pdvMigrationMap.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'COMANDA', sourceId: eventCommand.id } } });
      const commandPointBeforeTamper = (await migratedDb.comanda.findUniqueOrThrow({ where: { id: eventCommand.id } })).pontoVendaId;
      await migratedDb.comanda.update({ where: { id: eventCommand.id }, data: { pontoVendaId: null } });
      const destinationTamper = await runPdvKitchenOrderContextPreparation({ db: migratedDb, companyId: eventCompany.id, pointId: eventPoint.id, runId: `preflight-event-destination-tamper-${runId}` });
      assert.deepEqual([destinationTamper.status, destinationTamper.code], ['BLOCKED', 'KITCHEN_ORDER_COMMERCE_DESTINATION_DIVERGED']);
      assert.equal((await migratedDb.comanda.findUniqueOrThrow({ where: { id: eventCommand.id } })).pontoVendaId, null, 'preparation does not repair divergent commercial link');
      await migratedDb.comanda.update({ where: { id: eventCommand.id }, data: { pontoVendaId: commandPointBeforeTamper } });
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
      assert.equal((await migratedDb.comanda.findUniqueOrThrow({ where: { id: legacyLinkedEventCommand.id } })).pontoVendaId, eventPoint.id, 'ambiguity does not rewrite the existing source link');
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
    [manifest.delivery.migrationName, commerceSql],
  ];
  assert.equal(sha256(candidates[0][1]), core.migrationSha256, 'pinned core SQL');
  assert.equal(sha256(candidates[1][1]), catalog.delivery.migrationSha256, 'pinned catalog SQL');
  assert.equal(sha256(candidates[2][1]), manifest.priorManifests.session.sha256, 'pinned session SQL');
  assert.equal(sha256(candidates[3][1]), finance.delivery.migrationSha256, 'pinned finance SQL');
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
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
  const applied = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  assert.equal(applied.length, history.migrations.length + 5, 'full historical + operational core/catalog/session/finance + commerce chain');
  const constraints = await db.$queryRaw`SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conname IN ('Comanda_pontoVendaId_ocorrenciaId_fkey','EstoqueSaldoQuiosque_pontoVendaId_cervejariaId_fkey','EstoqueSaldoQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pontoVendaId_cervejariaId_fkey','MovimentoEstoqueQuiosque_produtoId_cervejariaId_fkey','MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey') ORDER BY conname`;
  assert.equal(constraints.length, 6);
  assert(constraints.every((row) => row.confdeltype === 'r' && row.convalidated), 'tenant/context/history constraints are validated and restrictive');

  const { runPdvBusinessMigration } = await import('./pdv-unico-business-migrator.ts');
  const { runPdvCatalogMigration, runPdvSessionMigration, runPdvFinanceMigration, runPdvCommerceMigration } = await import('./pdv-unico-catalog-migrator.ts');
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
  const tap = await db.tap.create({ data: { id: id('price-consumer-tap'), numero: 91, nome: 'QA price consumer', cervejariaId: company.id, trailerId: trailer.id } });
  await db.tapMontagem.createMany({ data: [eventSession.id, debtEventSession.id, cashSession.id, overrideSession.id, catalogFallbackSession.id].map((sessaoCaixaId, index) => ({ id: id(`price-mount-${index}`), tapId: tap.id, produtoId: draftProduct.id, sessaoCaixaId })) });
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
  const paused = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: commerceRunId, maxBatches: 1 });
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
  const beforeDrift = await runPdvCommerceMigration({ db, companyId: company.id, pointId: point.id, runId: midBatchRunId, maxBatches: completed.checkpoint.totalRecords - 1 });
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
  const first = runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId, afterDestinationWrite: async (row) => { if (row.type === 'COMANDA') { arrive(); await gate; } } });
  await arrived;
  const second = runPdvCommerceMigration({ db, companyId: raceCompany.id, pointId: racePoint.id, runId: raceRunId });
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

  console.log(`PDV_COMMERCE_QA=PASS; migrations=${applied.length}; coverage=commands:4/items:2/sold-optionals:1/kitchen-orders:2/history:6/balances:1/movements:1/unattached:1; mapped=${completed.checkpoint.totalRecords}; rollback=atomic+mid-batch-divergence; parent-link-tamper=3-specific-blockers; same-db-scopes=business,catalog,sessions,finance,commerce; reexecution=same,new; concurrent-tenant-auth-cash-flows=2; canonical-blockers=3-specific-codes; stock-tamper=BLOCKED; PROD_ACCESS_USED=NO`);
} finally {
  await consumerPrisma?.$disconnect();
  await db?.$disconnect();
  await rm(tempRoot, { recursive: true, force: true });
}
