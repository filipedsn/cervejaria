import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { readPdvPlanningSourceSnapshot, buildPdvPlanningGraph } from './pdv-unico-source-graph.js';

validateIsolatedQaEnvironment(process.env);
process.env.DATABASE_URL = process.env.QA_DATABASE_URL;
const [{ default: Fastify }, { PrismaClient }, { eventosRoutes }, { eventoCaixaRoutes }, { bloquearCaixaEvento }] = await Promise.all([
  import('fastify'), import('@prisma/client'), import('../src/routes/eventos.js'), import('../src/routes/evento-caixa.js'), import('../src/lib/evento-caixa.js'),
]);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.QA_DATABASE_URL } } });

test('EVT-SCHEMA-01: Event routes use the generated historical provenance column present in the applied QA schema', async () => {
  const runtimeModels = (prisma as any)._runtimeDataModel?.models ?? {};
  assert(runtimeModels.Pagamento?.fields?.some((field: any) => field.name === 'provenienciaHistorica'), 'route Prisma Client generated from the pinned schema includes Pagamento.provenienciaHistorica');
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Pagamento' AND column_name = 'provenienciaHistorica'
  `;
  assert.deepEqual(columns.map((column) => column.column_name), ['provenienciaHistorica'], 'the commerce migration bundle applies the exact P2022 column before the real route regressions');
});

let fixtureNo = 0;
async function fixture(options: { recurring?: boolean } = {}) {
  const suffix = `${Date.now()}-${++fixtureNo}`;
  const company = await prisma.cervejaria.create({ data: { nome: `QA event guard ${suffix}`, slug: `qa-event-${suffix}` } });
  const user = await prisma.usuario.create({ data: { nome: 'QA route actor', email: `qa-event-${suffix}@example.invalid`, senhaHash: 'test-only', papel: 'DONO', cervejariaId: company.id } });
  const trailer = await prisma.trailer.create({ data: { nome: 'QA fixture trailer', cervejariaId: company.id } });
  const event = await prisma.evento.create({ data: {
    nome: 'Synthetic event guard fixture', local: 'Isolated QA', trailerId: trailer.id, cervejariaId: company.id,
    ...(options.recurring ? { recorrencia: 'SEMANAL' as const, diaSemana: 6 } : { data: new Date('2026-10-03T12:00:00Z') }),
  } });
  return { companyId: company.id, userId: user.id, trailerId: trailer.id, eventId: event.id };
}

async function disposeFixture(companyId: string) {
  await prisma.movimentoCaixaEvento.deleteMany({ where: { sessao: { evento: { cervejariaId: companyId } } } });
  await prisma.sessaoCaixaEvento.deleteMany({ where: { evento: { cervejariaId: companyId } } });
  await prisma.cervejaria.delete({ where: { id: companyId } });
}

async function makeApp() {
  const app = Fastify();
  const auth = async (request: import('fastify').FastifyRequest) => {
    (request as typeof request & { user: unknown }).user = {
      sub: request.headers['x-qa-user'] as string,
      cervejariaId: request.headers['x-qa-tenant'] as string,
      email: '', nome: 'QA actor', papel: 'DONO', pwdAt: 0,
    };
  };
  app.decorate('requireTenant', auth);
  app.decorate('authenticate', auth);
  await app.register(eventosRoutes, { prefix: '/eventos' });
  await app.register(eventoCaixaRoutes, { prefix: '/eventos' });
  await app.ready();
  return app;
}

function headers(f: Awaited<ReturnType<typeof fixture>>) {
  return { 'x-qa-tenant': f.companyId, 'x-qa-user': f.userId };
}

async function waitForActivity(fragment: string, count = 1) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
        AND query ILIKE ${`%${fragment}%`}
    `;
    if (rows[0].count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Barrier timeout waiting on PostgreSQL advisory lock activity: ${fragment}`);
}

async function withGate(key: string) {
  let release!: () => void;
  let acquired!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const locked = new Promise<void>((resolve) => { acquired = resolve; });
  const txPromise = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${key})))`;
    acquired();
    await hold;
  }, { timeout: 20000 });
  await locked;
  return { release, txPromise };
}

