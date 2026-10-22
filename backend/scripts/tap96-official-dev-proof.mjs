import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const root = process.argv[2];
const sha = process.argv[3];
if (!root || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Supply canonical repository root and expected DEV SHA');
const config = parseEnv(readFileSync(path.join(root, 'backend/.env.development'), 'utf8'));
const dbUrl = new URL(config.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname) && dbUrl.port === '5434' && dbUrl.pathname === '/cervejaria_dev', 'official DEV DB fence');
const api = 'http://127.0.0.1:3002';
const frontend = 'http://127.0.0.1:5202';
const prodBefore = await (await fetch('http://127.0.0.1:3001/api/health')).json();
const health = await (await fetch(`${api}/api/health`)).json();
assert.equal(health.releaseSha, sha);
assert.equal((await (await fetch(`${api}/api/ready`)).json()).status, 'ready');
assert.equal((await fetch(frontend)).status, 200);
const manifest = JSON.parse(readFileSync(path.join(root, 'deploy/dev-artifacts/manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(manifest.releaseSha, sha);
assert.ok(existsSync(path.join(root, 'deploy/dev-artifacts/backend/scripts/otel-sdk.mjs')));

const runId = `tap96-dev-${Date.now()}-${randomBytes(3).toString('hex')}`;
const out = path.resolve(import.meta.dirname, '../../artifacts/tap96', runId);
mkdirSync(out, { recursive: true });
const { PrismaClient } = await import('@prisma/client');
const { hashPassword } = await import('../src/lib/utils.ts');
const { provisionEstablishment } = await import('../src/lib/provision-establishment.ts');
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const evidence = { runId, sha, startedAt: new Date().toISOString(), health, manifest, tenants: [], requests: [], prodBefore };
const sessions = [];
async function call(session, method, route, body, expected = 200) {
  const correlationId = randomUUID();
  const response = await fetch(`${api}${route}`, { method, signal: AbortSignal.timeout(20_000), headers: {
    'Content-Type': 'application/json', 'x-correlation-id': correlationId, ...(session.cookie ? { cookie: session.cookie } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  evidence.requests.push({ tenant: session.slug, actor: session.actorId, method, route, status: response.status, correlationId, requestId: response.headers.get('x-request-id') });
  if (route === '/api/auth/login' && response.ok) session.cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert.equal(response.status, expected, `${method} ${route}`);
  return response.status === 204 ? undefined : response.json();
}
try {
  for (const suffix of ['a', 'b']) {
    const slug = `${runId}-${suffix}`;
    const password = `Qa-${randomBytes(24).toString('hex')}-!`;
    const senhaHash = await hashPassword(password);
    const email = `${slug}@example.invalid`;
    const tenant = await prisma.$transaction(tx => provisionEstablishment(tx, { nome: `TESTE TAP-96 ${suffix.toUpperCase()}`, slug,
      dono: { nome: 'Operador sintético TAP-96', email, senhaHash },
      enablements: { plannedOperations: false, taps: false, inventory: false, kitchen: true },
    }, { mode: 'CANONICAL', legacyProjection: true }));
    const session = { slug, tenantId: tenant.cervejaria.id, actorId: tenant.dono.id, pointId: tenant.pontoVenda.id, email, password };
    sessions.push(session);
    evidence.tenants.push({ slug, id: session.tenantId, actorId: session.actorId, pointId: session.pointId });
    await call(session, 'POST', '/api/auth/login', { email, senha: password });
    const probeId = randomUUID(); session.probeId = probeId;
    await call(session, 'POST', '/api/observability/dev-probe', { probeId }, 204);
    const product = await call(session, 'POST', '/api/operacao/produtos', { nome: 'Água sintética TAP-96', tipo: 'BEBIDA', formato: 'OUTRO', precoUnit: 5, controlaEstoque: false }, 201);
    const menu = await call(session, 'POST', '/api/operacao/cardapios', { nome: 'TESTE TAP-96', produtoIds: [product.id] }, 201);
    await call(session, 'POST', '/api/operacao/caixa/abrir', { pontoVendaId: session.pointId, cardapioId: menu.id, trocoInicial: 0 }, 201);
    const command = await call(session, 'POST', '/api/operacao/comandas', { pontoVendaId: session.pointId, tipo: 'APELIDO', identificador: 'TESTE TAP-96', itens: [{ produtoId: product.id, quantidade: 1 }] }, 201);
    session.comandaId = command.id;
    await call(session, 'POST', `/api/operacao/comandas/${command.id}/pagamentos`, { pagamentos: [{ forma: 'PIX', valor: 5 }] });
    assert.equal((await prisma.comanda.findUniqueOrThrow({ where: { id: command.id }, select: { status: true } })).status, 'FECHADA');
    await call(session, 'POST', '/api/audit/events', { events: [{ id: randomUUID(), type: 'page_view', page: '/operacao/comandas', timestamp: new Date(Date.now() - 120_000).toISOString(),
      session: { actorId: session.actorId, cervejariaId: session.tenantId }, meta: { frontendReleaseSha: sha, accessToken: 'tap96-synthetic-secret-canary' } }] }, 204);
  }
  await call(sessions[1], 'GET', `/api/operacao/comandas/${sessions[0].comandaId}`, undefined, 404);
  const browserExecutable = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!existsSync(browserExecutable)) throw new Error('Installed Edge is required for official frontend proof');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${frontend}/login`);
    await page.locator('#email').fill(sessions[0].email);
    await page.locator('#password').fill(sessions[0].password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL(url => !url.pathname.includes('/login'));
    await page.goto(`${frontend}/operacao/comandas`);
    await page.screenshot({ path: path.join(out, 'official-dev-frontend.png'), fullPage: true });
    evidence.frontend = { url: page.url(), title: await page.title(), screenshot: 'official-dev-frontend.png' };
  } finally { await browser.close(); }
  evidence.transactions = await prisma.transacaoLog.findMany({ where: { cervejariaId: { in: sessions.map(s => s.tenantId) } },
    select: { id: true, cervejariaId: true, usuarioId: true, tipo: true, entidadeId: true, comandaId: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  evidence.comandas = await prisma.comanda.findMany({ where: { id: { in: sessions.map(s => s.comandaId) } }, select: { id: true, status: true, total: true } });
  evidence.probes = sessions.map(s => ({ slug: s.slug, id: s.probeId }));
  for (const session of sessions) await call(session, 'POST', '/api/auth/logout', {});
  evidence.prodAfter = await (await fetch('http://127.0.0.1:3001/api/health')).json();
  assert.equal(evidence.prodAfter.releaseSha, prodBefore.releaseSha);
  evidence.finishedAt = new Date().toISOString();
  evidence.status = 'PASS';
  console.log(JSON.stringify({ runId, status: 'PASS', transactions: evidence.transactions.length, tenants: evidence.tenants, evidence: out }));
} catch (error) {
  evidence.status = 'FAIL'; evidence.failure = error.message;
  throw error;
} finally {
  writeFileSync(path.join(out, 'proof.json'), JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
}
