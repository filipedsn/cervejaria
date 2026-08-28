import { prisma } from '../src/lib/prisma.js';
import { API_BASE, api, chopeItemBody, login, parseAuthCookie, percentile, portalPedidoBody, portalSessao, portalTestPhone, staffComandaBody, uniquePortalTestPhone, uniqueStaffComandaBody } from './lib/http.js';
import { runAdminTests } from './lib/admin-tests.js';
import { runCfgTests } from './lib/cfg-tests.js';
import { assertQaEnvironment } from './lib/guard.js';
import { runAuthResetTests } from './lib/auth-reset-tests.js';
import { runCardapioTemplateTests } from './lib/cardapio-template-tests.js';
import { runCrmMergeTests } from './lib/crm-merge-tests.js';
import { runCsvTests } from './lib/csv-tests.js';
import { runEventoJanelaTests } from './lib/evento-janela-tests.js';
import { runPerfQuiosqueTests } from './lib/perf-quiosque-tests.js';
import { runPortalJwtTests } from './lib/portal-jwt-tests.js';
import { runPagamentoFormasTests } from './lib/pagamento-formas-tests.js';
import { runObsTests } from './lib/obs-tests.js';
import { runQuiosqueCaixaTests } from './lib/quiosque-caixa-tests.js';
import { runQuiosqueCardapioTests } from './lib/quiosque-cardapio-tests.js';
import { runQuiosqueComandaTests } from './lib/quiosque-comanda-tests.js';
import { runQuiosqueCozinhaTests } from './lib/quiosque-cozinha-tests.js';
import { runQuiosqueEstoqueTests } from './lib/quiosque-estoque-tests.js';
import { runQuiosqueSmokeTests } from './lib/quiosque-smoke-tests.js';
import { runRealtimeTests } from './lib/realtime-tests.js';
import { runTapMontagemTests } from './lib/tap-montagem-tests.js';
import { runTenQuiosqueTests } from './lib/ten-quiosque-tests.js';
import { runTransacaoLogTests } from './lib/transacao-log-tests.js';
import { decodeToken, jwtSecret, signToken, tamperSignature, userJwtPayload } from './lib/jwt.js';
import { CONTEXT_PATH, SUITE_PATH, readJson, writeJson } from './lib/store.js';
import type { PerfMetric, QaContext, SuiteArtifact, TestResult, TestStatus } from './lib/types.js';

const results: TestResult[] = [];
const perf: PerfMetric[] = [];

interface Outcome {
  status?: TestStatus;
  message?: string;
  details?: string;
  expected?: string;
  actual?: string;
}