async function installBarrierTrigger(kind: 'session-insert' | 'event-delete', eventId: string) {
  const suffix = kind === 'session-insert' ? 'session' : 'delete';
  const functionName = `qa_${suffix}_${eventId}`;
  const triggerName = `qa_${suffix}_${eventId}`;
  const table = kind === 'session-insert' ? 'SessaoCaixaEvento' : 'Evento';
  const operation = kind === 'session-insert' ? 'INSERT' : 'DELETE';
  const rowId = kind === 'session-insert' ? 'NEW."eventoId"' : 'OLD."id"';
  const gatePrefix = kind === 'session-insert' ? 'qa-first-session:' : 'qa-event-delete:';
  await prisma.$executeRawUnsafe(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${rowId} = '${eventId}' THEN PERFORM pg_advisory_xact_lock(abs(hashtext('${gatePrefix}' || ${rowId}))); END IF; RETURN ${operation === 'INSERT' ? 'NEW' : 'OLD'}; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE ${operation} ON public."${table}" FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON public."${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${functionName}"()`);
  };
}

test('EVT-DEL-01: bloqueia DELETE e reversão com Evento ABERTO e caixa ABERTO', async () => {
  const f = await fixture(); const app = await makeApp();
  try {
    const session = await prisma.sessaoCaixaEvento.create({ data: { eventoId: f.eventId, abertoPorId: f.userId } });
    const movement = await prisma.movimentoCaixaEvento.create({ data: { sessaoId: session.id, tipo: 'SUPRIMENTO', valor: '18.27', registradoPorId: f.userId } });
    const deleteResponse = await app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) });
    const revertResponse = await app.inject({ method: 'POST', url: `/eventos/${f.eventId}/reverter-para-agendado`, headers: headers(f) });
    assert.equal(deleteResponse.statusCode, 409); assert.equal(revertResponse.statusCode, 409);
    const preserved = await prisma.movimentoCaixaEvento.findUniqueOrThrow({ where: { id: movement.id } });
    assert.deepEqual({ id: preserved.id, sessaoId: preserved.sessaoId, tipo: preserved.tipo, valor: preserved.valor.toFixed(2) }, { id: movement.id, sessaoId: session.id, tipo: 'SUPRIMENTO', valor: '18.27' });
    assert.equal(await prisma.sessaoCaixaEvento.count({ where: { id: session.id } }), 1);
    assert.equal(await prisma.transacaoLog.count({ where: { tipo: 'EVENTO_EXCLUIDO', entidadeId: f.eventId } }), 0);
  } finally { await app.close(); await disposeFixture(f.companyId); }
});

test('EVT-DEL-02: Evento ABERTO e caixa FECHADO atingem a guarda de histórico', async () => {
  const f = await fixture(); const app = await makeApp();
  try {
    const session = await prisma.sessaoCaixaEvento.create({ data: { eventoId: f.eventId, abertoPorId: f.userId, status: 'FECHADO', fechadoPorId: f.userId, fechadoEm: new Date(), contadoDinheiro: '18.27' } });
    const movement = await prisma.movimentoCaixaEvento.create({ data: { sessaoId: session.id, tipo: 'SANGRIA', valor: '4.12', registradoPorId: f.userId } });
    const deleted = await app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) });
    const reverted = await app.inject({ method: 'POST', url: `/eventos/${f.eventId}/reverter-para-agendado`, headers: headers(f) });
    assert.equal(deleted.statusCode, 409); assert.equal(reverted.statusCode, 409);
    const preserved = await prisma.movimentoCaixaEvento.findUniqueOrThrow({ where: { id: movement.id } });
    assert.deepEqual({ id: preserved.id, sessaoId: preserved.sessaoId, tipo: preserved.tipo, valor: preserved.valor.toFixed(2) }, { id: movement.id, sessaoId: session.id, tipo: 'SANGRIA', valor: '4.12' });
    assert.equal((await prisma.evento.findUniqueOrThrow({ where: { id: f.eventId } })).status, 'ABERTO');
    assert.equal(await prisma.transacaoLog.count({ where: { tipo: 'EVENTO_EXCLUIDO', entidadeId: f.eventId } }), 0);
  } finally { await app.close(); await disposeFixture(f.companyId); }
});

test('EVT-DEL-03: tenant diferente não exclui nem reverte Evento', async () => {
  const f = await fixture(); const app = await makeApp();
  try {
    for (const request of [
      { method: 'DELETE' as const, url: `/eventos/${f.eventId}` },
      { method: 'POST' as const, url: `/eventos/${f.eventId}/reverter-para-agendado` },
    ]) assert.equal((await app.inject({ ...request, headers: { 'x-qa-tenant': 'wrong-tenant', 'x-qa-user': f.userId } })).statusCode, 404);
    assert.equal(await prisma.evento.count({ where: { id: f.eventId } }), 1);
  } finally { await app.close(); await disposeFixture(f.companyId); }
});

test('EVT-DEL-04: agenda e comanda continuam bloqueando exclusão sem histórico de caixa', async () => {
  const f = await fixture({ recurring: true }); const app = await makeApp();
  try {
    const trailer2 = await prisma.trailer.create({ data: { nome: 'QA occurrence trailer', cervejariaId: f.companyId } });
    const occurrence = await prisma.evento.create({ data: { nome: 'Synthetic occurrence', local: 'QA', data: new Date('2026-10-10T12:00:00Z'), trailerId: trailer2.id, cervejariaId: f.companyId, serieId: f.eventId } });
    assert.equal((await app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) })).statusCode, 409);
    const command = await prisma.comanda.create({ data: { eventoId: occurrence.id } });
    assert.equal((await app.inject({ method: 'DELETE', url: `/eventos/${occurrence.id}`, headers: headers(f) })).statusCode, 409);
    await prisma.comanda.delete({ where: { id: command.id } });
    assert.equal(await prisma.sessaoCaixaEvento.count({ where: { eventoId: occurrence.id } }), 0);
  } finally { await app.close(); await disposeFixture(f.companyId); }
});

test('EVT-AUD-01: exclusão bem-sucedida persiste log com ID original sem FK Evento', async () => {
  const f = await fixture(); const app = await makeApp();
  try {
    const response = await app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) });
    assert.equal(response.statusCode, 204);
    assert.equal(await prisma.evento.count({ where: { id: f.eventId } }), 0);
    const log = await prisma.transacaoLog.findFirstOrThrow({ where: { tipo: 'EVENTO_EXCLUIDO', entidadeTipo: 'Evento', entidadeId: f.eventId } });
    assert.equal(log.eventoId, null);
    assert.equal((log.metadata as { eventoIdOriginal: string }).eventoIdOriginal, f.eventId);
    assert.equal(log.comandaId, null);
    const source = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return readPdvPlanningSourceSnapshot(tx, f.companyId);
    }, { isolationLevel: 'RepeatableRead' });
    const graph = buildPdvPlanningGraph(source);
    const auditRows = source.transactionLogs.filter((row) => row.id === log.id);
    const auditGraphRows = graph.records.filter((row) => row.type === 'TRANSACAO_LOG' && row.id === log.id);
    assert.equal(source.transactionLogs.length, await prisma.transacaoLog.count({ where: { cervejariaId: f.companyId } }));
    assert.deepEqual(auditRows.map((row) => ({ id: row.id, eventId: row.eventoId, commandId: row.comandaId, entityId: row.entidadeId })), [{ id: log.id, eventId: null, commandId: null, entityId: f.eventId }]);
    assert.equal(auditGraphRows.length, 1);
    assert.deepEqual(auditGraphRows[0]?.historicalAudit, { entityType: 'Evento', entityId: f.eventId, metadata: log.metadata });
  } finally { await app.close(); await disposeFixture(f.companyId); }
});

test('EVT-AUD-02: reversão persiste origem do Evento e comanda vazia após cascades', async () => {
  const f = await fixture(); const app = await makeApp();
  try {
    const command = await prisma.comanda.create({ data: { eventoId: f.eventId } });
    const response = await app.inject({ method: 'POST', url: `/eventos/${f.eventId}/reverter-para-agendado`, headers: headers(f) });
    assert.equal(response.statusCode, 200);
    assert.equal(await prisma.evento.count({ where: { id: f.eventId } }), 0);
    assert.equal(await prisma.comanda.count({ where: { id: command.id } }), 0);
    const eventLog = await prisma.transacaoLog.findFirstOrThrow({ where: { tipo: 'EVENTO_EXCLUIDO', entidadeTipo: 'Evento', entidadeId: f.eventId } });
    const commandLog = await prisma.transacaoLog.findFirstOrThrow({ where: { tipo: 'COMANDA_CANCELADA', entidadeTipo: 'Comanda', entidadeId: command.id } });
    assert.equal(eventLog.eventoId, null);
    assert.equal((eventLog.metadata as { eventoIdOriginal: string }).eventoIdOriginal, f.eventId);
    assert.equal(commandLog.eventoId, null); assert.equal(commandLog.comandaId, null);
    assert.deepEqual(commandLog.metadata, { clienteNome: '', motivo: 'manual', eventoIdOriginal: f.eventId, comandaIdOriginal: command.id });
  } finally { await app.close(); await disposeFixture(f.companyId); }
});

test('EVT-AUD-03: falha no DELETE reverte o log e mantém Evento', async () => {
  const f = await fixture(); const app = await makeApp();
  const trigger = `qa_fail_delete_${f.eventId}`;
  const fn = trigger;
  try {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION public."${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE DELETE ON public."Evento" FOR EACH ROW WHEN (OLD."id" = '${f.eventId}') EXECUTE FUNCTION public."${fn}"()`);
    const response = await app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) });
    assert.equal(response.statusCode, 500);
    assert.equal(await prisma.evento.count({ where: { id: f.eventId } }), 1);
    assert.equal(await prisma.transacaoLog.count({ where: { tipo: 'EVENTO_EXCLUIDO', entidadeId: f.eventId } }), 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON public."Evento"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${fn}"()`);
    await app.close(); await disposeFixture(f.companyId);
  }
});

