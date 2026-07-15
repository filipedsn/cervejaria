import { prisma } from '../src/lib/prisma.js';
import { API_BASE, api, chopeItemBody, login, percentile, portalPedidoBody, portalSessao, portalTestPhone, staffComandaBody } from './lib/http.js';
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
      status: 'warning',
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
      return { status: 'warning', message: 'Bloqueado, mas HTTP 500 (esperado 403)', expected: '403', actual: '500', details: 'assertCervejariaAtiva usa app.httpErrors sem @fastify/sensible.' };
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
    let adminToken: string;
    try {
      adminToken = await login('contato@quivercloud.com.br', 'M1H2sy27!pedro01');
    } catch {
      return { status: 'skipped', message: 'Credenciais admin indisponíveis' };
    }
    const r = await api<{ sessoes?: unknown[]; series?: unknown[] }>('GET', '/api/eventos', { token: adminToken });
    const total = (r.data.sessoes?.length ?? 0) + (r.data.series?.length ?? 0);
    if (total > 0) return { status: 'warning', message: `ADMIN vê ${total} eventos via rota tenant`, expected: '0', actual: String(total) };
    return { message: 'ADMIN isolado de dados de tenant', expected: '0', actual: '0' };
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

  await test({ id: 'RNF-04', category: 'Não-funcional', name: 'Throughput multi-tenant (1 op/tenant)', requirement: 'RNF-04' }, async () => {
    // Cria uma comanda nova por tenant (fora da janela de medição) para tornar o
    // teste independente da ordem: testes anteriores (ex.: RF-04) mutam comandas do seed.
    const alvos = await Promise.all(
      ctx.tenants.map(async (t) => {
        const r = await api<{ id: string }>('POST', '/api/comandas', {
          token: t.atendenteTokens[0],
          body: staffComandaBody(t.eventoId, `RNF04 ${t.index}-${Date.now()}`, t.index + 1),
        });
        return { t, comandaId: r.data?.id, prepared: r.status === 201 };
      }),
    );
    const prontos = alvos.filter((a) => a.prepared && a.comandaId);
    const setupErrs = alvos.length - prontos.length;

    const t0 = performance.now();
    const rs = await Promise.all(prontos.map(({ t, comandaId }) =>
      api('POST', `/api/comandas/${comandaId}/itens`, {
        token: t.atendenteTokens[Math.floor(Math.random() * t.atendenteTokens.length)],
        body: chopeItemBody(t.produtoId, t.tapId, 500),
      }),
    ));
    const elapsed = performance.now() - t0;
    const errs = rs.filter((r) => r.status !== 201).length + setupErrs;
    const rate = errs / alvos.length;
    const msg = `${alvos.length - errs}/${alvos.length} OK em ${elapsed.toFixed(0)}ms`;
    const details = setupErrs > 0 ? `${setupErrs} tenant(s) não conseguiram criar comanda de preparação.` : undefined;
    if (rate > 0.05) return { status: 'warning', message: `${msg} — ${(rate * 100).toFixed(0)}% erros`, expected: '<5% erros', actual: `${(rate * 100).toFixed(0)}%`, details };
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
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[suite] FATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