async function test(
  meta: { id: string; category: string; name: string; requirement?: string },
  fn: () => Promise<Outcome>,
) {
  const start = performance.now();
  try {
    const out = await fn();
    results.push({
      ...meta,
      status: out.status ?? 'passed',
      durationMs: performance.now() - start,
      message: out.message,
      details: out.details,
      expected: out.expected,
      actual: out.actual,
    });
  } catch (err) {
    results.push({
      ...meta,
      status: 'failed',
      durationMs: performance.now() - start,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const last = results[results.length - 1];
  const icon = { passed: 'OK ', failed: 'XX ', warning: '!! ', skipped: '-- ' }[last.status];
  console.log(`  ${icon}${meta.id} ${meta.name}${last.message ? ' — ' + last.message : ''}`);
}

/** RBAC helper: 403 = ideal; 500 = blocked but wrong status (sensible ausente). */
function rbacOutcome(status: number, who: string): Outcome {
  if (status === 403) return { message: `${who} bloqueado (403)`, expected: '403', actual: '403' };
  if (status === 500) {
    return {
      status: 'failed',
      message: `${who} bloqueado, mas HTTP 500 (esperado 403)`,
      expected: '403',
      actual: '500',
      details: 'requireDono/requireAdmin usam app.httpErrors.* sem @fastify/sensible registrado.',
    };
  }
  return { status: 'failed', message: `${who} NÃO bloqueado`, expected: '403', actual: String(status) };
}

function expectStatus(actual: number, expected: number | number[], ctx: string): Outcome {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) {
    return { message: ctx, expected: list.join('/'), actual: String(actual) };
  }
  return { status: 'failed', message: ctx, expected: list.join('/'), actual: String(actual) };
}

/** Remove eventos do trailer no dia (comandas, montagem, filhos de série) para evitar 409 em RF-04. */
async function limparEventosTrailerNoDia(cervejariaId: string, trailerId: string, dataIso: string) {
  const inicio = new Date(`${dataIso}T00:00:00`);
  const fim = new Date(`${dataIso}T23:59:59.999`);
  const eventos = await prisma.evento.findMany({
    where: { cervejariaId, trailerId, data: { gte: inicio, lte: fim } },
    select: { id: true },
  });
  for (const { id } of eventos) {
    const filhos = await prisma.evento.findMany({ where: { serieId: id }, select: { id: true } });
    for (const f of filhos) {
      await prisma.comanda.deleteMany({ where: { eventoId: f.id } });
      await prisma.tapMontagem.deleteMany({ where: { eventoId: f.id } });
      await prisma.eventoProduto.deleteMany({ where: { eventoId: f.id } });
      await prisma.evento.delete({ where: { id: f.id } });
    }
    await prisma.comanda.deleteMany({ where: { eventoId: id } });
    await prisma.tapMontagem.deleteMany({ where: { eventoId: id } });
    await prisma.eventoProduto.deleteMany({ where: { eventoId: id } });
    await prisma.eventoSerieExclusao.deleteMany({ where: { serieId: id } });
    await prisma.evento.delete({ where: { id } });
  }
}

async function bench(label: string, samples: number, target: number, fn: () => Promise<number>) {
  const durations: number[] = [];
  let errors = 0;
  for (let i = 0; i < samples; i++) {
    try {
      durations.push(await fn());
    } catch {
      errors++;
    }
  }
  const metric: PerfMetric = {
    label,
    samples: durations.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: Math.max(...durations, 0),
    errors,
    target,
  };
  perf.push(metric);
  return metric;
}

async function main() {
  assertQaEnvironment({ apiBase: API_BASE });
  const runStart = performance.now();
  const ctx = readJson<QaContext>(CONTEXT_PATH);
  const A = ctx.tenants[0];
  const B = ctx.tenants[1];
  const lifecycle = ctx.tenants[2];
  const func = ctx.tenants[3];
  const cat = ctx.tenants[4];
  const mt = ctx.multiTrailer;
  const [trailerA, trailerB] = mt.trailers;

  console.log('\n=== SESSÃO / JWT ===');
  const realPayload = decodeToken(A.donoToken)?.payload ?? {};
  const secretOk = (await api('GET', '/api/eventos', { token: signToken(realPayload, { expiresInSec: 3600 }) })).status === 200;

  await test({ id: 'SESS-00', category: 'Sessão', name: 'Login emite somente cookie HttpOnly', requirement: 'TQ-SEC-01' }, async () => {
    const loginResponse = await api<Record<string, unknown>>('POST', '/api/auth/login', {
      body: { email: A.donoEmail, senha: 'qa123456' },
    });
    const setCookie = loginResponse.setCookies.join('; ');
    const cookie = parseAuthCookie(loginResponse.setCookies);
    const bodyHasJwt = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(loginResponse.raw);
    if (
      loginResponse.status !== 200 ||
      'token' in loginResponse.data ||
      bodyHasJwt ||
      !cookie ||
      !/HttpOnly/i.test(setCookie) ||
      !/SameSite=Lax/i.test(setCookie) ||
      !/Path=\//i.test(setCookie) ||
      !/Max-Age=\d+/i.test(setCookie)
    ) {
      return {
        status: 'failed',
        message: 'Contrato de login/cookie inválido',
        expected: '200 + cookie HttpOnly, sem JWT no body',
        actual: `${loginResponse.status} ${loginResponse.raw.slice(0, 160)}`,
      };
    }

    const authenticated = await api('GET', '/api/eventos', { cookie });
    const unauthenticated = await api('GET', '/api/eventos');
    const logout = await api('POST', '/api/auth/logout', { cookie });
    const logoutHeader = logout.setCookies.join('; ');
    const logoutCleared = /(?:^|,\s*)token=;/i.test(logoutHeader)
      && /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(logoutHeader);
    if (authenticated.status !== 200 || unauthenticated.status !== 401 || logout.status !== 200 || !logoutCleared) {
      return {
        status: 'failed',
        message: 'Sessão via cookie, ausência de cookie ou logout falhou',
        expected: '200 / 401 / 200 com cookie removido',
        actual: `${authenticated.status} / ${unauthenticated.status} / ${logout.status} (${logoutHeader})`,
      };
    }
    return { message: 'Cookie autentica; body não contém JWT; logout limpa cookie', expected: '200/401/200', actual: '200/401/200' };
  });

  await test({ id: 'SESS-13', category: 'Sessão', name: 'ATENDENTE autentica via cookie', requirement: 'TQ-SEC-01' }, async () => {
    const cookie = await login(A.atendenteEmails[0]!, 'qa123456');
    const r = await api('GET', '/api/eventos', { cookie });
    return expectStatus(r.status, 200, 'ATENDENTE autenticado somente por cookie');
  });

  await test({ id: 'SESS-14', category: 'Sessão', name: 'ADMIN autentica via cookie', requirement: 'TQ-SEC-01' }, async () => {
    const cookie = await login(ctx.admin.email, ctx.admin.senha);
    const r = await api('GET', '/api/admin/cervejarias', { cookie });
    return expectStatus(r.status, 200, 'ADMIN autenticado somente por cookie');
  });

  await test({ id: 'SESS-15', category: 'Sessão', name: 'Cookie do DONO mantém isolamento entre tenants', requirement: 'TQ-SEC-01' }, async () => {
    const cookie = await login(A.donoEmail, 'qa123456');
    const r = await api('GET', `/api/eventos/${B.eventoId}`, { cookie });
    return expectStatus(r.status, 404, 'Cookie de A não acessa evento de B');
  });

  await test({ id: 'SESS-01', category: 'Sessão', name: 'Sem token → 401', requirement: 'SESS-01' }, async () => {
    const r = await api('GET', '/api/eventos');
    return expectStatus(r.status, 401, 'Rota protegida exige JWT');
  });

  await test({ id: 'SESS-02', category: 'Sessão', name: 'Token malformado → 401', requirement: 'SESS-02' }, async () => {
    const r = await api('GET', '/api/eventos', { token: 'isto-nao-e-um-jwt' });
    return expectStatus(r.status, 401, 'Garbage rejeitado');
  });

  await test({ id: 'SESS-03', category: 'Sessão', name: 'Secret errado → 401', requirement: 'SESS-03' }, async () => {
    const forged = signToken(realPayload, { secret: 'secret-do-atacante-9999', expiresInSec: 3600 });
    const r = await api('GET', '/api/eventos', { token: forged });
    return expectStatus(r.status, 401, 'Assinatura com secret inválido rejeitada');
  });

  await test({ id: 'SESS-04', category: 'Sessão', name: 'Assinatura adulterada → 401', requirement: 'SESS-04' }, async () => {
    if (!secretOk) return { status: 'skipped', message: 'Secret local difere do servidor' };
    const valid = signToken(realPayload, { expiresInSec: 3600 });
    const r = await api('GET', '/api/eventos', { token: tamperSignature(valid) });
    return expectStatus(r.status, 401, 'Tampering detectado');
  });

  await test({ id: 'SESS-05', category: 'Sessão', name: 'Algoritmo none → 401', requirement: 'SESS-05' }, async () => {
    const none = signToken(realPayload, { alg: 'none', expiresInSec: 3600 });
    const r = await api('GET', '/api/eventos', { token: none });
    return expectStatus(r.status, 401, 'alg=none rejeitado (sem bypass)');
  });

  await test({ id: 'SESS-06', category: 'Sessão', name: 'Token expirado → 401', requirement: 'SESS-06' }, async () => {
    if (!secretOk) return { status: 'skipped', message: 'Secret local difere do servidor' };
    const expired = signToken({ ...realPayload, iat: undefined }, { expiresInSec: -60 });
    const r = await api('GET', '/api/eventos', { token: expired });
    return expectStatus(r.status, 401, 'Expiração respeitada quando exp presente');
  });

  await test({ id: 'SESS-07', category: 'Sessão', name: 'Token com expiração definida', requirement: 'SESS-07' }, async () => {
    const dec = decodeToken(A.donoToken);
    const hasExp = dec?.payload?.exp !== undefined;
    if (hasExp) return { message: 'JWT possui exp', expected: 'exp presente', actual: 'exp presente' };
    return {
      status: 'failed',
      message: 'JWT emitido sem exp — sessão nunca expira',
      expected: 'exp definido',
      actual: 'sem exp',
    };
  });

  await test({ id: 'SESS-08', category: 'Sessão', name: 'Header sem Bearer → 401', requirement: 'SESS-08' }, async () => {
    const r = await api('GET', '/api/eventos', { rawToken: A.donoToken });
    return expectStatus(r.status, 401, 'Esquema Bearer obrigatório');
  });

  await test({ id: 'SESS-09', category: 'Sessão', name: 'Token de usuário excluído', requirement: 'SESS-09' }, async () => {
    const seedHash = (await prisma.usuario.findFirstOrThrow({ where: { cervejariaId: A.cervejariaId } })).senhaHash;
    const tmp = await prisma.usuario.create({
      data: { nome: 'Sess09', email: `sess09-${Date.now()}@qa.test`, senhaHash: seedHash, papel: 'ATENDENTE', cervejariaId: A.cervejariaId },
    });
    const token = signToken(userJwtPayload(tmp), { expiresInSec: 3600 });
    await prisma.usuario.delete({ where: { id: tmp.id } });
    const r = await api('GET', '/api/eventos', { token });
    if (!secretOk) return { status: 'skipped', message: 'Secret local difere do servidor' };
    if (r.status === 401 || r.status === 403) return { message: 'Token de usuário excluído rejeitado', actual: String(r.status) };
    return {
      status: 'failed',
      message: 'Token de usuário excluído ainda autoriza acesso',
      expected: '401/403',
      actual: String(r.status),
    };
  });

  await test({ id: 'SESS-10', category: 'Sessão', name: 'Cervejaria desativada mid-sessão', requirement: 'SESS-10' }, async () => {
    const slug = `sess10-${Date.now()}`;
    const seedHash = (await prisma.usuario.findFirstOrThrow({ where: { cervejariaId: A.cervejariaId } })).senhaHash;
    const brew = await prisma.cervejaria.create({
      data: { nome: 'Sess10', slug, usuarios: { create: { nome: 'Dono10', email: `${slug}@qa.test`, senhaHash: seedHash, papel: 'DONO' } } },
      include: { usuarios: true },
    });
    const u = brew.usuarios[0];
    const token = signToken(userJwtPayload(u), { expiresInSec: 3600 });
    await prisma.cervejaria.update({ where: { id: brew.id }, data: { ativo: false } });
    const r = await api('GET', '/api/eventos', { token });
    // cleanup
    await prisma.usuario.deleteMany({ where: { cervejariaId: brew.id } });
    await prisma.cervejaria.delete({ where: { id: brew.id } });

    if (!secretOk) return { status: 'skipped', message: 'Secret local difere do servidor' };
    if (r.status === 403) return { message: 'Acesso bloqueado (403)', expected: '403', actual: '403' };
    if (r.status === 500) {
      return { status: 'failed', message: 'Bloqueado, mas HTTP 500 (esperado 403)', expected: '403', actual: '500', details: 'assertCervejariaAtiva deve responder 403 via @fastify/sensible.' };
    }
    return { status: 'failed', message: 'Cervejaria desativada NÃO bloqueou acesso', expected: '403', actual: String(r.status) };
  });

  await test({ id: 'SESS-11', category: 'Sessão', name: 'cervejariaId forjado (secret errado) → 401', requirement: 'SESS-11' }, async () => {
    const forged = signToken({ ...realPayload, cervejariaId: B.cervejariaId }, { secret: 'atacante', expiresInSec: 3600 });
    const r = await api('GET', `/api/comandas/evento/${B.eventoId}`, { token: forged });
    return expectStatus(r.status, 401, 'Forja cross-tenant sem secret rejeitada');
  });

  await test({ id: 'SESS-12', category: 'Sessão', name: 'Token invalidado após troca de senha', requirement: 'SESS-12' }, async () => {
    if (!secretOk) return { status: 'skipped', message: 'Secret local difere do servidor' };
    const seedHash = (await prisma.usuario.findFirstOrThrow({ where: { cervejariaId: A.cervejariaId } })).senhaHash;
    const tmp = await prisma.usuario.create({
      data: { nome: 'Sess12', email: `sess12-${Date.now()}@qa.test`, senhaHash: seedHash, papel: 'ATENDENTE', cervejariaId: A.cervejariaId },
    });
    const token = signToken(userJwtPayload(tmp), { expiresInSec: 3600 });
    await prisma.usuario.update({ where: { id: tmp.id }, data: { passwordChangedAt: new Date(Date.now() + 1000) } });
    const r = await api('GET', '/api/eventos', { token });
    await prisma.usuario.delete({ where: { id: tmp.id } });
    return expectStatus(r.status, 401, 'pwdAt desatualizado rejeitado');
  });

  console.log('\n=== REALTIME (Socket.IO) ===');
  const { io: ioClient } = await import('socket.io-client');

  await test({ id: 'RT-01', category: 'Realtime', name: 'Socket rejeita conexão sem JWT', requirement: 'RT-01' }, async () => {
    return new Promise<Outcome>((resolve) => {
      const socket = ioClient(API_BASE, {
        transports: ['websocket'],
        timeout: 5000,
        reconnection: false,
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        resolve({ status: 'failed', message: 'Timeout — conexão não rejeitada a tempo' });
      }, 8000);
      socket.on('connect', () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve({ status: 'failed', message: 'Conectou sem autenticação', expected: 'rejeitado', actual: 'conectou' });
      });
      socket.on('connect_error', () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve({ message: 'Conexão rejeitada sem credenciais' });
      });
    });
  });

  await test({ id: 'RT-02', category: 'Realtime', name: 'Socket aceita JWT válido', requirement: 'RT-02' }, async () => {
    return new Promise<Outcome>((resolve) => {
      const socket = ioClient(API_BASE, {
        transports: ['websocket'],
        timeout: 5000,
        reconnection: false,
        auth: { token: A.donoToken },
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        resolve({ status: 'failed', message: 'Timeout — conexão autenticada não estabelecida' });
      }, 8000);
      socket.on('connect', () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve({ message: 'Conexão autenticada OK' });
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        socket.disconnect();
        resolve({ status: 'failed', message: `Conexão rejeitada: ${err.message}`, expected: 'conectado', actual: 'rejeitado' });
      });
    });
  });

  await runRealtimeTests(ctx, test, (label, ms) => {
    perf.push({ label, samples: 1, p50: ms, p95: ms, p99: ms, max: ms, errors: 0, target: 1500 });
  });

  console.log('\n=== RBAC ===');
  await test({ id: 'RBAC-01', category: 'RBAC', name: 'ATENDENTE cria produto', requirement: 'RBAC-01' }, async () => {
    const r = await api('POST', '/api/produtos', { token: A.atendenteTokens[0], body: { nome: 'X', precos: [{ volumeMl: 300, preco: 5 }] } });
    return rbacOutcome(r.status, 'ATENDENTE');
  });
  await test({ id: 'RBAC-02', category: 'RBAC', name: 'ATENDENTE cria usuário', requirement: 'RBAC-02' }, async () => {
    const r = await api('POST', '/api/usuarios', { token: A.atendenteTokens[0], body: { nome: 'Novo', email: `x${Date.now()}@qa.test`, senha: '123456' } });
    return rbacOutcome(r.status, 'ATENDENTE');
  });
  await test({ id: 'RBAC-03', category: 'RBAC', name: 'ATENDENTE acessa resumo executivo', requirement: 'RBAC-03' }, async () => {
    const r = await api('GET', `/api/eventos/${A.eventoId}/resumo-executivo`, { token: A.atendenteTokens[0] });
    return rbacOutcome(r.status, 'ATENDENTE');
  });
  await test({ id: 'RBAC-04', category: 'RBAC', name: 'ATENDENTE acessa rota admin', requirement: 'RBAC-04' }, async () => {
    const r = await api('GET', '/api/admin/cervejarias', { token: A.atendenteTokens[0] });
    return rbacOutcome(r.status, 'ATENDENTE');
  });
  await test({ id: 'RBAC-05', category: 'RBAC', name: 'DONO acessa rota admin', requirement: 'RBAC-05' }, async () => {
    const r = await api('GET', '/api/admin/cervejarias', { token: A.donoToken });
    return rbacOutcome(r.status, 'DONO');
  });
  await test({ id: 'RBAC-06', category: 'RBAC', name: 'DONO cria ATENDENTE', requirement: 'RBAC-06' }, async () => {
    const r = await api('POST', '/api/usuarios', { token: cat.donoToken, body: { nome: 'Func Novo', email: `func-${Date.now()}@qa.test`, senha: '123456' } });
    return expectStatus(r.status, 201, 'DONO cria atendente');
  });

  console.log('\n=== CONFIGURAÇÕES DE EMPRESA (CFG) ===');
  await runCfgTests(ctx, test);

  console.log('\n=== MULTI-TENANT QUIOSQUE (TEN-Q) ===');
  await runTenQuiosqueTests(ctx, test);

  console.log('\n=== QUIOSQUE COZINHA / ESTOQUE (smoke) ===');
  await runQuiosqueSmokeTests(ctx, test);

  console.log('\n=== QUIOSQUE CAIXA (QCX) ===');
  await runQuiosqueCaixaTests(ctx, test);

  console.log('\n=== QUIOSQUE CARDÁPIO (QCD) ===');
  await runQuiosqueCardapioTests(ctx, test);

  console.log('\n=== QUIOSQUE COMANDAS (QCM) ===');
  await runQuiosqueComandaTests(ctx, test);

  console.log('\n=== QUIOSQUE ESTOQUE (QES) ===');
  await runQuiosqueEstoqueTests(ctx, test);

  console.log('\n=== QUIOSQUE COZINHA (QCZ) ===');
  await runQuiosqueCozinhaTests(ctx, test);

  console.log('\n=== ADMIN DA PLATAFORMA (ADM) ===');
  await runAdminTests(ctx, test);

  console.log('\n=== FORMAS DE PAGAMENTO (PAG) ===');
  await runPagamentoFormasTests(ctx, test);

  console.log('\n=== EXPORTAÇÃO CSV (CSV) ===');
  await runCsvTests(ctx, test);

  console.log('\n=== CRM CONCORRENTE (CRM-C) ===');
  await runCrmMergeTests(ctx, test);

  console.log('\n=== PORTAL JWT (PJW) ===');
  await runPortalJwtTests(ctx, test);

  console.log('\n=== JANELA DE EVENTO (EVJ) ===');
  await runEventoJanelaTests(ctx, test);

  console.log('\n=== MULTI-TENANT (IDOR) ===');
  const bTap = await prisma.tap.findFirstOrThrow({ where: { cervejariaId: B.cervejariaId } });
  const idor: Array<[string, string, string, () => Promise<number>, number[]]> = [
    ['TEN-01', 'GET /eventos/:id', 'Evento de B', async () => (await api('GET', `/api/eventos/${B.eventoId}`, { token: A.donoToken })).status, [404]],
    ['TEN-02', 'GET /eventos/:id/dashboard', 'Dashboard de B', async () => (await api('GET', `/api/eventos/${B.eventoId}/dashboard`, { token: A.donoToken })).status, [404]],
    ['TEN-03', 'GET /eventos/:id/resumo-executivo', 'Resumo de B', async () => (await api('GET', `/api/eventos/${B.eventoId}/resumo-executivo`, { token: A.donoToken })).status, [404, 403]],
    ['TEN-04', 'GET /comandas/:id', 'Comanda de B', async () => (await api('GET', `/api/comandas/${B.comandaIds[0]}`, { token: A.donoToken })).status, [404]],
    ['TEN-05', 'GET /comandas/evento/:id', 'Comandas do evento de B', async () => (await api('GET', `/api/comandas/evento/${B.eventoId}`, { token: A.donoToken })).status, [404]],
    ['TEN-06', 'POST /comandas/:id/itens', 'Adicionar item em comanda de B', async () => (await api('POST', `/api/comandas/${B.comandaIds[0]}/itens`, { token: A.donoToken, body: chopeItemBody(A.produtoId, A.tapId, 500) })).status, [404]],
    ['TEN-07', 'GET /produtos/:id', 'Produto de B', async () => (await api('GET', `/api/produtos/${B.produtoId}`, { token: A.donoToken })).status, [404]],
    ['TEN-08', 'PATCH /produtos/:id/ativo', 'Desativar produto de B', async () => (await api('PATCH', `/api/produtos/${B.produtoId}/ativo`, { token: A.donoToken, body: { ativo: false } })).status, [404]],
    ['TEN-09', 'DELETE /produtos/:id', 'Excluir produto de B', async () => (await api('DELETE', `/api/produtos/${B.produtoId}`, { token: A.donoToken })).status, [404]],
    ['TEN-10', 'PUT /taps/:id', 'Editar tap de B', async () => (await api('PUT', `/api/taps/${bTap.id}`, { token: A.donoToken, body: { nome: 'hack' } })).status, [404]],
    ['TEN-11', 'DELETE /taps/:id', 'Excluir tap de B', async () => (await api('DELETE', `/api/taps/${bTap.id}`, { token: A.donoToken })).status, [404]],
    ['TEN-12', 'GET /ranking/evento/:id', 'Ranking de B', async () => (await api('GET', `/api/ranking/evento/${B.eventoId}`, { token: A.donoToken })).status, [404]],
    ['TEN-13', 'POST /pagamentos/.../fechar', 'Fechar comanda de B', async () => (await api('POST', `/api/pagamentos/comandas/${B.comandaIds[0]}/fechar`, { token: A.donoToken, body: { pagamentos: [{ forma: 'DINHEIRO', valor: 1 }] } })).status, [404]],
  ];
  for (const [id, endpoint, desc, call, expected] of idor) {
    await test({ id, category: 'Multi-tenant', name: desc, requirement: id }, async () => {
      const status = await call();
      return expectStatus(status, expected, `${endpoint} isolado`);
    });
  }

  await test({ id: 'TEN-14', category: 'Multi-tenant', name: 'Listagem de produtos não vaza B', requirement: 'TEN-14' }, async () => {
    const r = await api<Array<{ id: string }>>('GET', '/api/produtos', { token: A.donoToken });
    const leak = r.data.some((p) => p.id === B.produtoId);
    if (leak) return { status: 'failed', message: 'Produto de B visível para A', expected: 'isolado', actual: 'vazou' };
    return { message: `${r.data.length} produto(s), sem vazamento`, expected: 'isolado', actual: 'isolado' };
  });

  await test({ id: 'TEN-15', category: 'Multi-tenant', name: 'ADMIN não vê eventos de tenant via rota tenant', requirement: 'TEN-15' }, async () => {
    const r = await api<{ sessoes?: unknown[]; series?: unknown[]; error?: string }>('GET', '/api/eventos', {
      token: ctx.admin.token,
    });
    if (r.status === 403) return { message: 'ADMIN bloqueado na rota de tenant (403)', expected: '403', actual: '403' };
    const total = (r.data.sessoes?.length ?? 0) + (r.data.series?.length ?? 0);
    if (total > 0) {
      return { status: 'failed', message: `ADMIN vê ${total} eventos via rota tenant`, expected: '403', actual: `${r.status} com ${total} eventos` };
    }
    return {
      status: 'failed',
      message: 'ADMIN não vazou dados, mas a rota de tenant não devolveu 403',
      expected: '403',
      actual: String(r.status),
    };
  });

  await test({ id: 'TEN-16', category: 'Multi-tenant', name: 'ADMIN autentica com token de plataforma', requirement: 'TEN-16' }, async () => {
    const r = await api('GET', '/api/admin/cervejarias', { token: ctx.admin.token });
    return expectStatus(r.status, 200, 'ADMIN acessa rotas da plataforma');
  });

  console.log('\n=== FUNCIONAL (ciclo de vida) ===');
  let funcComandaId = '';
  await test({ id: 'RF-05a', category: 'Funcional', name: 'Criar comanda', requirement: 'RF-05' }, async () => {
    const r = await api<{ id: string }>('POST', '/api/comandas', {
      token: func.atendenteTokens[0],
      body: staffComandaBody(func.eventoId, `Cliente ${Date.now()}`, 1),
    });
    funcComandaId = r.data.id;
    return expectStatus(r.status, 201, 'Comanda criada');
  });
  await test({ id: 'RF-05b', category: 'Funcional', name: 'Adicionar 2 itens', requirement: 'RF-05' }, async () => {
    const r1 = await api('POST', `/api/comandas/${funcComandaId}/itens`, { token: func.atendenteTokens[0], body: chopeItemBody(func.produtoId, func.tapId, 500) });
    const r2 = await api<{ total: string | number }>('POST', `/api/comandas/${funcComandaId}/itens`, { token: func.atendenteTokens[1], body: chopeItemBody(func.produtoId, func.tapId, 300, 2) });
    const total = Number(r2.data.total);
    const expected = 12 + 8 * 2;
    if (r1.status !== 201 || r2.status !== 201) return { status: 'failed', message: 'Falha ao adicionar itens', actual: `${r1.status}/${r2.status}` };
    if (Math.abs(total - expected) > 0.01) return { status: 'failed', message: `Total ${total} != ${expected}`, expected: String(expected), actual: String(total) };
    return { message: `Total R$ ${total.toFixed(2)} correto`, expected: String(expected), actual: String(total) };
  });
  await test({ id: 'RF-07', category: 'Funcional', name: 'Ranking reflete consumo', requirement: 'RF-07' }, async () => {
    const r = await api<{ ranking: Array<{ totalMl: number }> }>('GET', `/api/ranking/evento/${func.eventoId}`, { token: func.donoToken });
    if (r.status !== 200) return { status: 'failed', message: `HTTP ${r.status}`, actual: String(r.status) };
    const totalMl = r.data.ranking.reduce((s, x) => s + x.totalMl, 0);
    if (totalMl < 500 + 300 * 2) return { status: 'failed', message: `Ranking ml=${totalMl} abaixo do esperado`, actual: String(totalMl) };
    return { message: `Ranking com ${r.data.ranking.length} cliente(s), ${totalMl}ml`, actual: String(totalMl) };
  });
  await test({ id: 'RF-06a', category: 'Funcional', name: 'Fechar com pagamento divergente → 400', requirement: 'RF-06' }, async () => {
    const r = await api('POST', `/api/pagamentos/comandas/${funcComandaId}/fechar`, { token: func.atendenteTokens[0], body: { pagamentos: [{ forma: 'PIX', valor: 1 }] } });
    return expectStatus(r.status, 400, 'Pagamento divergente rejeitado');
  });
  await test({ id: 'RF-06b', category: 'Funcional', name: 'Fechar comanda com pagamento correto', requirement: 'RF-06' }, async () => {
    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${funcComandaId}`, { token: func.donoToken });
    const total = Number(cur.data.total);
    const r = await api('POST', `/api/pagamentos/comandas/${funcComandaId}/fechar`, { token: func.atendenteTokens[0], body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] } });
    return expectStatus(r.status, 200, `Comanda fechada (R$ ${total.toFixed(2)})`);
  });
  await test({ id: 'RF-06c', category: 'Funcional', name: 'Re-fechar comanda já fechada → 404', requirement: 'RF-06' }, async () => {
    const r = await api('POST', `/api/pagamentos/comandas/${funcComandaId}/fechar`, { token: func.atendenteTokens[0], body: { pagamentos: [{ forma: 'DINHEIRO', valor: 12 }] } });
    return expectStatus(r.status, 404, 'Comanda fechada não refecha');
  });

  let grupoComandaA = '';
  let grupoComandaB = '';
  await test({ id: 'RF-13-setup', category: 'Funcional', name: 'Setup comandas para pagamento conjunto', requirement: 'RF-13' }, async () => {
    const c1 = await api<{ id: string }>('POST', '/api/comandas', {
      token: func.atendenteTokens[0],
      body: staffComandaBody(func.eventoId, `Grupo A ${Date.now()}`, 10),
    });
    const c2 = await api<{ id: string }>('POST', '/api/comandas', {
      token: func.atendenteTokens[0],
      body: staffComandaBody(func.eventoId, `Grupo B ${Date.now()}`, 11),
    });
    if (c1.status !== 201 || c2.status !== 201) {
      return { status: 'failed', message: 'Falha ao criar comandas do grupo', actual: `${c1.status}/${c2.status}` };
    }
    grupoComandaA = c1.data.id;
    grupoComandaB = c2.data.id;
    const i1 = await api('POST', `/api/comandas/${grupoComandaA}/itens`, {
      token: func.atendenteTokens[0],
      body: chopeItemBody(func.produtoId, func.tapId, 500),
    });
    const i2 = await api('POST', `/api/comandas/${grupoComandaB}/itens`, {
      token: func.atendenteTokens[0],
      body: chopeItemBody(func.produtoId, func.tapId, 300, 2),
    });
    if (i1.status !== 201 || i2.status !== 201) {
      return { status: 'failed', message: 'Falha ao adicionar itens ao grupo', actual: `${i1.status}/${i2.status}` };
    }
    return { message: 'Comandas do grupo prontas', actual: `${grupoComandaA.slice(0, 6)}…/${grupoComandaB.slice(0, 6)}…` };
  });
  await test({ id: 'RF-13b', category: 'Funcional', name: 'Pagamento conjunto divergente → 400', requirement: 'RF-13' }, async () => {
    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: func.atendenteTokens[0],
      body: { comandaIds: [grupoComandaA, grupoComandaB], pagamentos: [{ forma: 'PIX', valor: 1 }] },
    });
    return expectStatus(r.status, 400, 'Total do grupo divergente rejeitado');
  });
  await test({ id: 'RF-13c', category: 'Funcional', name: 'Pagamento conjunto com evento diferente → 404', requirement: 'RF-13' }, async () => {
    const other = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.donoToken,
      body: staffComandaBody(lifecycle.eventoId, `Outro evento ${Date.now()}`, 12),
    });
    if (other.status !== 201) return { status: 'failed', message: 'Setup RF-13c falhou', actual: String(other.status) };
    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: func.atendenteTokens[0],
      body: { comandaIds: [grupoComandaA, other.data.id], pagamentos: [{ forma: 'PIX', valor: 12 }] },
    });
    return expectStatus(r.status, 404, 'Comanda de outro evento rejeitada');
  });
  await test({ id: 'RF-13d', category: 'Funcional', name: 'Pagamento conjunto split alocado por comanda', requirement: 'RF-13' }, async () => {
    const curA = await api<{ total: string | number; status: string }>('GET', `/api/comandas/${grupoComandaA}`, { token: func.donoToken });
    const curB = await api<{ total: string | number; status: string }>('GET', `/api/comandas/${grupoComandaB}`, { token: func.donoToken });
    const totalA = Number(curA.data.total);
    const totalB = Number(curB.data.total);
    const totalGrupo = totalA + totalB;
    const r = await api<{ comandas: Array<{ id: string; pagamentos: Array<{ forma: string; valor: string | number }> }> }>(
      'POST',
      '/api/pagamentos/fechar-grupo',
      {
        token: func.atendenteTokens[0],
        body: {
          comandaIds: [grupoComandaA, grupoComandaB],
          pagamentos: [
            { forma: 'DINHEIRO', valor: Math.round(totalGrupo * 0.4 * 100) / 100 },
            { forma: 'PIX', valor: Math.round(totalGrupo * 0.6 * 100) / 100 },
          ],
        },
      },
    );
    if (r.status !== 200) return { status: 'failed', message: `Fechar grupo falhou HTTP ${r.status}`, actual: String(r.status) };
    for (const comanda of r.data.comandas) {
      const expected = comanda.id === grupoComandaA ? totalA : totalB;
      const sumPag = comanda.pagamentos.reduce((s, p) => s + Number(p.valor), 0);
      if (Math.abs(sumPag - expected) > 0.01) {
        return {
          status: 'failed',
          message: `Pagamentos da comanda ${comanda.id.slice(0, 6)} somam ${sumPag}, esperado ${expected}`,
          expected: String(expected),
          actual: String(sumPag),
        };
      }
    }
    return { message: `Grupo fechado split OK (R$ ${totalGrupo.toFixed(2)})`, actual: String(r.data.comandas.length) };
  });
  await test({ id: 'RF-13a', category: 'Funcional', name: 'Pagamento conjunto fecha ambas comandas', requirement: 'RF-13' }, async () => {
    const a = await api<{ status: string }>('GET', `/api/comandas/${grupoComandaA}`, { token: func.donoToken });
    const b = await api<{ status: string }>('GET', `/api/comandas/${grupoComandaB}`, { token: func.donoToken });
    if (a.data.status !== 'FECHADA' || b.data.status !== 'FECHADA') {
      return {
        status: 'failed',
        message: 'Comandas do grupo não estão FECHADA após RF-13d',
        expected: 'FECHADA/FECHADA',
        actual: `${a.data.status}/${b.data.status}`,
      };
    }
    return { message: 'Ambas comandas FECHADA', expected: 'FECHADA', actual: 'FECHADA' };
  });
  await test({ id: 'RF-13e', category: 'Funcional', name: 'Re-fechar grupo já fechado → 404', requirement: 'RF-13' }, async () => {
    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: func.atendenteTokens[0],
      body: { comandaIds: [grupoComandaA, grupoComandaB], pagamentos: [{ forma: 'PIX', valor: 28 }] },
    });
    return expectStatus(r.status, 404, 'Grupo já fechado não refecha');
  });

  await test({ id: 'RF-13f', category: 'Funcional', name: 'Pagamento conjunto com 1 comanda → 400', requirement: 'RF-13' }, async () => {
    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: func.atendenteTokens[0],
      body: { comandaIds: [grupoComandaA], pagamentos: [{ forma: 'PIX', valor: 12 }] },
    });
    return expectStatus(r.status, 400, 'Mínimo 2 comandas');
  });

  await test({ id: 'RF-13g', category: 'Funcional', name: 'Pagamento conjunto com IDs duplicados → 400', requirement: 'RF-13' }, async () => {
    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: func.atendenteTokens[0],
      body: { comandaIds: [grupoComandaA, grupoComandaA], pagamentos: [{ forma: 'PIX', valor: 12 }] },
    });
    return expectStatus(r.status, 400, 'IDs duplicados rejeitados');
  });

  let rf13hVazia = '';
  let rf13hComItens = '';
  await test({ id: 'RF-13h', category: 'Funcional', name: 'Grupo vazia + com itens → cancela vazia e fecha outra', requirement: 'RF-13' }, async () => {
    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { status: 'ABERTO' },
    });
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });

    const vazia = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `Vazia ${Date.now()}`, 20),
    });
    const comItens = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `ComItens ${Date.now()}`, 21),
    });
    if (vazia.status !== 201 || comItens.status !== 201) {
      return { status: 'failed', message: 'Setup RF-13h falhou', actual: `${vazia.status}/${comItens.status}` };
    }
    rf13hVazia = vazia.data.id;
    rf13hComItens = comItens.data.id;

    const item = await api('POST', `/api/comandas/${rf13hComItens}/itens`, {
      token: lifecycle.atendenteTokens[0],
      body: chopeItemBody(lifecycle.produtoId, lifecycle.tapId, 500),
    });
    if (item.status !== 201) {
      return { status: 'failed', message: 'Setup RF-13h: item não adicionado', actual: String(item.status) };
    }

    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${rf13hComItens}`, { token: lifecycle.donoToken });
    const total = Number(cur.data.total);

    const r = await api<{
      comandas: Array<{ id: string; status: string }>;
      canceladas: Array<{ id: string; status: string }>;
    }>('POST', '/api/pagamentos/fechar-grupo', {
      token: lifecycle.atendenteTokens[0],
      body: {
        comandaIds: [rf13hVazia, rf13hComItens],
        pagamentos: [{ forma: 'PIX', valor: total }],
      },
    });
    if (r.status !== 200) {
      return { status: 'failed', message: `Fechar grupo misto HTTP ${r.status}`, actual: String(r.status) };
    }

    const cancelada = r.data.canceladas.find((c) => c.id === rf13hVazia);
    const fechada = r.data.comandas.find((c) => c.id === rf13hComItens);
    if (cancelada?.status !== 'CANCELADA') {
      return { status: 'failed', message: 'Comanda vazia deveria CANCELADA', expected: 'CANCELADA', actual: cancelada?.status ?? 'missing' };
    }
    if (fechada?.status !== 'FECHADA') {
      return { status: 'failed', message: 'Comanda com itens deveria FECHADA', expected: 'FECHADA', actual: fechada?.status ?? 'missing' };
    }
    return { message: 'Grupo misto OK', expected: 'CANCELADA/FECHADA', actual: `${cancelada.status}/${fechada.status}` };
  });

  await test({ id: 'RF-13i', category: 'Funcional', name: 'Pagamento conjunto com evento FECHADO → 404', requirement: 'RF-13' }, async () => {
    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { status: 'ABERTO' },
    });
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });

    const c1 = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `EvFechado A ${Date.now()}`, 22),
    });
    const c2 = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `EvFechado B ${Date.now()}`, 23),
    });
    if (c1.status !== 201 || c2.status !== 201) {
      return { status: 'failed', message: 'Setup RF-13i falhou', actual: `${c1.status}/${c2.status}` };
    }

    for (const id of [c1.data.id, c2.data.id]) {
      const item = await api('POST', `/api/comandas/${id}/itens`, {
        token: lifecycle.atendenteTokens[0],
        body: chopeItemBody(lifecycle.produtoId, lifecycle.tapId, 500),
      });
      if (item.status !== 201) {
        return { status: 'failed', message: 'Setup RF-13i: item falhou', actual: String(item.status) };
      }
    }

    // Simula evento encerrado enquanto comandas ainda abertas (PATCH /fechar exige comandas fechadas)
    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { status: 'FECHADO' },
    });

    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${c1.data.id}`, { token: lifecycle.donoToken });
    const total = Number(cur.data.total) * 2;

    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: lifecycle.atendenteTokens[0],
      body: {
        comandaIds: [c1.data.id, c2.data.id],
        pagamentos: [{ forma: 'PIX', valor: total }],
      },
    });

    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { status: 'ABERTO' },
    });
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });

    return expectStatus(r.status, 404, 'Evento fechado bloqueia pagamento conjunto');
  });

  console.log('\n=== FUNCIONAL (pagamento conjunto — relatórios) ===');
  let rf14ComandaA = '';
  let rf14ComandaB = '';
  let rf14ClienteAId = '';
  let rf14ClienteBId = '';
  let rf14TotalA = 0;
  let rf14TotalB = 0;
  let rf14TotalGrupo = 0;
  let rf14PastDate = new Date();
  let rf14Mes = 0;
  let rf14Ano = 0;
  let rf14GastoBeforeA = 0;
  let rf14GastoBeforeB = 0;
  let rf14MlBeforeA = 0;
  let rf14MlBeforeB = 0;

  await test({ id: 'RF-14-setup', category: 'Funcional', name: 'Setup pagamento conjunto para relatórios', requirement: 'RF-14' }, async () => {
    rf14PastDate = new Date();
    rf14PastDate.setUTCDate(rf14PastDate.getUTCDate() - 7);
    rf14PastDate.setUTCHours(0, 0, 0, 0);
    rf14Mes = rf14PastDate.getUTCMonth() + 1;
    rf14Ano = rf14PastDate.getUTCFullYear();

    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { data: rf14PastDate, horaInicio: '18:00', horaFim: '23:45', status: 'ABERTO' },
    });
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });

    const cA = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `Casal A ${Date.now()}`, 30),
    });
    const cB = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `Casal B ${Date.now()}`, 31),
    });
    if (cA.status !== 201 || cB.status !== 201) {
      return { status: 'failed', message: 'Setup RF-14: comandas não criadas', actual: `${cA.status}/${cB.status}` };
    }
    rf14ComandaA = cA.data.id;
    rf14ComandaB = cB.data.id;

    const iA = await api('POST', `/api/comandas/${rf14ComandaA}/itens`, {
      token: lifecycle.atendenteTokens[0],
      body: chopeItemBody(lifecycle.produtoId, lifecycle.tapId, 500),
    });
    const iB = await api('POST', `/api/comandas/${rf14ComandaB}/itens`, {
      token: lifecycle.atendenteTokens[0],
      body: chopeItemBody(lifecycle.produtoId, lifecycle.tapId, 300, 2),
    });
    if (iA.status !== 201 || iB.status !== 201) {
      return { status: 'failed', message: 'Setup RF-14: itens não adicionados', actual: `${iA.status}/${iB.status}` };
    }

    const fullA = await api<{ total: string | number; clienteId: string }>('GET', `/api/comandas/${rf14ComandaA}`, { token: lifecycle.donoToken });
    const fullB = await api<{ total: string | number; clienteId: string }>('GET', `/api/comandas/${rf14ComandaB}`, { token: lifecycle.donoToken });
    rf14TotalA = Number(fullA.data.total);
    rf14TotalB = Number(fullB.data.total);
    rf14TotalGrupo = rf14TotalA + rf14TotalB;
    rf14ClienteAId = fullA.data.clienteId;
    rf14ClienteBId = fullB.data.clienteId;

    const statsBeforeA = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteAId } });
    const statsBeforeB = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteBId } });
    rf14GastoBeforeA = Number(statsBeforeA?.totalGasto ?? 0);
    rf14GastoBeforeB = Number(statsBeforeB?.totalGasto ?? 0);
    rf14MlBeforeA = statsBeforeA?.totalMlChope ?? 0;
    rf14MlBeforeB = statsBeforeB?.totalMlChope ?? 0;

    const close = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: lifecycle.atendenteTokens[0],
      body: {
        comandaIds: [rf14ComandaA, rf14ComandaB],
        pagamentos: [
          { forma: 'DINHEIRO', valor: Math.round(rf14TotalGrupo * 0.4 * 100) / 100 },
          { forma: 'PIX', valor: Math.round(rf14TotalGrupo * 0.6 * 100) / 100 },
        ],
      },
    });
    if (close.status !== 200) {
      return { status: 'failed', message: 'Setup RF-14: fechar grupo falhou', actual: String(close.status) };
    }

    const fechadoEm = new Date(rf14PastDate);
    fechadoEm.setHours(20, 30, 0, 0);
    await prisma.comanda.updateMany({
      where: { id: { in: [rf14ComandaA, rf14ComandaB] } },
      data: { updatedAt: fechadoEm },
    });

    return {
      message: `Grupo fechado R$ ${rf14TotalGrupo.toFixed(2)} (A=${rf14TotalA}, B=${rf14TotalB})`,
      expected: String(rf14TotalGrupo),
      actual: String(rf14TotalGrupo),
    };
  });

  await test({ id: 'RF-14a', category: 'Funcional', name: 'Dashboard evento após pagamento conjunto', requirement: 'RF-14' }, async () => {
    const dash = await api<{
      resumo: { comandasFechadas: number; valorFechado: number };
    }>('GET', `/api/eventos/${lifecycle.eventoId}/dashboard`, { token: lifecycle.donoToken });
    if (dash.status !== 200) return { status: 'failed', message: `Dashboard HTTP ${dash.status}`, actual: String(dash.status) };
    if (dash.data.resumo.comandasFechadas < 2) {
      return { status: 'failed', message: 'comandasFechadas < 2', expected: '>=2', actual: String(dash.data.resumo.comandasFechadas) };
    }
    if (Math.abs(dash.data.resumo.valorFechado - rf14TotalGrupo) > 0.01) {
      return {
        status: 'failed',
        message: 'valorFechado diverge do total grupo',
        expected: String(rf14TotalGrupo),
        actual: String(dash.data.resumo.valorFechado),
      };
    }
    return { message: `Dashboard OK (${dash.data.resumo.comandasFechadas} fechadas)`, expected: String(rf14TotalGrupo), actual: String(dash.data.resumo.valorFechado) };
  });

  await test({ id: 'RF-14b', category: 'Funcional', name: 'Pagamentos alocados por comanda', requirement: 'RF-14' }, async () => {
    for (const [id, expected] of [[rf14ComandaA, rf14TotalA], [rf14ComandaB, rf14TotalB]] as const) {
      const c = await api<{ status: string; total: string | number; pagamentos: Array<{ valor: string | number }> }>(
        'GET',
        `/api/comandas/${id}`,
        { token: lifecycle.donoToken },
      );
      if (c.data.status !== 'FECHADA') {
        return { status: 'failed', message: `Comanda ${id.slice(0, 6)} não FECHADA`, expected: 'FECHADA', actual: c.data.status };
      }
      const sumPag = c.data.pagamentos.reduce((s, p) => s + Number(p.valor), 0);
      if (Math.abs(sumPag - expected) > 0.01) {
        return { status: 'failed', message: `Soma pagamentos ${id.slice(0, 6)}`, expected: String(expected), actual: String(sumPag) };
      }
    }
    return { message: 'Pagamentos por comanda OK', expected: 'match', actual: 'match' };
  });

  await test({ id: 'RF-14c', category: 'Funcional', name: 'Ranking separado por cliente após grupo', requirement: 'RF-14' }, async () => {
    const r = await api<{ ranking: Array<{ clienteId: string; totalMl: number }> }>(
      'GET',
      `/api/ranking/evento/${lifecycle.eventoId}`,
      { token: lifecycle.donoToken },
    );
    if (r.status !== 200) return { status: 'failed', message: `Ranking HTTP ${r.status}`, actual: String(r.status) };
    const entryA = r.data.ranking.find((x) => x.clienteId === rf14ClienteAId);
    const entryB = r.data.ranking.find((x) => x.clienteId === rf14ClienteBId);
    if (!entryA || !entryB) {
      return { status: 'failed', message: 'Ranking não tem 2 clientes distintos', expected: '2 entries', actual: String(r.data.ranking.length) };
    }
    if (entryA.totalMl !== 500 || entryB.totalMl !== 600) {
      return {
        status: 'failed',
        message: 'Ml por cliente incorreto',
        expected: '500/600',
        actual: `${entryA.totalMl}/${entryB.totalMl}`,
      };
    }
    return { message: 'Ranking separado OK (500ml + 600ml)', expected: '500/600', actual: `${entryA.totalMl}/${entryB.totalMl}` };
  });

  await test({ id: 'RF-16a', category: 'Funcional', name: 'CRM: comandas fechadas por cliente', requirement: 'RF-16' }, async () => {
    const statsA = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteAId } });
    const statsB = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteBId } });
    if (!statsA || !statsB) {
      return { status: 'failed', message: 'Stats CRM ausentes', expected: '2 rows', actual: `${statsA ? 1 : 0}/${statsB ? 1 : 0}` };
    }
    if (statsA.totalComandasFechadas < 1 || statsB.totalComandasFechadas < 1) {
      return {
        status: 'failed',
        message: 'totalComandasFechadas não incrementou',
        expected: '>=1',
        actual: `${statsA.totalComandasFechadas}/${statsB.totalComandasFechadas}`,
      };
    }
    return { message: 'CRM comandas fechadas OK', expected: '>=1', actual: `${statsA.totalComandasFechadas}/${statsB.totalComandasFechadas}` };
  });

  await test({ id: 'RF-16b', category: 'Funcional', name: 'CRM: totalGasto por cliente', requirement: 'RF-16' }, async () => {
    const statsA = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteAId } });
    const statsB = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteBId } });
    if (!statsA || !statsB) return { status: 'failed', message: 'Stats ausentes', actual: 'missing' };
    const deltaA = Number(statsA.totalGasto) - rf14GastoBeforeA;
    const deltaB = Number(statsB.totalGasto) - rf14GastoBeforeB;
    if (Math.abs(deltaA - rf14TotalA) > 0.01 || Math.abs(deltaB - rf14TotalB) > 0.01) {
      return {
        status: 'failed',
        message: 'Incremento totalGasto diverge',
        expected: `${rf14TotalA}/${rf14TotalB}`,
        actual: `${deltaA}/${deltaB}`,
      };
    }
    return { message: 'CRM totalGasto OK', expected: `${rf14TotalA}/${rf14TotalB}`, actual: `${deltaA}/${deltaB}` };
  });

  await test({ id: 'RF-16c', category: 'Funcional', name: 'CRM: totalMlChope por cliente', requirement: 'RF-16' }, async () => {
    const statsA = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteAId } });
    const statsB = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: rf14ClienteBId } });
    if (!statsA || !statsB) return { status: 'failed', message: 'Stats ausentes', actual: 'missing' };
    const deltaMlA = statsA.totalMlChope - rf14MlBeforeA;
    const deltaMlB = statsB.totalMlChope - rf14MlBeforeB;
    if (deltaMlA !== 500 || deltaMlB !== 600) {
      return {
        status: 'failed',
        message: 'Incremento totalMlChope diverge',
        expected: '500/600',
        actual: `${deltaMlA}/${deltaMlB}`,
      };
    }
    return { message: 'CRM chope OK', expected: '500/600', actual: `${deltaMlA}/${deltaMlB}` };
  });

  await test({ id: 'RF-16d', category: 'Funcional', name: 'CRM: excluir cliente sem movimentação', requirement: 'RF-16' }, async () => {
    const phoneSuffix = Date.now().toString().slice(-8);
    const created = await api<{ id: string; podeExcluir: boolean }>('POST', '/api/clientes', {
      token: lifecycle.donoToken,
      body: { nome: 'QA Delete OK', telefone: `119${phoneSuffix}` },
    });
    if (created.status !== 201) {
      return { status: 'failed', message: 'Falha ao criar cliente QA', actual: String(created.status) };
    }
    if (!created.data.podeExcluir) {
      return { status: 'failed', message: 'podeExcluir deveria ser true', actual: String(created.data.podeExcluir) };
    }
    const del = await api('DELETE', `/api/clientes/${created.data.id}`, { token: lifecycle.donoToken });
    if (del.status !== 204) {
      return { status: 'failed', message: 'DELETE deveria retornar 204', expected: '204', actual: String(del.status) };
    }
    const gone = await prisma.cliente.findUnique({ where: { id: created.data.id } });
    if (gone) {
      return { status: 'failed', message: 'Cliente ainda existe no banco', actual: 'exists' };
    }
    return { message: 'Cliente sem movimentação excluído', expected: '204', actual: String(del.status) };
  });

  await test({ id: 'RF-16e', category: 'Funcional', name: 'CRM: bloquear exclusão com comandas', requirement: 'RF-16' }, async () => {
    const del = await api<{ error: string }>('DELETE', `/api/clientes/${rf14ClienteAId}`, { token: lifecycle.donoToken });
    if (del.status !== 409) {
      return { status: 'failed', message: 'DELETE deveria retornar 409', expected: '409', actual: String(del.status) };
    }
    return { message: 'Exclusão bloqueada com movimentação', expected: '409', actual: String(del.status) };
  });

  await test({ id: 'RF-16f', category: 'Funcional', name: 'CRM: excluir cliente só com comanda cancelada', requirement: 'RF-16' }, async () => {
    const phoneSuffix = Date.now().toString().slice(-8);
    const created = await api<{ id: string; podeExcluir: boolean }>('POST', '/api/clientes', {
      token: lifecycle.donoToken,
      body: { nome: 'QA Cancelada Only', telefone: `118${phoneSuffix}` },
    });
    if (created.status !== 201) {
      return { status: 'failed', message: 'Falha ao criar cliente QA', actual: String(created.status) };
    }

    await prisma.comanda.create({
      data: {
        eventoId: lifecycle.eventoId,
        clienteId: created.data.id,
        status: 'CANCELADA',
        tipo: 'COMANDA',
      },
    });

    const fetched = await api<{ podeExcluir: boolean }>('GET', `/api/clientes/${created.data.id}`, {
      token: lifecycle.donoToken,
    });
    if (!fetched.data.podeExcluir) {
      return {
        status: 'failed',
        message: 'podeExcluir deveria ser true com só comanda cancelada',
        actual: String(fetched.data.podeExcluir),
      };
    }

    const del = await api('DELETE', `/api/clientes/${created.data.id}`, { token: lifecycle.donoToken });
    if (del.status !== 204) {
      return { status: 'failed', message: 'DELETE deveria retornar 204', expected: '204', actual: String(del.status) };
    }
    return { message: 'Cliente com só comanda cancelada excluído', expected: '204', actual: String(del.status) };
  });

  await test({ id: 'RF-16g', category: 'Funcional', name: 'CRM: unir clientes legados duplicados', requirement: 'RF-16' }, async () => {
    const nome = `QA Merge ${Date.now()}`;
    const destino = await prisma.cliente.create({
      data: {
        nome,
        telefone: null,
        cervejariaId: lifecycle.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });
    const fonte = await prisma.cliente.create({
      data: {
        nome,
        telefone: null,
        cervejariaId: lifecycle.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });

    await prisma.comanda.create({
      data: {
        eventoId: lifecycle.eventoId,
        clienteId: destino.id,
        status: 'FECHADA',
        tipo: 'COMANDA',
        total: 50,
        fechadaEm: new Date(),
        pagamentos: { create: [{ forma: 'PIX', valor: 50 }] },
      },
    });
    await prisma.comanda.create({
      data: {
        eventoId: lifecycle.eventoId,
        clienteId: fonte.id,
        status: 'FECHADA',
        tipo: 'COMANDA',
        total: 30,
        fechadaEm: new Date(),
        pagamentos: { create: [{ forma: 'DINHEIRO', valor: 30 }] },
      },
    });

    const merge = await api<{
      comandasMovidas: number;
      estatisticas: { totalComandasFechadas: number; totalGasto: number };
    }>('POST', `/api/clientes/${destino.id}/unir`, {
      token: lifecycle.donoToken,
      body: { fonteId: fonte.id },
    });

    if (merge.status !== 200) {
      return { status: 'failed', message: 'Unir clientes deveria retornar 200', actual: String(merge.status) };
    }
    if (merge.data.comandasMovidas !== 1) {
      return {
        status: 'failed',
        message: 'Deveria mover 1 comanda da fonte',
        expected: '1',
        actual: String(merge.data.comandasMovidas),
      };
    }

    const fonteGone = await prisma.cliente.findUnique({ where: { id: fonte.id } });
    if (fonteGone) {
      return { status: 'failed', message: 'Cliente fonte deveria ter sido removido', actual: 'exists' };
    }

    const comandasDestino = await prisma.comanda.count({ where: { clienteId: destino.id, status: 'FECHADA' } });
    if (comandasDestino !== 2) {
      return {
        status: 'failed',
        message: 'Destino deveria ter 2 comandas fechadas',
        expected: '2',
        actual: String(comandasDestino),
      };
    }

    const stats = await prisma.clienteEstatisticas.findUnique({ where: { clienteId: destino.id } });
    const gasto = stats ? Number(stats.totalGasto) : 0;
    if (stats?.totalComandasFechadas !== 2 || Math.abs(gasto - 80) > 0.01) {
      return {
        status: 'failed',
        message: 'Stats deveriam refletir soma das comandas',
        expected: '2 visitas / R$ 80',
        actual: `${stats?.totalComandasFechadas ?? 0} visitas / R$ ${gasto}`,
      };
    }

    return { message: 'Clientes legados unidos com stats recalculados', expected: '80', actual: String(gasto) };
  });

  await test({ id: 'RF-17a', category: 'Funcional', name: 'Legado: vincular telefone via clienteId', requirement: 'RF-17' }, async () => {
    const legacy = await prisma.cliente.create({
      data: {
        nome: `QA Legado ${Date.now()}`,
        telefone: null,
        cervejariaId: lifecycle.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });
    const tel = uniquePortalTestPhone(88, 1);

    const created = await api<{ id: string; clienteId: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: legacy.nome,
        clienteTelefone: tel,
        clienteId: legacy.id,
      },
    });
    if (created.status !== 201) {
      return { status: 'failed', message: 'Comanda legado+telefone deveria retornar 201', actual: String(created.status) };
    }
    if (created.data.clienteId !== legacy.id) {
      return {
        status: 'failed',
        message: 'Comanda deveria usar o mesmo clienteId legado',
        expected: legacy.id,
        actual: created.data.clienteId,
      };
    }

    const updated = await prisma.cliente.findUnique({ where: { id: legacy.id } });
    if (!updated?.telefone || updated.telefone !== tel) {
      return {
        status: 'failed',
        message: 'Telefone deveria estar vinculado ao legado',
        expected: tel,
        actual: updated?.telefone ?? 'null',
      };
    }
    return { message: 'Telefone vinculado ao legado', expected: legacy.id, actual: created.data.clienteId };
  });

  await test({ id: 'RF-17b', category: 'Funcional', name: 'Legado: conflito telefone de outro cliente', requirement: 'RF-17' }, async () => {
    const tel = portalTestPhone(88, 2);
    const other = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `QA Dono Tel ${Date.now()}`, 882),
    });
    if (other.status !== 201) {
      return { status: 'failed', message: 'Setup: comanda com telefone falhou', actual: String(other.status) };
    }

    const fullOther = await api<{ clienteId: string }>('GET', `/api/comandas/${other.data.id}`, {
      token: lifecycle.donoToken,
    });
    const otherCliente = await prisma.cliente.findUniqueOrThrow({
      where: { id: fullOther.data.clienteId },
      select: { telefone: true },
    });
    const telOcupado = otherCliente.telefone ?? tel;

    const legacy = await prisma.cliente.create({
      data: {
        nome: `QA Legado Conflito ${Date.now()}`,
        telefone: null,
        cervejariaId: lifecycle.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });

    const conflict = await api<{ error: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: legacy.nome,
        clienteTelefone: telOcupado,
        clienteId: legacy.id,
      },
    });
    if (conflict.status !== 409) {
      return { status: 'failed', message: 'Conflito deveria retornar 409', expected: '409', actual: String(conflict.status) };
    }

    const stillLegacy = await prisma.cliente.findUnique({ where: { id: legacy.id } });
    if (stillLegacy?.telefone) {
      return { status: 'failed', message: 'Legado não deveria receber telefone em conflito', actual: stillLegacy.telefone };
    }
    return { message: 'Conflito de telefone bloqueado', expected: '409', actual: String(conflict.status) };
  });

  await test({ id: 'RF-17c', category: 'Funcional', name: 'Legado: fluxo telefone-only inalterado', requirement: 'RF-17' }, async () => {
    const tel = portalTestPhone(88, 3);
    const nome = `QA Phone Only ${Date.now()}`;
    const before = await prisma.cliente.count({ where: { cervejariaId: lifecycle.cervejariaId, telefone: tel } });

    const created = await api<{ id: string; clienteId: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: nome,
        clienteTelefone: tel,
      },
    });
    if (created.status !== 201) {
      return { status: 'failed', message: 'Comanda telefone-only deveria retornar 201', actual: String(created.status) };
    }

    const after = await prisma.cliente.count({ where: { cervejariaId: lifecycle.cervejariaId, telefone: tel } });
    if (before === 0 && after !== 1) {
      return { status: 'failed', message: 'Deveria existir exatamente 1 cliente com o telefone', expected: '1', actual: String(after) };
    }

    const cliente = await prisma.cliente.findFirst({
      where: { id: created.data.clienteId, telefone: tel },
    });
    if (!cliente) {
      return { status: 'failed', message: 'Cliente da comanda deveria ter o telefone informado', actual: 'not found' };
    }
    return { message: 'Fluxo telefone-only OK', expected: tel, actual: cliente.telefone ?? 'null' };
  });

  await test({ id: 'RF-17e', category: 'Funcional', name: 'Comanda duplicada retorna 409', requirement: 'RF-17' }, async () => {
    const tel = uniquePortalTestPhone(88, 9);
    const nome = `QA Dup Comanda ${Date.now()}`;

    const first = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: nome,
        clienteTelefone: tel,
      },
    });
    if (first.status !== 201) {
      return { status: 'failed', message: 'Setup: primeira comanda deveria retornar 201', actual: String(first.status) };
    }

    const dup = await api<{ error: string; comandaId: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: nome,
        clienteTelefone: tel,
      },
    });
    if (dup.status !== 409) {
      return { status: 'failed', message: 'Comanda duplicada deveria retornar 409', expected: '409', actual: String(dup.status) };
    }
    if (dup.data?.comandaId !== first.data!.id) {
      return {
        status: 'failed',
        message: '409 deveria referenciar a comanda aberta existente',
        expected: first.data!.id,
        actual: dup.data?.comandaId ?? 'null',
      };
    }
    return { message: 'Comanda duplicada bloqueada', expected: first.data!.id, actual: dup.data.comandaId };
  });

  await test({ id: 'RF-17d', category: 'Funcional', name: 'Legado: portal não auto-vincula', requirement: 'RF-17' }, async () => {
    const legacyName = `QA Portal Legado ${Date.now()}`;
    const legacy = await prisma.cliente.create({
      data: {
        nome: legacyName,
        telefone: null,
        cervejariaId: lifecycle.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });
    const tel = portalTestPhone(88, 4);

    const session = await portalSessao(lifecycle.slug, lifecycle.trailerId, {
      nome: legacyName,
      telefone: tel,
    });
    if (session.status !== 201 || !session.clienteId) {
      return { status: 'failed', message: 'Sessão portal deveria retornar 201', actual: String(session.status) };
    }
    if (session.clienteId === legacy.id) {
      return {
        status: 'failed',
        message: 'Portal não deveria reutilizar cliente legado sem telefone',
        expected: 'novo id',
        actual: legacy.id,
      };
    }

    const legacyAfter = await prisma.cliente.findUnique({ where: { id: legacy.id } });
    if (legacyAfter?.telefone) {
      return { status: 'failed', message: 'Legado deveria permanecer sem telefone', actual: legacyAfter.telefone };
    }

    const portalCliente = await prisma.cliente.findUnique({ where: { id: session.clienteId } });
    if (!portalCliente?.telefone || portalCliente.telefone !== tel) {
      return {
        status: 'failed',
        message: 'Portal deveria criar cliente com telefone informado',
        expected: tel,
        actual: portalCliente?.telefone ?? 'null',
      };
    }
    return { message: 'Portal criou cliente novo sem tocar legado', expected: legacy.id, actual: session.clienteId };
  });

  await test({ id: 'RF-17e', category: 'Funcional', name: 'Legado: clienteId sem telefone exige phone', requirement: 'RF-17' }, async () => {
    const legacy = await prisma.cliente.create({
      data: {
        nome: `QA Legado Block ${Date.now()}`,
        telefone: null,
        cervejariaId: lifecycle.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });
    const tel = uniquePortalTestPhone(87, 2);

    const blocked = await api<{ error: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: legacy.nome,
        clienteId: legacy.id,
      },
    });
    if (blocked.status !== 400) {
      return {
        status: 'failed',
        message: 'Legado sem telefone deveria retornar 400',
        expected: '400',
        actual: String(blocked.status),
      };
    }

    const ok = await api<{ id: string; clienteId: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: {
        eventoId: lifecycle.eventoId,
        clienteNome: legacy.nome,
        clienteTelefone: tel,
        clienteId: legacy.id,
      },
    });
    if (ok.status !== 201) {
      return { status: 'failed', message: 'Com legado+telefone deveria retornar 201', actual: String(ok.status) };
    }
    if (ok.data.clienteId !== legacy.id) {
      return {
        status: 'failed',
        message: 'Deveria usar o mesmo clienteId legado',
        expected: legacy.id,
        actual: ok.data.clienteId,
      };
    }

    const updated = await prisma.cliente.findUnique({ where: { id: legacy.id } });
    if (updated?.telefone !== tel) {
      return {
        status: 'failed',
        message: 'Telefone deveria estar vinculado',
        expected: tel,
        actual: updated?.telefone ?? 'null',
      };
    }
    return { message: 'Legado exige telefone; vincula ao confirmar', expected: '400 then 201', actual: 'OK' };
  });

  let rf14Resumo: {
    resumo: { receitaTotal: number; comandasAtendidas: number };
    porPagamento: Array<{ forma: string; valor: number }>;
    fluxoPorIntervalo: Array<{ fechado: number }>;
    vendasPorIntervalo: Array<{ receita: number }>;
  } | null = null;

  await test({ id: 'RF-14d', category: 'Funcional', name: 'Resumo: receitaTotal após grupo', requirement: 'RF-14' }, async () => {
    // RF-17a/e abrem comandas extras no mesmo evento; cancelar antes de fechar o evento.
    await prisma.comanda.updateMany({
      where: { eventoId: lifecycle.eventoId, status: 'ABERTA' },
      data: { status: 'CANCELADA' },
    });

    const fecharEvento = await api('PATCH', `/api/eventos/${lifecycle.eventoId}/fechar`, { token: lifecycle.donoToken });
    if (fecharEvento.status !== 200) {
      return { status: 'failed', message: 'Fechar evento falhou', actual: String(fecharEvento.status) };
    }

    const resumo = await api<typeof rf14Resumo>('GET', `/api/eventos/${lifecycle.eventoId}/resumo-executivo`, { token: lifecycle.donoToken });
    if (resumo.status !== 200 || !resumo.data) {
      return { status: 'failed', message: 'Resumo HTTP inválido', actual: String(resumo.status) };
    }
    rf14Resumo = resumo.data;

    const fechadasAgg = await prisma.comanda.aggregate({
      where: { eventoId: lifecycle.eventoId, status: 'FECHADA' },
      _sum: { total: true },
    });
    const expectedReceita = Number(fechadasAgg._sum.total ?? 0);

    if (Math.abs(resumo.data.resumo.receitaTotal - expectedReceita) > 0.01) {
      return {
        status: 'failed',
        message: 'receitaTotal diverge',
        expected: String(expectedReceita),
        actual: String(resumo.data.resumo.receitaTotal),
      };
    }
    return { message: `receitaTotal R$ ${resumo.data.resumo.receitaTotal.toFixed(2)}`, expected: String(expectedReceita), actual: String(resumo.data.resumo.receitaTotal) };
  });

  await test({ id: 'RF-14e', category: 'Funcional', name: 'Resumo: comandasAtendidas >= 2', requirement: 'RF-14' }, async () => {
    if (!rf14Resumo) return { status: 'failed', message: 'RF-14d não rodou', actual: 'skip' };
    if (rf14Resumo.resumo.comandasAtendidas < 2) {
      return { status: 'failed', message: 'comandasAtendidas < 2', expected: '>=2', actual: String(rf14Resumo.resumo.comandasAtendidas) };
    }
    return { message: 'comandasAtendidas OK', expected: '>=2', actual: String(rf14Resumo.resumo.comandasAtendidas) };
  });

  await test({ id: 'RF-14f', category: 'Funcional', name: 'Resumo: porPagamento soma = receita', requirement: 'RF-14' }, async () => {
    if (!rf14Resumo) return { status: 'failed', message: 'RF-14d não rodou', actual: 'skip' };
    const pagTotal = rf14Resumo.porPagamento.reduce((s, p) => s + p.valor, 0);
    if (Math.abs(pagTotal - rf14Resumo.resumo.receitaTotal) > 0.01) {
      return { status: 'failed', message: 'porPagamento diverge', expected: String(rf14Resumo.resumo.receitaTotal), actual: String(pagTotal) };
    }
    return { message: 'porPagamento OK', expected: String(rf14Resumo.resumo.receitaTotal), actual: String(pagTotal) };
  });

  await test({ id: 'RF-14g', category: 'Funcional', name: 'Resumo: split DINHEIRO + PIX alocado', requirement: 'RF-14' }, async () => {
    if (!rf14Resumo) return { status: 'failed', message: 'RF-14d não rodou', actual: 'skip' };
    const dinheiro = rf14Resumo.porPagamento.find((p) => p.forma === 'DINHEIRO');
    const pix = rf14Resumo.porPagamento.find((p) => p.forma === 'PIX');
    if (!dinheiro || !pix || dinheiro.valor <= 0 || pix.valor <= 0) {
      return { status: 'failed', message: 'Formas DINHEIRO/PIX ausentes', expected: 'both > 0', actual: `${dinheiro?.valor ?? 0}/${pix?.valor ?? 0}` };
    }
    return { message: 'Split formas OK', expected: '>0', actual: `${dinheiro.valor.toFixed(2)}/${pix.valor.toFixed(2)}` };
  });

  await test({ id: 'RF-14h', category: 'Funcional', name: 'Resumo: fluxo fechado = receita', requirement: 'RF-14' }, async () => {
    if (!rf14Resumo) return { status: 'failed', message: 'RF-14d não rodou', actual: 'skip' };
    const fechadoTotal = rf14Resumo.fluxoPorIntervalo.reduce((s, b) => s + b.fechado, 0);
    if (Math.abs(fechadoTotal - rf14Resumo.resumo.receitaTotal) > 0.01) {
      return { status: 'failed', message: 'fluxo fechado diverge', expected: String(rf14Resumo.resumo.receitaTotal), actual: String(fechadoTotal) };
    }
    return { message: 'fluxo fechado OK', expected: String(rf14Resumo.resumo.receitaTotal), actual: String(fechadoTotal) };
  });

  await test({ id: 'RF-14i', category: 'Funcional', name: 'Resumo: vendasPorIntervalo = receita', requirement: 'RF-14' }, async () => {
    if (!rf14Resumo) return { status: 'failed', message: 'RF-14d não rodou', actual: 'skip' };
    const chartTotal = rf14Resumo.vendasPorIntervalo.reduce((s, b) => s + b.receita, 0);
    if (Math.abs(chartTotal - rf14Resumo.resumo.receitaTotal) > 0.01) {
      return { status: 'failed', message: 'vendasPorIntervalo diverge', expected: String(rf14Resumo.resumo.receitaTotal), actual: String(chartTotal) };
    }
    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });
    return { message: 'vendasPorIntervalo OK', expected: String(rf14Resumo.resumo.receitaTotal), actual: String(chartTotal) };
  });

  await test({ id: 'RF-15a', category: 'Funcional', name: 'Dashboard BI: evento em eventosRecentes', requirement: 'RF-15' }, async () => {
    const lastDayOfMonth = new Date(rf14Ano, rf14Mes, 0);
    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { data: lastDayOfMonth, status: 'FECHADO' },
    });

    const dash = await api<{
      eventosRecentes: Array<{ eventoId: string; receitaTotal: number }>;
      resumo: { receitaTotal: number };
    }>('GET', `/api/cervejaria/dashboard?ano=${rf14Ano}&mes=${rf14Mes}`, { token: lifecycle.donoToken });

    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });

    if (dash.status !== 200) return { status: 'failed', message: `Dashboard BI HTTP ${dash.status}`, actual: String(dash.status) };
    const ev = dash.data.eventosRecentes.find((e) => e.eventoId === lifecycle.eventoId);
    if (!ev) {
      return {
        status: 'failed',
        message: 'Evento não listado em eventosRecentes',
        expected: lifecycle.eventoId,
        actual: dash.data.eventosRecentes.map((e) => e.eventoId).join(','),
      };
    }
    if (ev.receitaTotal < rf14TotalGrupo - 0.01) {
      return { status: 'failed', message: 'Receita eventoRecentes baixa', expected: String(rf14TotalGrupo), actual: String(ev.receitaTotal) };
    }
    return { message: `eventosRecentes receita R$ ${ev.receitaTotal.toFixed(2)}`, expected: String(rf14TotalGrupo), actual: String(ev.receitaTotal) };
  });

  await test({ id: 'RF-15b', category: 'Funcional', name: 'Dashboard BI: porPagamento coerente', requirement: 'RF-15' }, async () => {
    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/fechar`, { token: lifecycle.donoToken });

    const dash = await api<{
      porPagamento: Array<{ forma: string; valor: number }>;
      resumo: { receitaTotal: number };
    }>('GET', `/api/cervejaria/dashboard?ano=${rf14Ano}&mes=${rf14Mes}`, { token: lifecycle.donoToken });

    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });

    if (dash.status !== 200) return { status: 'failed', message: `Dashboard BI HTTP ${dash.status}`, actual: String(dash.status) };
    const pagTotal = dash.data.porPagamento.reduce((s, p) => s + p.valor, 0);
    if (dash.data.resumo.receitaTotal < rf14TotalGrupo - 0.01) {
      return { status: 'failed', message: 'receitaTotal mensal baixa', expected: `>=${rf14TotalGrupo}`, actual: String(dash.data.resumo.receitaTotal) };
    }
    if (Math.abs(pagTotal - dash.data.resumo.receitaTotal) > 0.01) {
      return { status: 'failed', message: 'porPagamento mensal diverge', expected: String(dash.data.resumo.receitaTotal), actual: String(pagTotal) };
    }
    const dinheiro = dash.data.porPagamento.find((p) => p.forma === 'DINHEIRO');
    const pix = dash.data.porPagamento.find((p) => p.forma === 'PIX');
    if (!dinheiro || !pix) {
      return { status: 'failed', message: 'Formas do grupo ausentes no BI', expected: 'DINHEIRO+PIX', actual: dash.data.porPagamento.map((p) => p.forma).join(',') };
    }
    return { message: 'BI porPagamento OK', expected: String(dash.data.resumo.receitaTotal), actual: String(pagTotal) };
  });

  await test({ id: 'RF-17', category: 'Funcional', name: 'Dashboard BI: só eventos FECHADOS', requirement: 'RF-15' }, async () => {
    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });

    const dashAberto = await api<{ resumo: { receitaTotal: number } }>(
      'GET',
      `/api/cervejaria/dashboard?ano=${rf14Ano}&mes=${rf14Mes}`,
      { token: lifecycle.donoToken },
    );
    if (dashAberto.status !== 200) {
      return { status: 'failed', message: `Dashboard BI (evento aberto) HTTP ${dashAberto.status}`, actual: String(dashAberto.status) };
    }

    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/fechar`, { token: lifecycle.donoToken });

    const dashFechado = await api<{ resumo: { receitaTotal: number } }>(
      'GET',
      `/api/cervejaria/dashboard?ano=${rf14Ano}&mes=${rf14Mes}`,
      { token: lifecycle.donoToken },
    );
    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });

    if (dashFechado.status !== 200) {
      return { status: 'failed', message: `Dashboard BI (evento fechado) HTTP ${dashFechado.status}`, actual: String(dashFechado.status) };
    }

    const delta = dashFechado.data.resumo.receitaTotal - dashAberto.data.resumo.receitaTotal;
    if (delta < rf14TotalGrupo - 0.01) {
      return {
        status: 'failed',
        message: 'BI contou comandas antes do evento ser fechado',
        expected: `delta >= ${rf14TotalGrupo}`,
        actual: String(delta),
      };
    }
    return {
      message: `delta receita R$ ${delta.toFixed(2)} após fechar evento`,
      expected: `>=${rf14TotalGrupo}`,
      actual: String(delta),
    };
  });

  console.log('\n=== FUNCIONAL (venda avulsa) ===');
  let vaComandaId = '';
  let vaTotal = 0;
  let vaReceitaAvulsaBefore = 0;
  let vaVendasAvulsasBefore = 0;
  let vaRankingMlBefore = 0;
  let vaCrmGastoBefore = 0;

  await test({ id: 'RF-VA-01', category: 'Funcional', name: 'Venda avulsa: FECHADA + receita no dashboard', requirement: 'RF-VA' }, async () => {
    const dashBefore = await api<{ resumo: { receitaAvulsa: number; vendasAvulsas: number; valorFechado: number } }>(
      'GET',
      `/api/eventos/${func.eventoId}/dashboard`,
      { token: func.donoToken },
    );
    if (dashBefore.status !== 200) {
      return { status: 'failed', message: `Dashboard HTTP ${dashBefore.status}`, actual: String(dashBefore.status) };
    }
    vaReceitaAvulsaBefore = dashBefore.data.resumo.receitaAvulsa;
    vaVendasAvulsasBefore = dashBefore.data.resumo.vendasAvulsas;
    const valorFechadoBefore = dashBefore.data.resumo.valorFechado;

    const venda = await api<{ id: string; status: string; tipo: string; total: string | number }>(
      'POST',
      '/api/vendas-avulsas',
      {
        token: func.atendenteTokens[0],
        body: {
          eventoId: func.eventoId,
          itens: [chopeItemBody(func.produtoId, func.tapId, 500)],
          pagamentos: [{ forma: 'PIX', valor: 12 }],
        },
      },
    );

    if (venda.status !== 201) {
      return { status: 'failed', message: `Venda avulsa HTTP ${venda.status}`, actual: JSON.stringify(venda.data) };
    }
    if (venda.data.status !== 'FECHADA' || venda.data.tipo !== 'AVULSA') {
      return {
        status: 'failed',
        message: 'Comanda avulsa deveria FECHADA/AVULSA',
        expected: 'FECHADA/AVULSA',
        actual: `${venda.data.status}/${venda.data.tipo}`,
      };
    }

    vaComandaId = venda.data.id;
    vaTotal = Number(venda.data.total);

    const dashAfter = await api<{ resumo: { receitaAvulsa: number; vendasAvulsas: number; valorFechado: number } }>(
      'GET',
      `/api/eventos/${func.eventoId}/dashboard`,
      { token: func.donoToken },
    );
    if (dashAfter.status !== 200) {
      return { status: 'failed', message: `Dashboard pós-venda HTTP ${dashAfter.status}`, actual: String(dashAfter.status) };
    }
    if (dashAfter.data.resumo.receitaAvulsa < vaReceitaAvulsaBefore + vaTotal - 0.01) {
      return {
        status: 'failed',
        message: 'receitaAvulsa não incluiu venda avulsa',
        expected: String(vaReceitaAvulsaBefore + vaTotal),
        actual: String(dashAfter.data.resumo.receitaAvulsa),
      };
    }
    if (dashAfter.data.resumo.vendasAvulsas < vaVendasAvulsasBefore + 1) {
      return {
        status: 'failed',
        message: 'vendasAvulsas não incrementou',
        expected: String(vaVendasAvulsasBefore + 1),
        actual: String(dashAfter.data.resumo.vendasAvulsas),
      };
    }
    if (Math.abs(dashAfter.data.resumo.valorFechado - valorFechadoBefore) > 0.01) {
      return {
        status: 'failed',
        message: 'valorFechado não deveria incluir venda avulsa',
        expected: String(valorFechadoBefore),
        actual: String(dashAfter.data.resumo.valorFechado),
      };
    }
    return { message: `Venda avulsa R$ ${vaTotal.toFixed(2)}`, expected: 'FECHADA', actual: venda.data.status };
  });

  await test({ id: 'RF-VA-02', category: 'Funcional', name: 'Venda avulsa: não entra no ranking', requirement: 'RF-VA' }, async () => {
    const rankBefore = await api<{ ranking: Array<{ totalMl: number }> }>(
      'GET',
      `/api/ranking/evento/${func.eventoId}`,
      { token: func.donoToken },
    );
    if (rankBefore.status !== 200) {
      return { status: 'failed', message: `Ranking HTTP ${rankBefore.status}`, actual: String(rankBefore.status) };
    }
    vaRankingMlBefore = rankBefore.data.ranking.reduce((s, r) => s + r.totalMl, 0);

    const venda = await api('POST', '/api/vendas-avulsas', {
      token: func.atendenteTokens[0],
      body: {
        eventoId: func.eventoId,
        itens: [chopeItemBody(func.produtoId, func.tapId, 500)],
        pagamentos: [{ forma: 'DINHEIRO', valor: 12 }],
      },
    });
    if (venda.status !== 201) {
      return { status: 'failed', message: `Venda avulsa HTTP ${venda.status}`, actual: String(venda.status) };
    }

    const rankAfter = await api<{ ranking: Array<{ totalMl: number }> }>(
      'GET',
      `/api/ranking/evento/${func.eventoId}`,
      { token: func.donoToken },
    );
    const mlAfter = rankAfter.data?.ranking.reduce((s, r) => s + r.totalMl, 0) ?? 0;
    if (Math.abs(mlAfter - vaRankingMlBefore) > 0.01) {
      return {
        status: 'failed',
        message: 'Ranking mudou após venda avulsa',
        expected: String(vaRankingMlBefore),
        actual: String(mlAfter),
      };
    }
    return { message: 'Ranking inalterado', expected: String(vaRankingMlBefore), actual: String(mlAfter) };
  });

  await test({ id: 'RF-VA-03', category: 'Funcional', name: 'Venda avulsa: sem CRM + cliente sistema oculto', requirement: 'RF-VA' }, async () => {
    const comanda = await api<{ clienteId: string }>('GET', `/api/comandas/${funcComandaId}`, { token: func.donoToken });
    if (comanda.status !== 200) {
      return { status: 'failed', message: 'Comanda RF-05 não encontrada', actual: String(comanda.status) };
    }

    const crmBefore = await api<{ items: Array<{ id: string; totalGasto: number }> }>(
      'GET',
      '/api/clientes?limit=100',
      { token: func.donoToken },
    );
    const clienteBefore = crmBefore.data?.items.find((c) => c.id === comanda.data.clienteId);
    vaCrmGastoBefore = clienteBefore?.totalGasto ?? 0;

    const venda = await api('POST', '/api/vendas-avulsas', {
      token: func.atendenteTokens[0],
      body: {
        eventoId: func.eventoId,
        itens: [chopeItemBody(func.produtoId, func.tapId, 300)],
        pagamentos: [{ forma: 'PIX', valor: 8 }],
      },
    });
    if (venda.status !== 201) {
      return { status: 'failed', message: `Venda avulsa HTTP ${venda.status}`, actual: String(venda.status) };
    }

    const crmAfter = await api<{ items: Array<{ id: string; nome: string; totalGasto: number }> }>(
      'GET',
      '/api/clientes?limit=100',
      { token: func.donoToken },
    );
    const clienteAfter = crmAfter.data?.items.find((c) => c.id === comanda.data.clienteId);
    if ((clienteAfter?.totalGasto ?? 0) > vaCrmGastoBefore + 0.01) {
      return {
        status: 'failed',
        message: 'CRM incrementou após venda avulsa',
        expected: String(vaCrmGastoBefore),
        actual: String(clienteAfter?.totalGasto),
      };
    }
    const sistema = crmAfter.data?.items.find((c) => c.nome === 'Consumidor avulso');
    if (sistema) {
      return { status: 'failed', message: 'Cliente sistema visível no CRM', expected: 'oculto', actual: sistema.id };
    }
    return { message: 'CRM OK', expected: String(vaCrmGastoBefore), actual: String(clienteAfter?.totalGasto ?? 0) };
  });

  await test({ id: 'RF-VA-04', category: 'Funcional', name: 'Venda avulsa: receita no BI após fechar evento', requirement: 'RF-VA' }, async () => {
    const now = new Date();
    const mes = now.getUTCMonth() + 1;
    const ano = now.getUTCFullYear();

    await prisma.comanda.deleteMany({ where: { eventoId: func.eventoId, status: 'ABERTA' } });
    await prisma.evento.update({
      where: { id: func.eventoId },
      data: { data: now, status: 'ABERTO' },
    });

    const dashAberto = await api<{ resumo: { receitaTotal: number } }>(
      'GET',
      `/api/cervejaria/dashboard?ano=${ano}&mes=${mes}`,
      { token: func.donoToken },
    );
    const receitaAberto = dashAberto.status === 200 ? dashAberto.data.resumo.receitaTotal : 0;

    await api('PATCH', `/api/eventos/${func.eventoId}/fechar`, { token: func.donoToken });

    const dashFechado = await api<{ resumo: { receitaTotal: number; vendasAvulsas: number; receitaAvulsa: number } }>(
      'GET',
      `/api/cervejaria/dashboard?ano=${ano}&mes=${mes}`,
      { token: func.donoToken },
    );

    await api('PATCH', `/api/eventos/${func.eventoId}/reabrir`, { token: func.donoToken });

    if (dashFechado.status !== 200) {
      return { status: 'failed', message: `BI HTTP ${dashFechado.status}`, actual: String(dashFechado.status) };
    }
    if (dashFechado.data.resumo.receitaTotal <= receitaAberto + 0.01) {
      return {
        status: 'failed',
        message: 'BI não incluiu vendas avulsas após fechar evento',
        expected: `>${receitaAberto}`,
        actual: String(dashFechado.data.resumo.receitaTotal),
      };
    }
    if (dashFechado.data.resumo.vendasAvulsas < 1) {
      return {
        status: 'failed',
        message: 'BI vendasAvulsas deveria ser >= 1',
        expected: '>=1',
        actual: String(dashFechado.data.resumo.vendasAvulsas),
      };
    }
    if (dashFechado.data.resumo.receitaAvulsa <= 0) {
      return {
        status: 'failed',
        message: 'BI receitaAvulsa deveria ser > 0',
        expected: '>0',
        actual: String(dashFechado.data.resumo.receitaAvulsa),
      };
    }
    return {
      message: `BI receita R$ ${dashFechado.data.resumo.receitaTotal.toFixed(2)}`,
      expected: `>${receitaAberto}`,
      actual: String(dashFechado.data.resumo.receitaTotal),
    };
  });

  await test({ id: 'RF-VA-05', category: 'Funcional', name: 'Venda avulsa: fechar-grupo rejeita avulsa', requirement: 'RF-VA' }, async () => {
    const clienteSistema = await prisma.cliente.findFirst({
      where: { cervejariaId: func.cervejariaId, telefone: '00000000000' },
    });
    if (!clienteSistema) {
      return { status: 'failed', message: 'Cliente sistema ausente (RF-VA-01?)', actual: 'skip' };
    }

    const avulsaAberta = await prisma.comanda.create({
      data: {
        eventoId: func.eventoId,
        clienteId: clienteSistema.id,
        tipo: 'AVULSA',
        status: 'ABERTA',
      },
    });

    await api('POST', `/api/comandas/${avulsaAberta.id}/itens`, {
      token: func.atendenteTokens[0],
      body: chopeItemBody(func.produtoId, func.tapId, 500),
    });

    const c2 = await api<{ id: string }>('POST', '/api/comandas', {
      token: func.atendenteTokens[0],
      body: staffComandaBody(func.eventoId, `Par grupo VA ${Date.now()}`, 44),
    });
    if (c2.status !== 201) {
      await prisma.comanda.delete({ where: { id: avulsaAberta.id } });
      return { status: 'failed', message: 'Setup comanda par falhou', actual: String(c2.status) };
    }
    await api('POST', `/api/comandas/${c2.data.id}/itens`, {
      token: func.atendenteTokens[0],
      body: chopeItemBody(func.produtoId, func.tapId, 500),
    });

    const curAvulsa = await api<{ total: string | number }>('GET', `/api/comandas/${avulsaAberta.id}`, { token: func.donoToken });
    const curC2 = await api<{ total: string | number }>('GET', `/api/comandas/${c2.data.id}`, { token: func.donoToken });
    const total = Number(curAvulsa.data.total) + Number(curC2.data.total);

    const r = await api('POST', '/api/pagamentos/fechar-grupo', {
      token: func.atendenteTokens[0],
      body: {
        comandaIds: [avulsaAberta.id, c2.data.id],
        pagamentos: [{ forma: 'PIX', valor: total }],
      },
    });

    await prisma.comanda.deleteMany({ where: { id: { in: [avulsaAberta.id, c2.data.id] } } });

    return expectStatus(r.status, 400, 'Grupo com venda avulsa rejeitado');
  });

  await test({ id: 'RF-VA-06', category: 'Funcional', name: 'Venda avulsa: métricas no resumo executivo e fluxo', requirement: 'RF-VA' }, async () => {
    await prisma.comanda.deleteMany({ where: { eventoId: func.eventoId, status: 'ABERTA' } });

    const fechar = await api('PATCH', `/api/eventos/${func.eventoId}/fechar`, { token: func.donoToken });
    if (fechar.status !== 200) {
      return { status: 'failed', message: 'Falha ao fechar evento', actual: String(fechar.status) };
    }

    const resumo = await api<{
      resumo: { vendasAvulsas: number; receitaAvulsa: number; comandasRegulares: number };
      fluxoPorIntervalo: Array<{ fechadoAvulsa: number; comandasAvulsas: number }>;
    }>('GET', `/api/eventos/${func.eventoId}/resumo-executivo`, { token: func.donoToken });

    await api('PATCH', `/api/eventos/${func.eventoId}/reabrir`, { token: func.donoToken });

    if (resumo.status !== 200) {
      return { status: 'failed', message: `Resumo HTTP ${resumo.status}`, actual: String(resumo.status) };
    }
    if (resumo.data.resumo.vendasAvulsas < 3) {
      return {
        status: 'failed',
        message: 'Resumo vendasAvulsas insuficiente',
        expected: '>=3',
        actual: String(resumo.data.resumo.vendasAvulsas),
      };
    }
    if (resumo.data.resumo.receitaAvulsa <= 0) {
      return {
        status: 'failed',
        message: 'Resumo receitaAvulsa deveria ser > 0',
        expected: '>0',
        actual: String(resumo.data.resumo.receitaAvulsa),
      };
    }
    const temBucketAvulsa = resumo.data.fluxoPorIntervalo.some((b) => b.fechadoAvulsa > 0);
    if (!temBucketAvulsa) {
      return { status: 'failed', message: 'fluxoPorIntervalo sem fechadoAvulsa', expected: 'bucket>0', actual: '0' };
    }
    return {
      message: `${resumo.data.resumo.vendasAvulsas} avulsas · R$ ${resumo.data.resumo.receitaAvulsa.toFixed(2)}`,
      expected: '>=3 avulsas',
      actual: String(resumo.data.resumo.vendasAvulsas),
    };
  });

  console.log('\n=== FUNCIONAL (catálogo / evento) ===');
  await test({ id: 'RF-02a', category: 'Funcional', name: 'Criar produto sem preço → 400', requirement: 'RF-02' }, async () => {
    const r = await api('POST', '/api/produtos', { token: cat.donoToken, body: { nome: 'SemPreco', precos: [] } });
    return expectStatus(r.status, 400, 'Validação de preço');
  });
  let novoProdutoId = '';
  await test({ id: 'RF-02b', category: 'Funcional', name: 'Criar/excluir produto', requirement: 'RF-02' }, async () => {
    const c = await api<{ id: string }>('POST', '/api/produtos', { token: cat.donoToken, body: { nome: `Del ${Date.now()}`, tipo: 'BEBIDA', formato: 'LATA', precos: [{ volumeMl: 350, preco: 7 }] } });
    if (c.status !== 201) return { status: 'failed', message: `Criação falhou HTTP ${c.status}`, actual: String(c.status) };
    novoProdutoId = c.data.id;
    const d = await api('DELETE', `/api/produtos/${novoProdutoId}`, { token: cat.donoToken });
    return expectStatus(d.status, 204, 'Produto sem vínculo excluído');
  });
  await test({ id: 'RF-03a', category: 'Funcional', name: 'Tap com número duplicado → 409', requirement: 'RF-03' }, async () => {
    const r = await api('POST', '/api/taps', {
      token: cat.donoToken,
      body: { numero: 1, nome: 'Dup', trailerId: cat.trailerId, produtoId: cat.produtoId },
    });
    return expectStatus(r.status, 409, 'Número de tap único por trailer');
  });
  await test({ id: 'RF-10', category: 'Funcional', name: 'Criar usuário com e-mail duplicado → 409', requirement: 'RF-10' }, async () => {
    const r = await api('POST', '/api/usuarios', { token: cat.donoToken, body: { nome: 'Dup', email: cat.donoEmail, senha: '123456' } });
    return expectStatus(r.status, 409, 'E-mail único');
  });

  await test({ id: 'RF-04', category: 'Funcional', name: 'Evento: fechar → resumo → reabrir', requirement: 'RF-04' }, async () => {
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });
    const fechar = await api('PATCH', `/api/eventos/${lifecycle.eventoId}/fechar`, { token: lifecycle.donoToken });
    if (fechar.status !== 200) return { status: 'failed', message: `Fechar falhou HTTP ${fechar.status}`, actual: String(fechar.status) };
    const resumo = await api('GET', `/api/eventos/${lifecycle.eventoId}/resumo-executivo`, { token: lifecycle.donoToken });
    if (resumo.status !== 200) return { status: 'failed', message: `Resumo (FECHADO) HTTP ${resumo.status}`, expected: '200', actual: String(resumo.status) };
    const reabrir = await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });
    return expectStatus(reabrir.status, 200, 'Ciclo evento OK (fechar/resumo/reabrir)');
  });

  const rf04Hoje = new Date().toISOString().slice(0, 10);
  await limparEventosTrailerNoDia(cat.cervejariaId, cat.trailerId, rf04Hoje);

  await test({ id: 'RF-04a', category: 'Funcional', name: 'Reverter sessão de série sem vendas → agendado', requirement: 'RF-04' }, async () => {
    const stamp = Date.now();
    const slot = stamp % 10;
    const hStart = 5 + slot;
    const horaInicio = `${String(hStart).padStart(2, '0')}:00`;
    const horaFim = `${String(hStart + 1).padStart(2, '0')}:00`;
    const diaSemana = new Date().getDay();

    const serie = await api<{ id: string }>('POST', '/api/eventos', {
      token: cat.donoToken,
      body: {
        nome: `QA Revert Serie ${stamp}`,
        local: 'Revert Local',
        horaInicio,
        horaFim,
        recorrencia: 'SEMANAL',
        diaSemana,
        trailerId: cat.trailerId,
      },
    });
    if (serie.status !== 201 || !serie.data?.id) {
      return { status: 'failed', message: 'Setup RF-04a: série não criada', actual: String(serie.status) };
    }

    const iniciar = await api<{ id: string }>('POST', `/api/eventos/${serie.data.id}/iniciar`, {
      token: cat.donoToken,
    });
    if (![200, 201].includes(iniciar.status) || !iniciar.data?.id) {
      return { status: 'failed', message: 'Setup RF-04a: iniciar sessão falhou', actual: String(iniciar.status) };
    }

    const revert = await api<{ modo: string; mensagem: string }>(
      'POST',
      `/api/eventos/${iniciar.data.id}/reverter-para-agendado`,
      { token: cat.donoToken },
    );
    if (revert.status !== 200) {
      return { status: 'failed', message: 'Reverter sessão falhou', expected: '200', actual: String(revert.status) };
    }
    if (revert.data?.modo !== 'serie') {
      return { status: 'failed', message: 'Modo deveria ser serie', expected: 'serie', actual: String(revert.data?.modo) };
    }

    const list = await api<{ series: Array<{ id: string }>; sessoes: Array<{ id: string; serieId?: string | null }> }>(
      'GET',
      '/api/eventos',
      { token: cat.donoToken },
    );
    const serieStillThere = list.data?.series.some((s) => s.id === serie.data!.id);
    const sessaoRemovida = !(list.data?.sessoes ?? []).some((s) => s.id === iniciar.data!.id);
    if (!serieStillThere || !sessaoRemovida) {
      return {
        status: 'failed',
        message: 'Série deveria permanecer e sessão sumir',
        expected: 'serie ok / sessao gone',
        actual: `${serieStillThere}/${sessaoRemovida}`,
      };
    }

    await prisma.evento.delete({ where: { id: serie.data.id } });
    return { message: 'Sessão revertida; compromisso volta ao agendado', expected: '200', actual: 'ok' };
  });

  await test({ id: 'RF-04b', category: 'Funcional', name: 'Reverter evento avulso aberto sem vendas', requirement: 'RF-04' }, async () => {
    const stamp = Date.now();
    const slot = (stamp % 10) + 10;
    const horaInicio = `${String(slot).padStart(2, '0')}:00`;
    const horaFim = `${String(slot + 1).padStart(2, '0')}:00`;
    const today = new Date().toISOString().slice(0, 10);

    const created = await api<{ id: string }>('POST', '/api/eventos', {
      token: cat.donoToken,
      body: {
        nome: `QA Revert Avulso ${stamp}`,
        local: 'Revert Local',
        data: today,
        horaInicio,
        horaFim,
        abrirAgora: true,
        trailerId: cat.trailerId,
      },
    });
    if (created.status !== 201 || !created.data?.id) {
      return { status: 'failed', message: 'Setup RF-04b: evento não criado', actual: String(created.status) };
    }

    const revert = await api<{ modo: string }>('POST', `/api/eventos/${created.data.id}/reverter-para-agendado`, {
      token: cat.donoToken,
    });
    if (revert.status !== 200) {
      return { status: 'failed', message: 'Reverter avulso falhou', expected: '200', actual: String(revert.status) };
    }
    if (revert.data?.modo !== 'avulso') {
      return { status: 'failed', message: 'Modo deveria ser avulso', expected: 'avulso', actual: String(revert.data?.modo) };
    }

    const getOne = await api('GET', `/api/eventos/${created.data.id}`, { token: cat.donoToken });
    return expectStatus(getOne.status, 404, 'Evento avulso removido após revert');
  });

  await test({ id: 'RF-04c', category: 'Funcional', name: 'Reverter bloqueado com venda registrada → 409', requirement: 'RF-04' }, async () => {
    const stamp = Date.now();
    const slot = (stamp % 10) + 15;
    const horaInicio = `${String(slot).padStart(2, '0')}:00`;
    const horaFim = `${String(slot + 1).padStart(2, '0')}:00`;
    const today = new Date().toISOString().slice(0, 10);

    const created = await api<{ id: string }>('POST', '/api/eventos', {
      token: cat.donoToken,
      body: {
        nome: `QA Revert Block ${stamp}`,
        local: 'Revert Local',
        data: today,
        horaInicio,
        horaFim,
        abrirAgora: true,
        trailerId: cat.trailerId,
      },
    });
    if (created.status !== 201 || !created.data?.id) {
      return { status: 'failed', message: 'Setup RF-04c: evento não criado', actual: String(created.status) };
    }

    const comanda = await api<{ id: string }>('POST', '/api/comandas', {
      token: cat.atendenteTokens[0],
      body: staffComandaBody(created.data.id, `RevertBlock ${stamp}`, 70),
    });
    if (comanda.status !== 201 || !comanda.data?.id) {
      return { status: 'failed', message: 'Setup RF-04c: comanda não criada', actual: String(comanda.status) };
    }

    const item = await api('POST', `/api/comandas/${comanda.data.id}/itens`, {
      token: cat.atendenteTokens[0],
      body: chopeItemBody(cat.produtoId, cat.tapId, cat.volumeMl),
    });
    if (item.status !== 201) {
      return { status: 'failed', message: 'Setup RF-04c: item não adicionado', actual: String(item.status) };
    }

    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${comanda.data.id}`, {
      token: cat.donoToken,
    });
    const total = Number(cur.data?.total ?? 0);
    const close = await api('POST', `/api/pagamentos/comandas/${comanda.data.id}/fechar`, {
      token: cat.atendenteTokens[0],
      body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] },
    });
    if (close.status !== 200) {
      return { status: 'failed', message: 'Setup RF-04c: fechar comanda falhou', actual: String(close.status) };
    }

    const revert = await api('POST', `/api/eventos/${created.data.id}/reverter-para-agendado`, {
      token: cat.donoToken,
    });
    await prisma.evento.delete({ where: { id: created.data.id } }).catch(() => undefined);
    return expectStatus(revert.status, 409, 'Revert bloqueado com venda');
  });

  await test({ id: 'RF-04d', category: 'Funcional', name: 'Reverter cancela comanda vazia e conclui', requirement: 'RF-04' }, async () => {
    const stamp = Date.now();
    const slot = (stamp % 10) + 20;
    const horaInicio = `${String(slot).padStart(2, '0')}:00`;
    const horaFim = `${String(slot + 1).padStart(2, '0')}:00`;
    const today = new Date().toISOString().slice(0, 10);

    const created = await api<{ id: string }>('POST', '/api/eventos', {
      token: cat.donoToken,
      body: {
        nome: `QA Revert Empty ${stamp}`,
        local: 'Revert Local',
        data: today,
        horaInicio,
        horaFim,
        abrirAgora: true,
        trailerId: cat.trailerId,
      },
    });
    if (created.status !== 201 || !created.data?.id) {
      return { status: 'failed', message: 'Setup RF-04d: evento não criado', actual: String(created.status) };
    }

    const comanda = await api<{ id: string }>('POST', '/api/comandas', {
      token: cat.atendenteTokens[0],
      body: staffComandaBody(created.data.id, `RevertEmpty ${stamp}`, 71),
    });
    if (comanda.status !== 201 || !comanda.data?.id) {
      await prisma.evento.delete({ where: { id: created.data.id } }).catch(() => undefined);
      return { status: 'failed', message: 'Setup RF-04d: comanda não criada', actual: String(comanda.status) };
    }

    const revert = await api('POST', `/api/eventos/${created.data.id}/reverter-para-agendado`, {
      token: cat.donoToken,
    });
    if (revert.status !== 200) {
      await prisma.evento.delete({ where: { id: created.data.id } }).catch(() => undefined);
      return { status: 'failed', message: 'Reverter com comanda vazia falhou', expected: '200', actual: String(revert.status) };
    }

    const comandaAfter = await prisma.comanda.findUnique({ where: { id: comanda.data.id } });
    if (comandaAfter && comandaAfter.status !== 'CANCELADA') {
      return {
        status: 'failed',
        message: 'Comanda vazia deveria ser cancelada',
        expected: 'CANCELADA',
        actual: comandaAfter.status,
      };
    }

    return { message: 'Revert OK com comanda vazia auto-cancelada', expected: '200', actual: 'ok' };
  });

  await test({ id: 'RF-09', category: 'Funcional', name: 'Resumo de evento ABERTO negado → 403', requirement: 'RF-09' }, async () => {
    const r = await api('GET', `/api/eventos/${func.eventoId}/resumo-executivo`, { token: func.donoToken });
    return expectStatus(r.status, 403, 'Resumo só para evento encerrado');
  });

  await test({ id: 'RF-11', category: 'Funcional', name: 'Gráfico vendas inclui fechamento fora do horário', requirement: 'RF-11' }, async () => {
    const pastDate = new Date();
    pastDate.setUTCDate(pastDate.getUTCDate() - 7);
    pastDate.setUTCHours(0, 0, 0, 0);

    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { data: pastDate, horaInicio: '18:00', horaFim: '23:45', status: 'ABERTO' },
    });
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });

    const c = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `ChartTest ${Date.now()}`, 11),
    });
    if (c.status !== 201 || !c.data?.id) {
      return { status: 'failed', message: 'Setup RF-11: comanda não criada', actual: String(c.status) };
    }

    const item = await api('POST', `/api/comandas/${c.data.id}/itens`, {
      token: lifecycle.atendenteTokens[0],
      body: chopeItemBody(lifecycle.produtoId, lifecycle.tapId, lifecycle.volumeMl),
    });
    if (item.status !== 201) {
      return { status: 'failed', message: 'Setup RF-11: item não adicionado', actual: String(item.status) };
    }

    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${c.data.id}`, { token: lifecycle.donoToken });
    const total = Number(cur.data?.total ?? 0);
    const close = await api('POST', `/api/pagamentos/comandas/${c.data.id}/fechar`, {
      token: lifecycle.atendenteTokens[0],
      body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] },
    });
    if (close.status !== 200) {
      return { status: 'failed', message: 'Setup RF-11: fechar comanda falhou', actual: String(close.status) };
    }

    const fecharEvento = await api('PATCH', `/api/eventos/${lifecycle.eventoId}/fechar`, { token: lifecycle.donoToken });
    if (fecharEvento.status !== 200) {
      return { status: 'failed', message: 'Setup RF-11: fechar evento falhou', actual: String(fecharEvento.status) };
    }

    const resumo = await api<{
      resumo: { receitaTotal: number; comandasAtendidas: number };
      vendasPorIntervalo: Array<{ receita: number; comandas: number }>;
    }>('GET', `/api/eventos/${lifecycle.eventoId}/resumo-executivo`, { token: lifecycle.donoToken });

    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });

    if (resumo.status !== 200 || !resumo.data) {
      return { status: 'failed', message: 'Resumo HTTP inválido', actual: String(resumo.status) };
    }

    const chartTotal = resumo.data.vendasPorIntervalo.reduce((s, b) => s + b.receita, 0);
    const chartComandas = resumo.data.vendasPorIntervalo.reduce((s, b) => s + b.comandas, 0);
    const { receitaTotal, comandasAtendidas } = resumo.data.resumo;

    if (Math.abs(chartTotal - receitaTotal) > 0.01) {
      return {
        status: 'failed',
        message: 'Gráfico não bate com receita total',
        expected: String(receitaTotal),
        actual: String(chartTotal),
      };
    }
    if (chartComandas !== comandasAtendidas || receitaTotal <= 0) {
      return {
        status: 'failed',
        message: 'Gráfico sem vendas registradas',
        expected: `receita>0 comandas=${comandasAtendidas}`,
        actual: `receita=${chartTotal} comandas=${chartComandas}`,
      };
    }

    return {
      message: `Gráfico OK (R$ ${receitaTotal.toFixed(2)}, ${comandasAtendidas} comanda(s))`,
      expected: String(receitaTotal),
      actual: String(chartTotal),
    };
  });

  await test({ id: 'RF-12', category: 'Funcional', name: 'Fluxo pedido/fechado/aberto no resumo', requirement: 'RF-12' }, async () => {
    const pastDate = new Date();
    pastDate.setUTCDate(pastDate.getUTCDate() - 7);
    pastDate.setUTCHours(0, 0, 0, 0);

    await prisma.evento.update({
      where: { id: lifecycle.eventoId },
      data: { data: pastDate, horaInicio: '18:00', horaFim: '23:45', status: 'ABERTO' },
    });
    await prisma.comanda.deleteMany({ where: { eventoId: lifecycle.eventoId } });

    const c = await api<{ id: string }>('POST', '/api/comandas', {
      token: lifecycle.atendenteTokens[0],
      body: staffComandaBody(lifecycle.eventoId, `FluxoTest ${Date.now()}`, 12),
    });
    if (c.status !== 201 || !c.data?.id) {
      return { status: 'failed', message: 'Setup RF-12: comanda não criada', actual: String(c.status) };
    }

    const item = await api('POST', `/api/comandas/${c.data.id}/itens`, {
      token: lifecycle.atendenteTokens[0],
      body: chopeItemBody(lifecycle.produtoId, lifecycle.tapId, lifecycle.volumeMl),
    });
    if (item.status !== 201) {
      return { status: 'failed', message: 'Setup RF-12: item não adicionado', actual: String(item.status) };
    }

    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${c.data.id}`, { token: lifecycle.donoToken });
    const total = Number(cur.data?.total ?? 0);
    const close = await api('POST', `/api/pagamentos/comandas/${c.data.id}/fechar`, {
      token: lifecycle.atendenteTokens[0],
      body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] },
    });
    if (close.status !== 200) {
      return { status: 'failed', message: 'Setup RF-12: fechar comanda falhou', actual: String(close.status) };
    }

    const fecharEvento = await api('PATCH', `/api/eventos/${lifecycle.eventoId}/fechar`, { token: lifecycle.donoToken });
    if (fecharEvento.status !== 200) {
      return { status: 'failed', message: 'Setup RF-12: fechar evento falhou', actual: String(fecharEvento.status) };
    }

    const resumo = await api<{
      resumo: { receitaTotal: number };
      fluxoPorIntervalo: Array<{ pedido: number; fechado: number; aberto: number; itens: number }>;
    }>('GET', `/api/eventos/${lifecycle.eventoId}/resumo-executivo`, { token: lifecycle.donoToken });

    await api('PATCH', `/api/eventos/${lifecycle.eventoId}/reabrir`, { token: lifecycle.donoToken });

    if (resumo.status !== 200 || !resumo.data?.fluxoPorIntervalo?.length) {
      return { status: 'failed', message: 'fluxoPorIntervalo ausente', actual: String(resumo.status) };
    }

    const { receitaTotal } = resumo.data.resumo;
    const fluxo = resumo.data.fluxoPorIntervalo;
    const fechadoTotal = fluxo.reduce((s, b) => s + b.fechado, 0);
    const pedidoTotal = fluxo.reduce((s, b) => s + b.pedido, 0);
    const itensTotal = fluxo.reduce((s, b) => s + b.itens, 0);

    if (Math.abs(fechadoTotal - receitaTotal) > 0.01) {
      return {
        status: 'failed',
        message: 'Fluxo fechado não bate com receita',
        expected: String(receitaTotal),
        actual: String(fechadoTotal),
      };
    }
    if (pedidoTotal <= 0 || itensTotal <= 0) {
      return {
        status: 'failed',
        message: 'Fluxo pedido vazio',
        expected: 'pedido>0',
        actual: String(pedidoTotal),
      };
    }

    return {
      message: `Fluxo OK (pedido R$ ${pedidoTotal.toFixed(2)}, fechado R$ ${fechadoTotal.toFixed(2)})`,
      expected: String(receitaTotal),
      actual: String(fechadoTotal),
    };
  });

  console.log('\n=== MULTI-TRAILER ===');
  await test({ id: 'MT-01', category: 'Multi-trailer', name: 'GET /trailers/operacional lista trailers com evento aberto', requirement: 'MT-01' }, async () => {
    const r = await api<Array<{ id: string; nome: string; eventoAberto: { id: string } | null }>>('GET', '/api/trailers/operacional', { token: mt.donoToken });
    if (r.status !== 200) return { status: 'failed', message: `HTTP ${r.status}`, actual: String(r.status) };
    if (r.data.length !== 2) return { status: 'failed', message: `Esperado 2 trailers, veio ${r.data.length}`, expected: '2', actual: String(r.data.length) };
    const mapped = new Map(r.data.map((t) => [t.id, t.eventoAberto?.id ?? null]));
    if (mapped.get(trailerA.id) !== trailerA.eventoId || mapped.get(trailerB.id) !== trailerB.eventoId) {
      return { status: 'failed', message: 'eventoAberto não mapeado corretamente por trailer', expected: 'match seed', actual: 'mismatch' };
    }
    return { message: '2 trailers com eventos ao vivo mapeados', expected: '2/2', actual: '2/2' };
  });

  await test({ id: 'MT-02', category: 'Multi-trailer', name: 'Dois eventos ABERTOS simultâneos (trailers diferentes)', requirement: 'MT-02' }, async () => {
    const r = await api<Array<{ id: string; trailerId: string }>>('GET', '/api/eventos/ativos', { token: mt.donoToken });
    if (r.status !== 200) return { status: 'failed', message: `HTTP ${r.status}`, actual: String(r.status) };
    const ids = r.data.map((e) => e.id).sort();
    const expected = [trailerA.eventoId, trailerB.eventoId].sort();
    if (ids.length !== 2 || ids[0] !== expected[0] || ids[1] !== expected[1]) {
      return { status: 'failed', message: 'Eventos ativos não batem com seed multi-trailer', expected: expected.join(','), actual: ids.join(',') };
    }
    return { message: '2 eventos abertos em paralelo', expected: '2', actual: '2' };
  });

  await test({ id: 'MT-03', category: 'Multi-trailer', name: 'GET /eventos/ativos?trailerId= filtra por trailer', requirement: 'MT-03' }, async () => {
    const r = await api<Array<{ id: string; trailerId: string }>>('GET', `/api/eventos/ativos?trailerId=${trailerA.id}`, { token: mt.donoToken });
    if (r.status !== 200) return { status: 'failed', message: `HTTP ${r.status}`, actual: String(r.status) };
    if (r.data.length !== 1 || r.data[0].id !== trailerA.eventoId || r.data[0].trailerId !== trailerA.id) {
      return { status: 'failed', message: 'Filtro trailerId não retornou só evento A', expected: trailerA.eventoId, actual: r.data.map((e) => e.id).join(',') };
    }
    return { message: 'Filtro por trailer OK', expected: trailerA.eventoId, actual: r.data[0].id };
  });

  await test({ id: 'MT-04', category: 'Multi-trailer', name: 'Comandas isoladas por evento/trailer', requirement: 'MT-04' }, async () => {
    const rA = await api<Array<{ id: string }>>('GET', `/api/comandas/evento/${trailerA.eventoId}`, { token: mt.donoToken });
    const rB = await api<Array<{ id: string }>>('GET', `/api/comandas/evento/${trailerB.eventoId}`, { token: mt.donoToken });
    if (rA.status !== 200 || rB.status !== 200) return { status: 'failed', message: 'Listagem comandas falhou', actual: `${rA.status}/${rB.status}` };
    const idsA = rA.data.map((c) => c.id);
    const idsB = rB.data.map((c) => c.id);
    if (!idsA.includes(trailerA.comandaId) || idsB.includes(trailerA.comandaId)) {
      return { status: 'failed', message: 'Comanda do trailer A vazou para listagem B', expected: 'isolado', actual: 'vazou' };
    }
    if (!idsB.includes(trailerB.comandaId) || idsA.includes(trailerB.comandaId)) {
      return { status: 'failed', message: 'Comanda do trailer B vazou para listagem A', expected: 'isolado', actual: 'vazou' };
    }
    return { message: 'Comandas escopadas por evento/trailer', expected: 'isolado', actual: 'isolado' };
  });

  await test({ id: 'MT-05', category: 'Multi-trailer', name: 'Ranking escopado por evento', requirement: 'MT-05' }, async () => {
    await api('POST', `/api/comandas/${trailerA.comandaId}/itens`, {
      token: mt.atendenteTokens[0],
      body: chopeItemBody(mt.produtoId, trailerA.tapId, mt.volumeMl),
    });
    const rankA = await api<{ ranking: Array<{ totalMl: number }> }>('GET', `/api/ranking/evento/${trailerA.eventoId}`, { token: mt.donoToken });
    const rankB = await api<{ ranking: Array<{ totalMl: number }> }>('GET', `/api/ranking/evento/${trailerB.eventoId}`, { token: mt.donoToken });
    if (rankA.status !== 200 || rankB.status !== 200) return { status: 'failed', message: 'Ranking falhou', actual: `${rankA.status}/${rankB.status}` };
    const mlA = rankA.data.ranking.reduce((s, x) => s + x.totalMl, 0);
    const mlB = rankB.data.ranking.reduce((s, x) => s + x.totalMl, 0);
    if (mlA < mt.volumeMl) return { status: 'failed', message: `Ranking A sem consumo (${mlA}ml)`, expected: `>=${mt.volumeMl}`, actual: String(mlA) };
    if (mlB > 0) return { status: 'failed', message: `Ranking B deveria estar vazio (${mlB}ml)`, expected: '0', actual: String(mlB) };
    return { message: `Ranking A=${mlA}ml · Ranking B=${mlB}ml`, expected: 'isolado', actual: 'isolado' };
  });

  let rsSerieAId = '';
  let rsSerieBId = '';
  let rsClienteId = '';
  await test({ id: 'RS-01', category: 'Ranking', name: 'Ranking de série agrega sessões da agenda', requirement: 'RS-01' }, async () => {
    const stamp = Date.now();
    const oldSeries = await prisma.evento.findMany({
      where: {
        cervejariaId: func.cervejariaId,
        recorrencia: 'SEMANAL',
        nome: { startsWith: 'QA Ranking Serie' },
      },
      select: { id: true },
    });
    if (oldSeries.length) {
      await prisma.evento.deleteMany({ where: { serieId: { in: oldSeries.map((s) => s.id) } } });
      await prisma.evento.deleteMany({ where: { id: { in: oldSeries.map((s) => s.id) } } });
    }

    const slot = stamp % 12;
    const hStart = 8 + slot;
    const hEnd = hStart + 1;
    const horaInicio = `${String(hStart).padStart(2, '0')}:00`;
    const horaFim = `${String(hEnd).padStart(2, '0')}:00`;
    const diaA = (stamp % 5) + 1;
    const diaB = ((stamp + 2) % 5) + 1;

    const serieA = await api<{ id: string }>('POST', '/api/eventos', {
      token: func.donoToken,
      body: {
        nome: `QA Ranking Serie A ${stamp}`,
        local: 'Itatiaia',
        horaInicio,
        horaFim,
        recorrencia: 'SEMANAL',
        diaSemana: diaA,
        trailerId: func.trailerId,
      },
    });
    const serieB = await api<{ id: string }>('POST', '/api/eventos', {
      token: func.donoToken,
      body: {
        nome: `QA Ranking Serie B ${stamp}`,
        local: 'Igarapé',
        horaInicio,
        horaFim,
        recorrencia: 'SEMANAL',
        diaSemana: diaB,
        trailerId: func.trailerId,
      },
    });
    if (serieA.status !== 201 || serieB.status !== 201) {
      return { status: 'failed', message: 'Falha ao criar séries', actual: `${serieA.status}/${serieB.status}` };
    }
    rsSerieAId = serieA.data.id;
    rsSerieBId = serieB.data.id;

    const cliente = await prisma.cliente.create({
      data: { nome: `QA Ranking Serie ${stamp}`, telefone: `55${String(stamp).slice(-10)}`, cervejariaId: func.cervejariaId },
    });
    rsClienteId = cliente.id;

    const sessaoJul = await prisma.evento.create({
      data: {
        nome: `QA Ranking Serie A ${stamp}`,
        local: 'Itatiaia',
        data: new Date('2026-07-15T12:00:00'),
        horaInicio: '10:00',
        horaFim: '11:00',
        recorrencia: 'NENHUMA',
        serieId: rsSerieAId,
        status: 'FECHADO',
        cervejariaId: func.cervejariaId,
        trailerId: func.trailerId,
      },
    });
    const sessaoAgo = await prisma.evento.create({
      data: {
        nome: 'Sessão Ago',
        local: 'Itatiaia',
        data: new Date('2026-08-15T12:00:00'),
        horaInicio: '10:00',
        horaFim: '11:00',
        recorrencia: 'NENHUMA',
        serieId: rsSerieAId,
        status: 'FECHADO',
        cervejariaId: func.cervejariaId,
        trailerId: func.trailerId,
      },
    });
    const sessaoOutraSerie = await prisma.evento.create({
      data: {
        nome: 'Sessão outra agenda',
        local: 'Igarapé',
        data: new Date('2026-07-15T12:00:00'),
        horaInicio: '10:00',
        horaFim: '11:00',
        recorrencia: 'NENHUMA',
        serieId: rsSerieBId,
        status: 'FECHADO',
        cervejariaId: func.cervejariaId,
        trailerId: func.trailerId,
      },
    });

    // Fixture escreve direto no banco: total precisa acompanhar os itens abaixo (DB-01).
    const comandaJul = await prisma.comanda.create({
      data: { eventoId: sessaoJul.id, clienteId: rsClienteId, tipo: 'COMANDA', status: 'FECHADA', total: 12 },
    });
    const comandaAgo = await prisma.comanda.create({
      data: { eventoId: sessaoAgo.id, clienteId: rsClienteId, tipo: 'COMANDA', status: 'FECHADA', total: 8 },
    });
    const comandaOutra = await prisma.comanda.create({
      data: { eventoId: sessaoOutraSerie.id, clienteId: rsClienteId, tipo: 'COMANDA', status: 'FECHADA', total: 20 },
    });

    await prisma.itemComanda.createMany({
      data: [
        { comandaId: comandaJul.id, produtoId: func.produtoId, tapId: func.tapId, volumeMl: 500, quantidade: 1, precoUnit: 12 },
        { comandaId: comandaAgo.id, produtoId: func.produtoId, tapId: func.tapId, volumeMl: 300, quantidade: 1, precoUnit: 8 },
        { comandaId: comandaOutra.id, produtoId: func.produtoId, tapId: func.tapId, volumeMl: 1000, quantidade: 1, precoUnit: 20 },
      ],
    });

    const geral = await api<{ entries: Array<{ clienteId: string; totalMl: number }> }>(
      'GET',
      `/api/ranking/serie/${rsSerieAId}`,
      { token: func.donoToken },
    );
    if (geral.status !== 200) return { status: 'failed', message: 'Ranking geral falhou', actual: String(geral.status) };
    const entryGeral = geral.data.entries.find((x) => x.clienteId === rsClienteId);
    if (!entryGeral || entryGeral.totalMl !== 800) {
      return {
        status: 'failed',
        message: 'Ranking geral deveria somar jul+ago (800ml)',
        expected: '800',
        actual: String(entryGeral?.totalMl ?? 0),
      };
    }

    const mensal = await api<{ entries: Array<{ totalMl: number }> }>(
      'GET',
      `/api/ranking/serie/${rsSerieAId}?mes=2026-07`,
      { token: func.donoToken },
    );
    if (mensal.status !== 200) return { status: 'failed', message: 'Ranking mensal falhou', actual: String(mensal.status) };
    const mlMensal = mensal.data.entries.reduce((s, x) => s + x.totalMl, 0);
    if (mlMensal !== 500) {
      return { status: 'failed', message: 'Ranking mensal jul/2026 deveria ter 500ml', expected: '500', actual: String(mlMensal) };
    }

    const outraSerie = await api<{ entries: Array<{ totalMl: number }> }>(
      'GET',
      `/api/ranking/serie/${rsSerieBId}`,
      { token: func.donoToken },
    );
    const mlOutra = outraSerie.data?.entries.reduce((s, x) => s + x.totalMl, 0) ?? 0;
    if (mlOutra !== 1000) {
      return { status: 'failed', message: 'Ranking da outra série deveria isolar consumo (1000ml)', expected: '1000', actual: String(mlOutra) };
    }

    return { message: 'Ranking de série agrega sessões corretas e isola agendas', expected: '800/500/1000', actual: 'ok' };
  });

  await test({ id: 'MT-06', category: 'Multi-trailer', name: 'Conflito de horário no mesmo trailer → 409', requirement: 'MT-06' }, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await api('POST', '/api/eventos', {
      token: mt.donoToken,
      body: {
        nome: 'Choque Alpha',
        local: 'Overlap',
        horaInicio: '18:00',
        data: today,
        abrirAgora: false,
        trailerId: trailerA.id,
      },
    });
    return expectStatus(r.status, 409, 'Mesmo trailer/horário rejeitado');
  });

  await test({ id: 'MT-07', category: 'Multi-trailer', name: 'GET /trailers?ativo=true lista 2 trailers operacionais', requirement: 'MT-07' }, async () => {
    const r = await api<Array<{ id: string; ativo: boolean }>>('GET', '/api/trailers?ativo=true', { token: mt.donoToken });
    if (r.status !== 200) return { status: 'failed', message: `HTTP ${r.status}`, actual: String(r.status) };
    const ids = r.data.filter((t) => t.ativo).map((t) => t.id).sort();
    const expected = [trailerA.id, trailerB.id].sort();
    if (ids.length !== 2 || ids[0] !== expected[0] || ids[1] !== expected[1]) {
      return { status: 'failed', message: 'Trailers ativos não batem com seed', expected: expected.join(','), actual: ids.join(',') };
    }
    return { message: '2 trailers ativos disponíveis', expected: '2', actual: '2' };
  });

  console.log('\n=== PORTAL (cliente público) ===');
  const portalSlug = ctx.arena.slug ?? 'qa-arena';
  const portalTrailerId = ctx.arena.trailerId;
  const portalProdutoId = ctx.arena.produtoId;
  const portalTapId = ctx.arena.tapId;
  const portalVolumeMl = ctx.arena.volumeMl;
  const portalStaffToken = ctx.arena.donoToken;

  type PortalClient = Awaited<ReturnType<typeof portalSessao>>;

  await test({ id: 'PORTAL-08', category: 'Portal', name: 'Lookup: telefone cadastrado retorna nome', requirement: 'PORTAL-08' }, async () => {
    const tel = portalTestPhone(93, 1);
    const nome = `QA Lookup OK ${Date.now()}`;
    const created = await portalSessao(portalSlug, portalTrailerId, { nome, telefone: tel });
    if (created.status !== 201) {
      return { status: 'failed', message: 'Setup sessao falhou', actual: String(created.status) };
    }

    const lookup = await api<{ encontrado: boolean; nome?: string }>(
      'GET',
      `/api/public/cervejarias/${portalSlug}/trailers/${portalTrailerId}/cliente-por-telefone?telefone=${encodeURIComponent(tel)}`,
    );
    if (lookup.status !== 200 || !lookup.data.encontrado || lookup.data.nome !== nome) {
      return {
        status: 'failed',
        message: 'Lookup deveria retornar cliente existente',
        expected: nome,
        actual: lookup.data.nome ?? String(lookup.data.encontrado),
      };
    }
    return { message: 'Lookup encontrou cliente', expected: nome, actual: lookup.data.nome };
  });

  await test({ id: 'PORTAL-09', category: 'Portal', name: 'Lookup: telefone inexistente', requirement: 'PORTAL-09' }, async () => {
    const tel = portalTestPhone(93, 2);
    const lookup = await api<{ encontrado: boolean }>(
      'GET',
      `/api/public/cervejarias/${portalSlug}/trailers/${portalTrailerId}/cliente-por-telefone?telefone=${encodeURIComponent(tel)}`,
    );
    if (lookup.status !== 200 || lookup.data.encontrado) {
      return {
        status: 'failed',
        message: 'Lookup deveria retornar encontrado=false',
        expected: 'false',
        actual: String(lookup.data.encontrado),
      };
    }
    return { message: 'Telefone não cadastrado', expected: 'false', actual: 'false' };
  });

  await test({ id: 'PORTAL-10', category: 'Portal', name: 'Lookup: legado sem telefone não aparece', requirement: 'PORTAL-10' }, async () => {
    const tel = portalTestPhone(93, 3);
    await prisma.cliente.create({
      data: {
        nome: `QA Legado Portal ${Date.now()}`,
        telefone: null,
        cervejariaId: ctx.arena.cervejariaId,
        cadastradoVia: 'COMANDA',
      },
    });

    const lookup = await api<{ encontrado: boolean }>(
      'GET',
      `/api/public/cervejarias/${portalSlug}/trailers/${portalTrailerId}/cliente-por-telefone?telefone=${encodeURIComponent(tel)}`,
    );
    if (lookup.status !== 200 || lookup.data.encontrado) {
      return {
        status: 'failed',
        message: 'Legado sem telefone não deveria aparecer no lookup',
        expected: 'false',
        actual: String(lookup.data.encontrado),
      };
    }
    return { message: 'Legado invisível ao lookup', expected: 'false', actual: 'false' };
  });

  await test({ id: 'PORTAL-11', category: 'Portal', name: 'Fluxo novo: lookup + sessao abre comanda', requirement: 'PORTAL-11' }, async () => {
    const tel = uniquePortalTestPhone(93, 11);
    const nome = `QA Portal Novo ${Date.now()}`;

    const lookup = await api<{ encontrado: boolean }>(
      'GET',
      `/api/public/cervejarias/${portalSlug}/trailers/${portalTrailerId}/cliente-por-telefone?telefone=${encodeURIComponent(tel)}`,
    );
    if (lookup.status !== 200 || lookup.data.encontrado) {
      return { status: 'failed', message: 'Pré-lookup deveria ser false', actual: String(lookup.data.encontrado) };
    }

    const session = await portalSessao(portalSlug, portalTrailerId, { nome, telefone: tel });
    if (session.status !== 201 || !session.comandaId || !session.clienteId) {
      return { status: 'failed', message: 'Sessao deveria abrir comanda', actual: String(session.status) };
    }

    const cliente = await prisma.cliente.findFirst({
      where: { id: session.clienteId, telefone: tel, nome },
    });
    if (!cliente) {
      return { status: 'failed', message: 'Cliente não cadastrado após sessao', actual: 'not found' };
    }
    return { message: 'Cadastro + comanda OK', expected: tel, actual: cliente.telefone ?? 'null' };
  });

  await test({ id: 'PORTAL-01', category: 'Portal', name: '10 sessões paralelas — cookies e comandas distintos', requirement: 'PORTAL-01' }, async () => {
    const sessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        portalSessao(portalSlug, portalTrailerId, {
          nome: `Cliente Portal ${i + 1}`,
          telefone: portalTestPhone(99, i + 1),
        }),
      ),
    );
    const ok = sessions.filter((s) => s.status === 201 && s.cookie && s.comandaId && s.clienteId);
    const cookies = new Set(ok.map((s) => s.cookie));
    const comandas = new Set(ok.map((s) => s.comandaId));
    const clientes = new Set(ok.map((s) => s.clienteId));
    if (ok.length !== 10) {
      return {
        status: 'failed',
        message: `${ok.length}/10 sessões OK`,
        expected: '10×201',
        actual: `${ok.length} OK · HTTP: ${sessions.map((s) => s.status).join(',')}`,
      };
    }
    if (cookies.size !== 10 || comandas.size !== 10 || clientes.size !== 10) {
      return {
        status: 'failed',
        message: 'Colisão de cookie/comanda/cliente',
        expected: '10 distintos cada',
        actual: `cookies=${cookies.size} comandas=${comandas.size} clientes=${clientes.size}`,
      };
    }
    return { message: '10 sessões isoladas', expected: '10/10', actual: '10/10' };
  });

  let portalSessions: PortalClient[] = [];

  await test({ id: 'PORTAL-02', category: 'Portal', name: '10 pedidos paralelos — cada um na comanda correta', requirement: 'PORTAL-02' }, async () => {
    portalSessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        portalSessao(portalSlug, portalTrailerId, {
          nome: `Pedido Client ${i + 1}`,
          telefone: portalTestPhone(98, i + 1),
        }),
      ),
    );
    if (portalSessions.some((s) => s.status !== 201 || !s.cookie)) {
      return { status: 'failed', message: 'Falha ao abrir sessões para pedidos' };
    }

    const pedidos = await Promise.all(
      portalSessions.map((s, i) =>
        api<{ id: string; comandaId: string; clienteId: string; status: string; observacao?: string }>(
          'POST',
          '/api/public/cliente/pedidos',
          {
            cookie: s.cookie!,
            body: portalPedidoBody(
              portalProdutoId,
              portalTapId,
              portalVolumeMl,
              `QA-CLIENT-${i + 1}`,
            ),
          },
        ),
      ),
    );

    const created = pedidos.filter((p) => p.status === 201);
    if (created.length !== 10) {
      return {
        status: 'failed',
        message: `${created.length}/10 pedidos criados`,
        expected: '10×201',
        actual: pedidos.map((p) => p.status).join(','),
      };
    }

    for (let i = 0; i < created.length; i++) {
      const p = created[i]!.data;
      const s = portalSessions[i]!;
      if (p.comandaId !== s.comandaId || p.clienteId !== s.clienteId) {
        return {
          status: 'failed',
          message: `Pedido ${i + 1} em comanda/cliente errado`,
          expected: `${s.comandaId}/${s.clienteId}`,
          actual: `${p.comandaId}/${p.clienteId}`,
        };
      }
    }
    return { message: '10 pedidos vinculados corretamente', expected: '10/10', actual: '10/10' };
  });

  await test({ id: 'PORTAL-03', category: 'Portal', name: 'Isolamento cruzado — cookie A não acessa pedido B', requirement: 'PORTAL-03' }, async () => {
    const [a, b] = await Promise.all([
      portalSessao(portalSlug, portalTrailerId, { nome: 'Isolamento A', telefone: portalTestPhone(97, 1) }),
      portalSessao(portalSlug, portalTrailerId, { nome: 'Isolamento B', telefone: portalTestPhone(97, 2) }),
    ]);
    if (!a.cookie || !b.cookie || a.status !== 201 || b.status !== 201) {
      return { status: 'failed', message: 'Sessões A/B não abriram' };
    }

    const pedB = await api<{ id: string }>('POST', '/api/public/cliente/pedidos', {
      cookie: b.cookie,
      body: portalPedidoBody(portalProdutoId, portalTapId, portalVolumeMl, 'QA-CLIENT-B-ONLY'),
    });
    if (pedB.status !== 201 || !pedB.data.id) {
      return { status: 'failed', message: 'Pedido B não criado' };
    }

    const comandaA = await api<{ pedidos: Array<{ id: string; observacao?: string }> }>(
      'GET',
      '/api/public/cliente/comanda',
      { cookie: a.cookie },
    );
    const leak = comandaA.data.pedidos?.some((p) => p.id === pedB.data.id);
    if (leak) {
      return { status: 'failed', message: 'Cliente A vê pedido de B na comanda' };
    }

    const cancelCross = await api('POST', `/api/public/cliente/pedidos/${pedB.data.id}/cancelar`, {
      cookie: a.cookie,
      body: {},
    });
    if (cancelCross.status === 200) {
      return { status: 'failed', message: 'Cliente A cancelou pedido de B', expected: '404', actual: '200' };
    }
    return { message: 'Isolamento OK', expected: '404 no cancel cruzado', actual: String(cancelCross.status) };
  });

  await test({ id: 'PORTAL-04', category: 'Portal', name: 'Race mesmo telefone — no máximo 1 comanda ABERTA', requirement: 'PORTAL-04' }, async () => {
    const tel = portalTestPhone(96, 1);
    const race = await Promise.all(
      Array.from({ length: 2 }, () =>
        portalSessao(portalSlug, portalTrailerId, { nome: 'Race Tel', telefone: tel }),
      ),
    );
    if (race.some((s) => s.status !== 201 || !s.clienteId)) {
      return {
        status: 'failed',
        message: 'Sessões race não abriram',
        actual: race.map((s) => s.status).join(','),
        details: race.map((s) => s.raw.slice(0, 120)).join(' | '),
      };
    }
    const clienteId = race[0]!.clienteId!;
    const abertas = await prisma.comanda.count({
      where: { eventoId: ctx.arena.eventoId, clienteId, status: 'ABERTA' },
    });
    if (abertas > 1) {
      return {
        status: 'failed',
        message: `${abertas} comandas ABERTA para mesmo cliente/evento`,
        expected: '≤1',
        actual: String(abertas),
      };
    }
    return { message: 'No máximo 1 comanda aberta', expected: '≤1', actual: String(abertas) };
  });

  await test({ id: 'PORTAL-05', category: 'Portal', name: 'Staff confirma pedidos — itens na comanda correta', requirement: 'PORTAL-05' }, async () => {
    const sessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        portalSessao(portalSlug, portalTrailerId, {
          nome: `Confirm ${i + 1}`,
          telefone: portalTestPhone(95, i + 1),
        }),
      ),
    );
    const pedidoRecords: Array<{ pedidoId: string; comandaId: string; clienteId: string }> = [];

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]!;
      if (!s.cookie || s.status !== 201) continue;
      const p = await api<{ id: string; comandaId: string; clienteId: string }>(
        'POST',
        '/api/public/cliente/pedidos',
        {
          cookie: s.cookie,
          body: portalPedidoBody(
            portalProdutoId,
            portalTapId,
            portalVolumeMl,
            `QA-CONFIRM-${i + 1}`,
          ),
        },
      );
      if (p.status === 201 && p.data.id) {
        pedidoRecords.push({
          pedidoId: p.data.id,
          comandaId: p.data.comandaId,
          clienteId: p.data.clienteId,
        });
      }
    }
    if (pedidoRecords.length !== 10) {
      return { status: 'failed', message: `${pedidoRecords.length}/10 pedidos para confirmar` };
    }

    for (const rec of pedidoRecords) {
      const before = await prisma.itemComanda.count({ where: { comandaId: rec.comandaId } });
      const confirm = await api('POST', `/api/pedidos/${rec.pedidoId}/confirmar`, {
        token: portalStaffToken,
        body: {},
      });
      if (confirm.status !== 200) {
        return {
          status: 'failed',
          message: `Confirmar ${rec.pedidoId} falhou HTTP ${confirm.status}`,
        };
      }
      const after = await prisma.itemComanda.count({ where: { comandaId: rec.comandaId } });
      if (after <= before) {
        return { status: 'failed', message: `Item não entrou na comanda ${rec.comandaId}` };
      }
    }
    return { message: '10 confirmações OK', expected: '10/10', actual: '10/10' };
  });

  await test({ id: 'PORTAL-06', category: 'Portal', name: 'Mix cancel + pedido — fila staff reflete estado', requirement: 'PORTAL-06' }, async () => {
    const sessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        portalSessao(portalSlug, portalTrailerId, {
          nome: `Mix ${i + 1}`,
          telefone: portalTestPhone(94, i + 1),
        }),
      ),
    );
    const pedidoIds: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]!;
      if (!s.cookie) continue;
      const p = await api<{ id: string }>('POST', '/api/public/cliente/pedidos', {
        cookie: s.cookie,
        body: portalPedidoBody(
          portalProdutoId,
          portalTapId,
          portalVolumeMl,
          `QA-MIX-${i + 1}`,
        ),
      });
      if (p.status === 201 && p.data.id) pedidoIds.push(p.data.id);
    }
    if (pedidoIds.length !== 10) {
      return { status: 'failed', message: `${pedidoIds.length}/10 pedidos criados` };
    }

    const toCancel = pedidoIds.slice(0, 5);
    const toKeep = pedidoIds.slice(5);
    await Promise.all(
      toCancel.map((id, i) =>
        api('POST', `/api/public/cliente/pedidos/${id}/cancelar`, {
          cookie: sessions[i]!.cookie!,
          body: {},
        }),
      ),
    );

    const pending = await prisma.pedidoCliente.findMany({
      where: { id: { in: pedidoIds }, status: 'PENDENTE' },
      select: { id: true },
    });
    const pendingIds = pending.map((p) => p.id).sort();
    const expectedKeep = [...toKeep].sort();
    if (pendingIds.length !== 5 || pendingIds.join(',') !== expectedKeep.join(',')) {
      return {
        status: 'failed',
        message: 'Fila pendente incorreta após cancelamentos',
        expected: '5 pendentes (índices 6-10)',
        actual: `${pendingIds.length} pendentes`,
      };
    }

    const staffPending = await api<Array<{ id: string }>>(
      'GET',
      `/api/pedidos/eventos/${ctx.arena.eventoId}/pedidos?status=PENDENTE`,
      { token: portalStaffToken },
    );
    const staffIds = new Set(staffPending.data.map((p) => p.id));
    const allKeptVisible = toKeep.every((id) => staffIds.has(id));
    const noneCancelledVisible = toCancel.every((id) => !staffIds.has(id));
    if (!allKeptVisible || !noneCancelledVisible) {
      return { status: 'failed', message: 'Fila staff não bate com cancelamentos do cliente' };
    }
    return { message: '5 cancelados, 5 pendentes na fila', expected: '5/5', actual: '5/5' };
  });

  await test({ id: 'PORTAL-07', category: 'Portal', name: 'Sessão invalidada ao encerrar/reabrir evento', requirement: 'PORTAL-07' }, async () => {
    const session = await portalSessao(portalSlug, portalTrailerId, {
      nome: 'Portal Gen Test',
      telefone: portalTestPhone(94, 7),
    });
    if (session.status !== 201 || !session.cookie) {
      return { status: 'failed', message: 'Não abriu sessão portal', actual: String(session.status) };
    }

    const before = await api('GET', '/api/public/cliente/comanda', { cookie: session.cookie });
    if (before.status !== 200) {
      return { status: 'failed', message: 'Comanda inacessível antes do fechamento', actual: String(before.status) };
    }

    const abertas = await prisma.comanda.findMany({
      where: { eventoId: ctx.arena.eventoId, status: 'ABERTA' },
      select: { id: true, total: true },
    });
    for (const c of abertas) {
      const total = Number(c.total);
      if (total <= 0) {
        await api('POST', `/api/comandas/${c.id}/cancelar`, { token: portalStaffToken });
      } else {
        await api('POST', `/api/pagamentos/comandas/${c.id}/fechar`, {
          token: portalStaffToken,
          body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] },
        });
      }
    }

    const fechar = await api('PATCH', `/api/eventos/${ctx.arena.eventoId}/fechar`, { token: portalStaffToken });
    if (fechar.status !== 200) {
      return { status: 'failed', message: 'Falha ao fechar evento arena', actual: String(fechar.status), details: fechar.raw };
    }

    const afterClose = await api('GET', '/api/public/cliente/comanda', { cookie: session.cookie });
    if (afterClose.status !== 401) {
      return { status: 'failed', message: 'Cookie deveria ser inválido após fechar evento', expected: '401', actual: String(afterClose.status) };
    }

    const reabrir = await api('PATCH', `/api/eventos/${ctx.arena.eventoId}/reabrir`, { token: portalStaffToken });
    if (reabrir.status !== 200) {
      return { status: 'failed', message: 'Falha ao reabrir evento arena', actual: String(reabrir.status) };
    }

    const afterReopen = await api('GET', '/api/public/cliente/comanda', { cookie: session.cookie });
    if (afterReopen.status !== 401) {
      return { status: 'failed', message: 'Cookie antigo deveria ser inválido após reabrir', expected: '401', actual: String(afterReopen.status) };
    }

    const fresh = await portalSessao(portalSlug, portalTrailerId, {
      nome: 'Portal Gen Test 2',
      telefone: portalTestPhone(94, 8),
    });
    if (fresh.status !== 201 || !fresh.comandaId || !fresh.cookie) {
      return { status: 'failed', message: 'Nova sessão após reabrir falhou', actual: String(fresh.status) };
    }

    const freshComanda = await api('GET', '/api/public/cliente/comanda', { cookie: fresh.cookie });
    if (freshComanda.status !== 200) {
      return { status: 'failed', message: 'Nova sessão não acessa comanda', actual: String(freshComanda.status) };
    }

    return { message: 'Sessões invalidadas; nova sessão OK', expected: '401→401→201', actual: 'OK' };
  });

  console.log('\n=== OBSERVABILIDADE / ERROS HTTP ===');
  await runObsTests(ctx, test);

  console.log('\n=== AUTH FORGOT / RESET ===');
  await runAuthResetTests(func, test);

  console.log('\n=== TRANSACAO LOG ===');
  await runTransacaoLogTests(func, test);

  console.log('\n=== CARDÁPIOS TEMPLATE ===');
  const { ensureTenantEventoAberto } = await import('./lib/tenant-evento.js');
  await ensureTenantEventoAberto(cat);
  await runCardapioTemplateTests(cat, test);

  console.log('\n=== MONTAGEM DE TAPS ===');
  await ensureTenantEventoAberto(cat);
  await runTapMontagemTests(cat, test);

  console.log('\n=== NÃO-FUNCIONAL (performance) ===');
  await bench('POST /api/auth/login', 50, 500, async () => {
    const t0 = performance.now();
    await login(A.donoEmail, 'qa123456');
    return performance.now() - t0;
  });
  await bench('GET /api/comandas/evento/:id', 30, 800, async () => {
    return (await api('GET', `/api/comandas/evento/${A.eventoId}`, { token: A.donoToken })).durationMs;
  });
  await bench('POST /api/comandas/:id/itens (seq)', 30, 600, async () => {
    return (await api('POST', `/api/comandas/${A.comandaIds[0]}/itens`, { token: A.atendenteTokens[0], body: chopeItemBody(A.produtoId, A.tapId, 500) })).durationMs;
  });

  await runPerfQuiosqueTests(ctx, bench, test);

  await test({ id: 'RNF-04', category: 'Não-funcional', name: 'Throughput multi-tenant (1 op/tenant)', requirement: 'RNF-04' }, async () => {
    for (const t of ctx.tenants) {
      const ev = await prisma.evento.findUnique({ where: { id: t.eventoId }, select: { status: true } });
      if (ev?.status !== 'ABERTO') {
        await api('PATCH', `/api/eventos/${t.eventoId}/reabrir`, { token: t.donoToken });
      }
    }

    const candidatos = [];
    for (const t of ctx.tenants) {
      const ev = await prisma.evento.findUnique({ where: { id: t.eventoId }, select: { status: true } });
      if (ev?.status === 'ABERTO') candidatos.push(t);
    }
    if (candidatos.length < 3) {
      return {
        status: 'failed',
        message: `Apenas ${candidatos.length} tenant(s) com evento ABERTO para throughput`,
        expected: '≥3 tenants',
        actual: String(candidatos.length),
      };
    }

    const alvos: Array<{ t: (typeof ctx.tenants)[0]; comandaId?: string; prepared: boolean }> = [];
    for (const t of candidatos) {
      let comandaId: string | undefined;
      let prepared = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await api<{ id: string }>('POST', '/api/comandas', {
          token: t.atendenteTokens[0],
          body: uniqueStaffComandaBody(t.eventoId, `RNF04 ${t.index}-${Date.now()}-${attempt}`, t.index),
        });
        if (r.status === 201 && r.data?.id) {
          comandaId = r.data.id;
          prepared = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
      }
      alvos.push({ t, comandaId, prepared });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const prontos = alvos.filter((a): a is typeof a & { comandaId: string } => a.prepared && Boolean(a.comandaId));
    const setupErrs = alvos.length - prontos.length;
    if (setupErrs > 0) {
      return {
        status: 'failed',
        message: `${setupErrs} tenant(s) não conseguiram comanda de preparação após 5 tentativas`,
        expected: `${alvos.length}/${alvos.length} setup OK`,
        actual: `${prontos.length}/${alvos.length}`,
      };
    }

    const waveSize = 8;
    const t0 = performance.now();
    const rs: Awaited<ReturnType<typeof api>>[] = [];
    for (let i = 0; i < prontos.length; i += waveSize) {
      const chunk = prontos.slice(i, i + waveSize);
      const part = await Promise.all(
        chunk.map(({ t, comandaId }) =>
          api('POST', `/api/comandas/${comandaId}/itens`, {
            token: t.atendenteTokens[Math.floor(Math.random() * t.atendenteTokens.length)],
            body: chopeItemBody(t.produtoId, t.tapId, 500),
          }),
        ),
      );
      rs.push(...part);
    }
    const elapsed = performance.now() - t0;
    const itemErrs = rs.filter((r) => r.status !== 201).length;
    const rate = itemErrs / prontos.length;
    const msg = `${prontos.length - itemErrs}/${prontos.length} OK em ${elapsed.toFixed(0)}ms`;
    if (rate > 0.05) {
      return {
        status: 'warning',
        message: `${msg} — ${(rate * 100).toFixed(0)}% erros nos POST /itens`,
        expected: '<5% erros',
        actual: `${(rate * 100).toFixed(0)}%`,
      };
    }
    return { message: msg, expected: '<5% erros', actual: `${(rate * 100).toFixed(0)}%` };
  });

  console.log('\n=== CONCORRÊNCIA (in-process) ===');
  await test({ id: 'CONC-03', category: 'Concorrência', name: 'Duplo-fechamento simultâneo da mesma comanda', requirement: 'CONC-03' }, async () => {
    const c = await api<{ id: string }>('POST', '/api/comandas', {
      token: func.atendenteTokens[0],
      body: staffComandaBody(func.eventoId, `DoubleClose ${Date.now()}`, 99),
    });
    const comandaId = c.data?.id;
    if (c.status !== 201 || !comandaId) {
      return {
        status: 'failed',
        message: 'Setup CONC-03: comanda não criada',
        expected: '201',
        actual: String(c.status),
        details: c.raw.slice(0, 200),
      };
    }
    await api('POST', `/api/comandas/${comandaId}/itens`, { token: func.atendenteTokens[0], body: chopeItemBody(func.produtoId, func.tapId, 500) });
    const cur = await api<{ total: string | number }>('GET', `/api/comandas/${comandaId}`, { token: func.donoToken });
    const total = Number(cur.data.total);

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        api('POST', `/api/pagamentos/comandas/${comandaId}/fechar`, { token: func.atendenteTokens[0], body: { pagamentos: [{ forma: 'DINHEIRO', valor: total }] } }),
      ),
    );
    const ok = attempts.filter((a) => a.status === 200).length;
    const pagCount = await prisma.pagamento.count({ where: { comandaId } });

    if (ok > 1 || pagCount > 1) {
      return {
        status: 'failed',
        message: `Race de fechamento: ${ok} sucessos, ${pagCount} pagamento(s) gravados`,
        expected: '1 sucesso / 1 pagamento',
        actual: `${ok} sucessos / ${pagCount} pagamentos`,
        details: 'fechar comanda faz findFirst(ABERTA) + update sem lock; múltiplos processos podem cobrar em duplicidade.',
      };
    }
    return { message: `1 sucesso, ${pagCount} pagamento — sem cobrança dupla`, expected: '1/1', actual: `${ok}/${pagCount}` };
  });

  const artifact: SuiteArtifact = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    durationMs: performance.now() - runStart,
    results,
    perf,
  };
  writeJson(SUITE_PATH, artifact);

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const warn = results.filter((r) => r.status === 'warning').length;
  console.log(`\n[suite] ${passed} OK · ${failed} falhas · ${warn} alertas · ${results.length} casos`);
  console.log(`[suite] Secret local ${secretOk ? 'confere' : 'NÃO confere'} com o servidor.`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[suite] FATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