test('EVT-CON-01..04: primeira sessão vence ou perde para exclusão e reversão com barreiras PostgreSQL', async () => {
  for (const action of ['DELETE', 'REVERT'] as const) {
    // Session transaction reaches the INSERT trigger only after taking the same event lock as the routes.
    {
      const f = await fixture(); const app = await makeApp();
      const dropTrigger = await installBarrierTrigger('session-insert', f.eventId);
      const gate = await withGate(`qa-first-session:${f.eventId}`);
      try {
        const opening = app.inject({ method: 'POST', url: `/eventos/${f.eventId}/caixa/abrir`, headers: headers(f), payload: { trocoInicial: 0 } });
        await waitForActivity('INSERT INTO "public"."SessaoCaixaEvento"');
        const exclusion = action === 'DELETE'
          ? app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) })
          : app.inject({ method: 'POST', url: `/eventos/${f.eventId}/reverter-para-agendado`, headers: headers(f) });
        await waitForActivity('pg_advisory_xact_lock');
        gate.release(); await gate.txPromise;
        assert.equal((await opening).statusCode, 201);
        assert.equal((await exclusion).statusCode, 409);
        assert.equal(await prisma.sessaoCaixaEvento.count({ where: { eventoId: f.eventId } }), 1);
        assert.equal(await prisma.evento.count({ where: { id: f.eventId } }), 1);
      } finally { gate.release(); await gate.txPromise.catch(() => {}); await dropTrigger(); await app.close(); await disposeFixture(f.companyId); }
    }

    // Exclusion/reversion reaches its DELETE trigger while holding the event lock; opening must queue behind it.
    {
      const f = await fixture(); const app = await makeApp();
      const dropTrigger = await installBarrierTrigger('event-delete', f.eventId);
      const gate = await withGate(`qa-event-delete:${f.eventId}`);
      try {
        const exclusion = action === 'DELETE'
          ? app.inject({ method: 'DELETE', url: `/eventos/${f.eventId}`, headers: headers(f) })
          : app.inject({ method: 'POST', url: `/eventos/${f.eventId}/reverter-para-agendado`, headers: headers(f) });
        await waitForActivity('DELETE FROM "public"."Evento"');
        const opening = app.inject({ method: 'POST', url: `/eventos/${f.eventId}/caixa/abrir`, headers: headers(f), payload: { trocoInicial: 0 } });
        await waitForActivity('pg_advisory_xact_lock');
        gate.release(); await gate.txPromise;
        const excluded = await exclusion;
        assert.equal(excluded.statusCode, action === 'DELETE' ? 204 : 200);
        assert.equal((await opening).statusCode, 409);
        assert.equal(await prisma.evento.count({ where: { id: f.eventId } }), 0);
        assert.equal(await prisma.sessaoCaixaEvento.count({ where: { eventoId: f.eventId } }), 0);
        assert.equal(await prisma.transacaoLog.count({ where: { tipo: 'EVENTO_EXCLUIDO', entidadeId: f.eventId } }), 1);
      } finally { gate.release(); await gate.txPromise.catch(() => {}); await dropTrigger(); await app.close(); await disposeFixture(f.companyId); }
    }
  }
});
