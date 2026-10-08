import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { DEV_PDV_TENANT_ALLOWLIST, assertTenantActivationReady } from './pdv-unico-dev-cutover-core.mjs';

const url = validateIsolatedQaEnvironment(process.env).toString();
assert.equal(process.env.DATABASE_URL, url);
assert.equal(process.env.NODE_ENV, 'development', 'exercise activation without NODE_ENV=test');
assert.equal(process.env.PDV_CANONICAL_TENANTS, DEV_PDV_TENANT_ALLOWLIST.map(t => t.id).join(','));
const { PrismaClient } = await import(pathToFileURL(path.join(process.env.PDV_QA_PRISMA_CLIENT, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url } }, errorFormat: 'minimal' });
const runId = `qa-operation-${randomBytes(8).toString('hex')}`;
const photo = JSON.parse(await readFile(process.env.PDV_REPRESENTATIVE_PHOTO_FILE, 'utf8'));
const historicalIds = photo.tableRows.find(t => t.model === 'Pagamento').rows.map(r => r.id).sort();
assert.equal(historicalIds.length, 605);
const plain = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const historical = () => db.pagamento.findMany({ where: { id: { in: historicalIds } }, orderBy: { id: 'asc' } }).then(plain);
const historyBefore = await historical();
process.env.QA_MODE = '1';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { buildApp, setupSocketIO } = await import('../src/app.ts');
const { prisma } = await import('../src/lib/prisma.ts');
const app = await buildApp();
const io = setupSocketIO(app, createServer());
const results = [];
const credentials = [];
const createdIds = [];
let finalEvidence;
async function user(tenantId, role) {
  const password = randomBytes(24).toString('base64url');
  const row = await db.usuario.create({ data: { id: `${runId}-${role}-${tenantId}`, cervejariaId: tenantId, nome: `QA ${role}`, email: `${runId}-${role}-${tenantId}@example.invalid`, senhaHash: await bcrypt.hash(password, 10), papel: role, permissoesOperacao: [] } });
  credentials.push(row.id);
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: row.email, senha: password } });
  assert.equal(response.statusCode, 200, 'real QA login');
  const header = response.headers['set-cookie'];
  return { row, password, cookie: (Array.isArray(header) ? header[0] : header).split(';')[0] };
}
async function request(cookie, method, route, payload, expected = 200) {
  const response = await app.inject({ method, url: route, ...(cookie ? { headers: { cookie } } : {}), ...(payload === undefined ? {} : { payload }) });
  assert.equal(response.statusCode, expected, `${method} ${route}: ${response.body.slice(0, 1200)}`);
  return response.json();
}
async function settle(cookie, commandId) {
  const orders = await db.pedidoOperacao.findMany({ where: { comandaId: commandId }, include: { itensComanda: true } });
  for (const order of orders.filter(r => r.status === 'RECEBIDO' && r.itensComanda.some(item => item.exigePreparo))) for (const status of ['EM_PREPARO', 'PRONTO', 'ENTREGUE']) await request(cookie, 'PATCH', `/api/operacao/cozinha/${order.id}/status`, { status });
  const row = await request(cookie, 'GET', `/api/operacao/comandas/${commandId}`);
  if (Number(row.total) > 0) await request(cookie, 'POST', `/api/operacao/comandas/${commandId}/pagamentos`, { pagamentos: [{ forma: 'PIX', valor: Number(row.total) }] });
  assert.equal((await db.comanda.findUniqueOrThrow({ where: { id: commandId } })).status, 'FECHADA');
  return Number(row.total);
}
try {
  const baseline = JSON.parse(await readFile(process.env.PDV_SENTINEL_BASELINE, 'utf8'));
  for (const table of baseline) {
    const delegate = table.model[0].toLowerCase() + table.model.slice(1);
    assert.deepEqual(plain(await db[delegate].findMany({ where: table.where, select: Object.fromEntries(table.fields.map(f => [f, true])) })), table.rows, 'unselected data preserved across schema and transformations');
  }
  const unlisted = process.env.PDV_UNLISTED_QA_TENANT;
  assert.equal(await db.categoriaProdutoPdv.count({ where: { cervejariaId: unlisted } }), 0, 'categories excluded from transformation');
  assert.equal(await db.configuracaoPontoVenda.count({ where: { cervejariaId: unlisted } }), 0, 'no unselected activation/configuration');
  const unlistedOwner = await user(unlisted, 'DONO');
  const legacy = await request(unlistedOwner.cookie, 'GET', '/api/cervejaria/configuracao-operacional');
  assert.equal(legacy.configuration.plannedOperationsEnabled, true, 'unselected tenant retains EVENTO mode');
  assert.equal(legacy.enablements.cashMode, false);
  assert.ok(!JSON.stringify(legacy).includes('CANONICAL_PDV'), 'unselected tenant retains legacy source');
  const legacyContext = await request(unlistedOwner.cookie, 'GET', '/api/operacao/contexto');
  assert.ok(JSON.stringify(legacyContext).includes('LEGACY'));
  assert.ok(!JSON.stringify(legacyContext).includes('CANONICAL_PDV'));
  await request(unlistedOwner.cookie, 'GET', '/api/operacao/produtos');
  if (process.env.PDV_SENTINEL_CREDENTIAL_FILE) {
    const account = JSON.parse(await readFile(process.env.PDV_SENTINEL_CREDENTIAL_FILE, 'utf8'));
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account.email, senha: account.password } });
    assert.equal(login.statusCode, 200, 'existing unselected attendant login');
    const header = login.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header[0] : header).split(';')[0];
    const staffContext = await request(cookie, 'GET', '/api/operacao/contexto');
    assert.ok(JSON.stringify(staffContext).includes('LEGACY'));
    await request(cookie, 'GET', '/api/operacao/produtos', undefined, 403);
    assert.equal(await db.pontoVenda.count({ where: { cervejariaId: unlisted } }), 2);
    assert.equal(await db.trailer.count({ where: { cervejariaId: unlisted } }), 2);
  }
  for (const tenant of DEV_PDV_TENANT_ALLOWLIST) {
    process.env.PDV_CANONICAL_TENANTS = tenant.id;
    const { readCanonicalPdvOperationalSettingsIfEnabled } = await import('../src/lib/canonical-pdv-operational-config.ts');
    const otherTenant = DEV_PDV_TENANT_ALLOWLIST.find(t => t.id !== tenant.id);
    assert.equal(await readCanonicalPdvOperationalSettingsIfEnabled(otherTenant.id), null, 'isolated activation leaves the other representative tenant on legacy');
    const started = performance.now();
    const company = await db.cervejaria.findUniqueOrThrow({ where: { id: tenant.id } });
    const point = await db.pontoVenda.findFirstOrThrow({ where: { cervejariaId: tenant.id } });
    const config = await db.configuracaoPontoVenda.findUniqueOrThrow({ where: { pontoVendaId: point.id } });
    const owner = await user(tenant.id, 'DONO');
    const staff = await user(tenant.id, 'ATENDENTE');
    const unlinkedProducts = await db.produto.count({ where: { cervejariaId: tenant.id, categoria: { not: null }, categoriaPdvId: null } });
    assertTenantActivationReady({ tenantId: tenant.id, pointIds: [point.id], configuration: config, permissionReadiness: { status: 'PASS', ownerExclusiveGrantCount: 0 }, categoryReadiness: { status: 'PASS', unlinkedProducts } });
    const profile = await request(owner.cookie, 'GET', '/api/operacao/contexto');
    assert.ok(JSON.stringify(profile).includes('CANONICAL_PDV'), 'selected tenant uses its canonical contract');
    // Historical open sessions and commands are preserved: use a future operational date.
    const date = new Date(); date.setUTCDate(date.getUTCDate() + Number(process.env.PDV_OPERATION_DAY_OFFSET ?? 30));
    const day = date.toISOString().slice(0, 10);
    const originalDate = Date;
    globalThis.Date = class extends originalDate { constructor(...args) { super(...(args.length ? args : [`${day}T18:00:00.000Z`])); } static now() { return new originalDate(`${day}T18:00:00.000Z`).getTime(); } };
    try {
      for (const account of [owner, staff]) {
        const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account.row.email, senha: account.password } });
        assert.equal(login.statusCode, 200, 'real login at QA operational date');
        const cookie = login.headers['set-cookie'];
        account.cookie = (Array.isArray(cookie) ? cookie[0] : cookie).split(';')[0];
      }
      const menus = await db.cardapio.findMany({ where: { cervejariaId: tenant.id, pontoVendaId: point.id, ativo: true }, include: { produtos: { include: { produto: true } } } });
      const menu = menus.find(m => m.produtos.some(p => p.volumeMl === 0 && p.produto.ativo && !p.produto.exigePreparo && Number(p.precoUnit) > 0));
      assert.ok(menu, 'original migrated menu has an active unit product');
      const selected = menu.produtos.find(p => p.volumeMl === 0 && p.produto.ativo && !p.produto.exigePreparo && Number(p.precoUnit) > 0 && !p.produto.controlaEstoque) ?? menu.produtos.find(p => p.volumeMl === 0 && p.produto.ativo && !p.produto.exigePreparo && Number(p.precoUnit) > 0);
      const product = selected.produto;
      const price = Number(selected.precoUnit);
      const occurrence = await db.ocorrenciaOperacional.create({ data: { id: `${runId}-${tenant.id}-occurrence`, cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'QA operational occurrence', data: new originalDate(`${day}T00:00:00Z`), status: 'PROGRAMADA' } });
      createdIds.push(occurrence.id);
      const sessionIds = [];
      let independent = 'DISABLED_EXPECTED_REFUSAL';
      let refund = 'DISABLED_EXPECTED_REFUSAL';
      let volume = 'DISABLED_EXPECTED_REFUSAL';
      let originalKitchen = 'DISABLED_EXPECTED_REFUSAL';
      for (const withOccurrence of [false, true]) {
        const session = await request(owner.cookie, 'POST', '/api/operacao/caixa/abrir', { pontoVendaId: point.id, trocoInicial: 0, cardapioId: menu.id, ...(withOccurrence ? { ocorrenciaId: occurrence.id } : {}) }, 201);
        sessionIds.push(session.id);
        assert.equal(session.ocorrenciaId ?? null, withOccurrence ? occurrence.id : null);
        const menuView = await request(owner.cookie, 'GET', `/api/operacao/caixa/cardapio?pontoVendaId=${point.id}`);
        assert.equal(Number(menuView.produtos.find(p => p.id === product.id && p.volumeMl === 0).precoUnit), price);
        const stockBefore = plain(await db.inventoryBalance.findMany({ where: { cervejariaId: tenant.id }, orderBy: { id: 'asc' } }));
        const command = await request(owner.cookie, 'POST', '/api/operacao/comandas', { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `${runId}-${withOccurrence}` }, 201);
        createdIds.push(command.id);
        await request(owner.cookie, 'POST', `/api/operacao/comandas/${command.id}/pedidos`, { itens: [{ produtoId: product.id, quantidade: 1 }] }, 201);
        const saved = await db.comanda.findUniqueOrThrow({ where: { id: command.id }, include: { itens: true } });
        assert.equal(saved.ocorrenciaId ?? null, withOccurrence ? occurrence.id : null);
        assert.equal(Number(saved.itens[0].precoUnit), price);
        await settle(owner.cookie, command.id);
        let paid = price;
        const cancel = await request(owner.cookie, 'POST', '/api/operacao/comandas', { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `${runId}-cancel-${withOccurrence}` }, 201);
        createdIds.push(cancel.id);
        const stockBeforeCancel = plain(await db.inventoryBalance.findMany({ where: { cervejariaId: tenant.id }, orderBy: { id: 'asc' } }));
        await request(owner.cookie, 'POST', `/api/operacao/comandas/${cancel.id}/pedidos`, { itens: [{ produtoId: product.id, quantidade: 1 }] }, 201);
        await request(owner.cookie, 'POST', `/api/operacao/comandas/${cancel.id}/cancelar`, {});
        assert.deepEqual(plain(await db.inventoryBalance.findMany({ where: { cervejariaId: tenant.id }, orderBy: { id: 'asc' } })), stockBeforeCancel, 'cancellation conserves stock');
        if (!config.inventoryEnabled) assert.deepEqual(plain(await db.inventoryBalance.findMany({ where: { cervejariaId: tenant.id }, orderBy: { id: 'asc' } })), stockBefore, 'disabled inventory remains untouched');
        const portalBase = `/api/public/cervejarias/${company.slug}/pontos-venda/${point.id}`;
        await request(null, 'GET', `${portalBase}/cardapio`);
        const openedPortal = await app.inject({ method: 'POST', url: `${portalBase}/comandas`, payload: { nome: 'QA representative portal', telefone: `119${randomBytes(4).readUInt32BE().toString().padStart(8, '0').slice(0, 8)}` } });
        assert.equal(openedPortal.statusCode, 201, `portal open: ${openedPortal.body}`);
        const portalHeader = openedPortal.headers['set-cookie'];
        const portalCookie = (Array.isArray(portalHeader) ? portalHeader[0] : portalHeader).split(';')[0];
        const portalCommand = openedPortal.json().comanda;
        createdIds.push(portalCommand.id);
        await request(portalCookie, 'POST', `${portalBase}/comanda/pedidos`, { itens: [{ produtoId: product.id, quantidade: 1 }] }, 201);
        const portalSaved = await db.comanda.findUniqueOrThrow({ where: { id: portalCommand.id } });
        assert.equal(portalSaved.ocorrenciaId ?? null, withOccurrence ? occurrence.id : null);
        paid += await settle(owner.cookie, portalCommand.id);
        // Permission changes use the same real session cookie before and after grants.
        await request(staff.cookie, 'GET', `/api/operacao/comandas/${command.id}`, undefined, 403);
        await request(owner.cookie, 'PATCH', `/api/usuarios/${staff.row.id}/permissoes-operacao`, { permissoesOperacao: ['command.read'] });
        await request(staff.cookie, 'GET', `/api/operacao/comandas/${command.id}`);
        await request(owner.cookie, 'PATCH', `/api/usuarios/${staff.row.id}/permissoes-operacao`, { permissoesOperacao: [] });
        await request(staff.cookie, 'GET', `/api/operacao/comandas/${command.id}`, undefined, 403);
        if (config.tapsEnabled) {
          const taps = await request(owner.cookie, 'GET', `/api/operacao/caixa/taps?pontoVendaId=${point.id}`);
          const mounted = taps.taps.find(t => t.chopeAtual && menu.produtos.some(p => p.produtoId === t.chopeAtual.id && p.volumeMl > 0));
          assert.ok(mounted, 'migrated TAP/catalog has a volume sale');
          const tapPrice = menu.produtos.find(p => p.produtoId === mounted.chopeAtual.id && p.volumeMl > 0);
          const volumeCommand = await request(owner.cookie, 'POST', '/api/operacao/comandas', { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `${runId}-volume-${withOccurrence}` }, 201);
          createdIds.push(volumeCommand.id);
          await request(owner.cookie, 'POST', `/api/operacao/comandas/${volumeCommand.id}/pedidos`, { itens: [{ produtoId: mounted.chopeAtual.id, quantidade: 1, tapId: mounted.id, volumeMl: tapPrice.volumeMl }] }, 201);
          const item = await db.itemComanda.findFirstOrThrow({ where: { comandaId: volumeCommand.id } });
          assert.equal(item.volumeMl, tapPrice.volumeMl); assert.equal(Number(item.precoUnit), Number(tapPrice.precoUnit));
          paid += await settle(owner.cookie, volumeCommand.id);
          volume = 'PASS';
        } else await request(owner.cookie, 'GET', `/api/operacao/caixa/taps?pontoVendaId=${point.id}`, undefined, 404);
        if (!config.kitchenEnabled) await request(owner.cookie, 'GET', `/api/operacao/cozinha?pontoVendaId=${point.id}`, undefined, 404);
        if (config.kitchenEnabled && withOccurrence) {
          const prepared = menu.produtos.find(row => row.produto.ativo && row.produto.exigePreparo && row.volumeMl === 0);
          assert.ok(prepared, 'enabled kitchen has an original migrated menu preparation product');
          const originalCommand = await request(owner.cookie, 'POST', '/api/operacao/comandas', { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `${runId}-original-kitchen`, itens: [{ produtoId: prepared.produtoId, quantidade: 1 }] }, 201);
          createdIds.push(originalCommand.id);
          const originalItem = await db.itemComanda.findFirstOrThrow({ where: { comandaId: originalCommand.id } });
          assert.equal(Number(originalItem.precoUnit), Number(prepared.precoUnit));
          paid += await settle(owner.cookie, originalCommand.id);
          originalKitchen = 'PASS';
          // Additional marked QA lines prove independent preparation/refund without altering historical products.
          const fixture = await db.produto.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: `${runId} independent preparation`, categoria: product.categoria, categoriaPdvId: product.categoriaPdvId, formato: 'OUTRO', exigePreparo: true, prepararEmPedidoSeparado: true, controlaEstoque: true } });
          createdIds.push(fixture.id);
          await db.cardapioProduto.create({ data: { cardapioId: menu.id, produtoId: fixture.id, cervejariaId: tenant.id, pontoVendaId: point.id, volumeMl: 0, precoUnit: 1 } });
          await db.sessaoCaixaProdutoOperacao.create({ data: { sessaoCaixaId: session.id, produtoId: fixture.id, volumeMl: 0, precoUnit: 1 } });
          await request(owner.cookie, 'POST', '/api/operacao/estoque/entrada', { pontoVendaId: point.id, produtoId: fixture.id, quantidade: 20, observacao: runId }, 201);
          const independentCommand = await request(owner.cookie, 'POST', '/api/operacao/comandas', { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `${runId}-independent`, itens: [{ produtoId: fixture.id, quantidade: 1 }, { produtoId: fixture.id, quantidade: 1 }] }, 201);
          createdIds.push(independentCommand.id);
          const orders = await db.pedidoOperacao.findMany({ where: { comandaId: independentCommand.id }, include: { itensComanda: true } });
          assert.equal(orders.length, 2); assert.ok(orders.every(o => o.itensComanda.length === 1));
          paid += await settle(owner.cookie, independentCommand.id);
          independent = 'PASS_ADDITIONAL_QA_PRODUCT_IN_MIGRATED_TENANT';
          const beforeRefund = await db.inventoryBalance.findFirstOrThrow({ where: { produtoId: fixture.id } });
          const walkUp = await request(owner.cookie, 'POST', '/api/operacao/vendas', { pontoVendaId: point.id, itens: [{ produtoId: fixture.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 1 }] }, 201);
          createdIds.push(walkUp.id);
          const refundOrder = await db.pedidoOperacao.findFirstOrThrow({ where: { comandaId: walkUp.id } });
          await request(owner.cookie, 'PATCH', `/api/operacao/cozinha/${refundOrder.id}/status`, { status: 'CANCELADO' });
          assert.equal(Number((await db.inventoryBalance.findFirstOrThrow({ where: { produtoId: fixture.id } })).quantidade), Number(beforeRefund.quantidade));
          const refundPayments = await db.pagamento.findMany({ where: { comandaId: walkUp.id, sessaoCaixaId: session.id } });
          assert.equal(refundPayments.reduce((sum, p) => sum + Number(p.valor), 0), 0, 'refund conserves original payment plus negative cash receipt');
          refund = 'PASS';
        }
        await request(owner.cookie, 'POST', '/api/operacao/caixa/fechar', { pontoVendaId: point.id, contadoDinheiro: 0, contadoPix: paid, contadoCartaoDebito: 0, contadoCartaoCredito: 0 });
      }
      results.push({ tenant: tenant.name, status: 'PASS', durationMs: Math.round(performance.now() - started), flags: plain(config), openingWithAndWithoutOccurrence: 'PASS', menuAndOriginalPrice: 'PASS', commandPaymentAndCashClose: 'PASS', cancellationStock: 'PASS', portal: 'PASS', permissionsSameSession: 'PASS', originalKitchen, independentKitchen: independent, refund, tapsAndVolume: volume, sessions: sessionIds });
    } finally { globalThis.Date = originalDate; }
  }
  assert.deepEqual(await historical(), historyBefore, 'exact 605 original payments remain untouched by QA operation');
  finalEvidence = { status: 'PASS', runId, results, unlistedIsolation: { status: 'PASS', tenantId: unlisted, dataCompared: baseline.map(t => t.model), legacyMode: 'EVENTO', canonicalCategories: 0, canonicalConfigurations: 0 }, originalPayments: { count: historicalIds.length, beforeSha256: digest(historyBefore), afterSha256: digest(await historical()), status: 'PASS' }, qaOnlyUserIds: credentials, qaOnlyCreatedIds: createdIds };
} finally { await new Promise(resolve => io.close(resolve)); await app.close(); await prisma.$disconnect(); await db.$disconnect(); }
console.log(JSON.stringify(finalEvidence));
