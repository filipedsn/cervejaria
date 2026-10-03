import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import { validateInventoryEnvironment } from './inventory-pdv-unico-env.js';

validateInventoryEnvironment(process.env);
const [{ default: Fastify }, { eventosRoutes }, { eventoCaixaRoutes }, { prisma }, { bloquearCaixaEvento }] = await Promise.all([
  import('fastify'), import('../src/routes/eventos.js'), import('../src/routes/evento-caixa.js'), import('../src/lib/prisma.js'), import('../src/lib/evento-caixa.js'),
]);

async function testApp() {
  const app = Fastify();
  const auth = async (request: FastifyRequest) => {
    (request as typeof request & { user: unknown }).user = {
      sub: 'dev-readonly-test', cervejariaId: request.headers['x-test-tenant'] as string,
      email: '', nome: '', papel: 'DONO', pwdAt: 0,
    };
  };
  app.decorate('requireTenant', auth);
  app.decorate('authenticate', auth);
  await app.register(eventosRoutes, { prefix: '/eventos' });
  await app.register(eventoCaixaRoutes, { prefix: '/eventos' });
  await app.ready();
  return app;
}

test('rotas bloqueiam exclusão e reversão com histórico, preservando sessões e movimentos', async () => {
  const sessoes = await prisma.sessaoCaixaEvento.findMany({
    where: { evento: { cervejariaId: { not: '' } } },
    include: { movimentos: true, evento: { select: { cervejariaId: true } } },
    take: 100,
  });
  const app = await testApp();
  try {
    for (const status of ['ABERTO', 'FECHADO'] as const) {
      const caixa = sessoes.find((s) => s.status === status);
      if (!caixa) {
        console.log(`NÃO COMPROVADO: falta caixa ${status} em DEV`);
        continue;
      }
      const before = { sessoes: await prisma.sessaoCaixaEvento.count({ where: { eventoId: caixa.eventoId } }), movimentos: await prisma.movimentoCaixaEvento.count({ where: { sessao: { eventoId: caixa.eventoId } } }) };
      const exclusionLogs = await prisma.transacaoLog.count({ where: { eventoId: caixa.eventoId, tipo: 'EVENTO_EXCLUIDO' } });
      const headers = { 'x-test-tenant': caixa.evento.cervejariaId };
      const deleted = await app.inject({ method: 'DELETE', url: `/eventos/${caixa.eventoId}`, headers });
      assert.equal(deleted.statusCode, 409);
      const reverted = await app.inject({ method: 'POST', url: `/eventos/${caixa.eventoId}/reverter-para-agendado`, headers });
      if (reverted.statusCode === 400) console.log(`NÃO COMPROVADO: reversão ${status} bloqueada por regra anterior`);
      else assert.equal(reverted.statusCode, 409);
      assert.deepEqual({ sessoes: await prisma.sessaoCaixaEvento.count({ where: { eventoId: caixa.eventoId } }), movimentos: await prisma.movimentoCaixaEvento.count({ where: { sessao: { eventoId: caixa.eventoId } } }) }, before);
      assert.equal(await prisma.transacaoLog.count({ where: { eventoId: caixa.eventoId, tipo: 'EVENTO_EXCLUIDO' } }), exclusionLogs);
      assert.equal((await prisma.evento.count({ where: { id: caixa.eventoId } })), 1);
      const otherTenant = await app.inject({ method: 'DELETE', url: `/eventos/${caixa.eventoId}`, headers: { 'x-test-tenant': 'outro-tenant-inexistente' } });
      assert.equal(otherTenant.statusCode, 404);
    }
  } finally {
    await app.close();
  }
});

test('evento sem caixa ainda respeita regras de agenda e tenant', async () => {
  const serie = await prisma.evento.findFirst({ where: { recorrencia: 'SEMANAL', ocorrencias: { some: {} } }, select: { id: true, cervejariaId: true } });
  assert.ok(serie, 'DEV precisa de agenda com ocorrência para testar a regra anterior');
  assert.equal(await prisma.sessaoCaixaEvento.count({ where: { eventoId: serie.id } }), 0);
  const app = await testApp();
  try {
    const response = await app.inject({ method: 'DELETE', url: `/eventos/${serie.id}`, headers: { 'x-test-tenant': serie.cervejariaId } });
    assert.equal(response.statusCode, 409);
    assert.equal(await prisma.evento.count({ where: { id: serie.id } }), 1);
  } finally { await app.close(); }
});

test('movimentos existentes permanecem após exclusão bloqueada', async (t) => {
  const movimento = await prisma.movimentoCaixaEvento.findFirst({
    include: { sessao: { include: { evento: { select: { cervejariaId: true } } } } },
  });
  if (!movimento) {
    t.skip('NÃO COMPROVADO: DEV não tem movimento de caixa de Evento');
    return;
  }
  const app = await testApp();
  try {
    const response = await app.inject({ method: 'DELETE', url: `/eventos/${movimento.sessao.eventoId}`, headers: { 'x-test-tenant': movimento.sessao.evento.cervejariaId } });
    assert.equal(response.statusCode, 409);
    assert.equal(await prisma.movimentoCaixaEvento.count({ where: { id: movimento.id } }), 1);
    assert.equal(await prisma.sessaoCaixaEvento.count({ where: { id: movimento.sessaoId } }), 1);
  } finally { await app.close(); }
});

test('advisory lock serializa duas transações DEV sem escrita', async () => {
  const evento = await prisma.evento.findFirst({ select: { id: true } });
  assert.ok(evento);
  let releaseFirst!: () => void;
  let firstLocked!: () => void;
  const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const locked = new Promise<void>((resolve) => { firstLocked = resolve; });
  const first = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await bloquearCaixaEvento(tx, evento.id);
    firstLocked();
    await held;
  }, { timeout: 10000 });
  await locked;
  let secondLocked = false;
  const second = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await bloquearCaixaEvento(tx, evento.id);
    secondLocked = true;
  }, { timeout: 10000 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(secondLocked, false);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(secondLocked, true);
});

test('abertura, exclusão e reversão concorrentes aguardam o mesmo lock', async () => {
  const caixa = await prisma.sessaoCaixaEvento.findFirst({ where: { status: 'ABERTO', evento: { status: 'ABERTO' } }, include: { evento: { select: { cervejariaId: true } } } });
  assert.ok(caixa, 'DEV precisa de caixa aberto para testar a corrida');
  const app = await testApp();
  let release!: () => void;
  let locked!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const acquired = new Promise<void>((resolve) => { locked = resolve; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await bloquearCaixaEvento(tx, caixa.eventoId);
    locked();
    await hold;
  }, { timeout: 10000 });
  await acquired;
  const headers = { 'x-test-tenant': caixa.evento.cervejariaId };
  let completed = 0;
  const requests = [
    app.inject({ method: 'DELETE', url: `/eventos/${caixa.eventoId}`, headers }),
    app.inject({ method: 'POST', url: `/eventos/${caixa.eventoId}/reverter-para-agendado`, headers }),
    app.inject({ method: 'POST', url: `/eventos/${caixa.eventoId}/caixa/abrir`, headers, payload: { trocoInicial: 0 } }),
  ].map((promise) => promise.then((response) => { completed++; return response; }));
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(completed, 0);
  } finally { release(); }
  await holder;
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((r) => r.statusCode), [409, 409, 409]);
  assert.equal(await prisma.sessaoCaixaEvento.count({ where: { id: caixa.id } }), 1);
  await app.close();
});
