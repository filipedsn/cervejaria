import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { cancelOccurrence, generateAgendaDates, lockAgendaResource, saveAgendamento, stopAgenda } from '../src/lib/operacao/agenda.js';
import { validateCashOccurrenceSelection } from '../src/lib/operacao/contexto-ocorrencia.js';
import { lockCaixaEmTx } from '../src/lib/operacao/caixa-lock.js';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
console.log('QA fixtures: creating tenant and point');
const tenant = await prisma.cervejaria.create({ data: { nome: 'QA Agenda descartável', slug: `qa-agenda-${randomUUID()}` } });
const point = await prisma.pontoVenda.create({ data: { nome: 'QA PDV', cervejariaId: tenant.id, ativo: true, usaCaixa: true } });
await prisma.configuracaoOperacao.create({ data: { cervejariaId: tenant.id, exclusivo: true, ativo: true } });
await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
const owner = await prisma.usuario.create({ data: { nome: 'QA Owner', email: `${randomUUID()}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: tenant.id, papel: 'DONO' } });
const staff = await prisma.usuario.create({ data: { nome: 'QA Staff', email: `${randomUUID()}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: tenant.id, papel: 'ATENDENTE', permissoesOperacao: [] } });
const scope = { cervejariaId: tenant.id, pontoVendaId: point.id, usuarioId: owner.id };
const app = await buildApp(); await app.ready();
const ownerToken = signUserToken(app, owner); const staffToken = signUserToken(app, staff);
function inject(options: any) { const headers = { ...options.headers }; const token = headers['x-qa-user'] === staff.id ? staffToken : ownerToken; delete headers['x-qa-user']; return app.inject({ ...options, headers: { authorization: `Bearer ${token}`, ...headers } }); }
let passed = 0;
async function check(name: string, run: () => Promise<void>) { console.log(`RUN ${name}`); await run(); passed++; console.log(`PASS ${name}`); }
function input(extra = {}) { return { requestId: randomUUID(), nome: 'Sábado QA', data: '2026-10-10', horaInicio: '18:00', repetirSemanalmente: true, fim: '2026-10-31', ...extra }; }
const txOptions = { timeout: 15000, maxWait: 15000 };
async function schedule(extra = {}) { return prisma.$transaction((tx) => saveAgendamento(tx, scope, input(extra)), txOptions); }
async function occurrence(nome = 'Avulsa QA') { return prisma.ocorrenciaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome, data: new Date('2026-10-10T00:00:00Z'), horaInicio: '12:00' } }); }
try {
  await check('real buildApp registers the full frontend contract with authentication', async () => {
    for (const [method, url] of [['POST', '/api/operacao/agenda/agendamentos'], ['POST', '/api/operacao/agenda/ocorrencias/:id/cancelar'], ['POST', '/api/operacao/agenda/agendas/:id/interromper'], ['POST', '/api/operacao/agenda/agendas/:id/arquivar'], ['GET', '/api/operacao/agenda/agendas/arquivadas']] as const) assert.equal(app.hasRoute({ method, url }), true, `${method} ${url}`);
    const unauthenticated = await app.inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: {} }); assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
  });
  await check('weekly atomic save and concurrent retry reuse one receipt/series/dates', async () => {
    const body = input();
    const responses = await Promise.all([inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body }), inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body })]);
    responses.forEach((response) => assert.equal(response.statusCode, 200, response.body));
    assert.deepEqual(responses[0].json(), responses[1].json());
    assert.equal(await prisma.agendaOperacional.count(), 1); assert.equal(await prisma.ocorrenciaOperacional.count(), 4); assert.equal(await prisma.transacaoLog.count(), 1);
    const mismatch = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: { ...body, nome: 'Different' } }); assert.equal(mismatch.statusCode, 409);
  });
  await check('database insertion failure rolls back series, dates and audit receipt', async () => {
    const before = [await prisma.agendaOperacional.count(), await prisma.ocorrenciaOperacional.count(), await prisma.transacaoLog.count()];
    await prisma.$executeRawUnsafe(`CREATE FUNCTION quiosque.qa_agenda_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.nome = 'QA_FAIL' THEN RAISE EXCEPTION 'QA deliberate insert failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_agenda_fail BEFORE INSERT ON quiosque."OcorrenciaOperacional" FOR EACH ROW EXECUTE FUNCTION quiosque.qa_agenda_fail()`);
    await assert.rejects(() => schedule({ nome: 'QA_FAIL' }));
    assert.deepEqual([await prisma.agendaOperacional.count(), await prisma.ocorrenciaOperacional.count(), await prisma.transacaoLog.count()], before);
    await prisma.$executeRawUnsafe(`DROP TRIGGER qa_agenda_fail ON quiosque."OcorrenciaOperacional"`); await prisma.$executeRawUnsafe('DROP FUNCTION quiosque.qa_agenda_fail()');
  });
  await check('existing active rule without dates saves same ID and schedules its period', async () => {
    const rule = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Sem datas', diaSemana: 6, horaInicio: '18:00' } });
    const result = await schedule({ agendaId: rule.id, nome: 'Regra editada' }); assert.equal(result.agendaId, rule.id); assert.equal(result.criadas, 4);
  });
  await check('inactive rule edits without reactivation or new dates', async () => {
    const rule = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Inativa', diaSemana: 6, horaInicio: '18:00', ativa: false } });
    const result = await schedule({ agendaId: rule.id, gerarDatas: false, nome: 'Inativa editada' }); assert.equal(result.criadas, 0);
    assert.equal((await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: rule.id } })).ativa, false);
    await assert.rejects(() => schedule({ agendaId: rule.id, gerarDatas: true }), /inativa/);
  });
  await check('one-off retry and per-occurrence edit preserve ID and history', async () => {
    const body = input({ repetirSemanalmente: false, fim: undefined });
    const a = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body }); const b = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body });
    assert.equal(a.statusCode, 200, a.body); assert.deepEqual(a.json(), b.json());
    const id = a.json().ocorrenciaId;
    const edited = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ repetirSemanalmente: false, ocorrenciaId: id, nome: 'Editada', data: '2026-10-11', fim: undefined }) }); assert.equal(edited.statusCode, 200, edited.body); assert.equal(edited.json().ocorrenciaId, id);
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id } })).nome, 'Editada');
  });
  await check('cancel preserves record and atomic audit; retry emits no duplicate audit', async () => {
    const row = await occurrence(); const before = await prisma.transacaoLog.count();
    for (let i = 0; i < 2; i++) { const response = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/cancelar`, payload: {} }); assert.equal(response.statusCode, 200, response.body); }
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: row.id } })).status, 'CANCELADA'); assert.equal(await prisma.transacaoLog.count(), before + 1);
    const log = await prisma.transacaoLog.findFirstOrThrow({ where: { entidadeId: row.id } }); assert.equal((log.metadata as any).acao, 'AGENDAMENTO_CANCELADO');
  });
  await check('opened/closed status and closed cash history block edit/cancel without writes', async () => {
    for (const status of ['ABERTA', 'FECHADA'] as const) { const row = await occurrence(); await prisma.ocorrenciaOperacional.update({ where: { id: row.id }, data: { status } }); await assert.rejects(() => prisma.$transaction((tx) => cancelOccurrence(tx, scope, row.id)), /Somente/); }
    const row = await occurrence(); const session = await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, ocorrenciaId: row.id, diaOperacional: row.data, status: 'FECHADO', trocoInicial: 0, abertoPorId: owner.id } });
    const before = await prisma.transacaoLog.count();
    await assert.rejects(() => prisma.$transaction((tx) => cancelOccurrence(tx, scope, row.id)), /histórico/);
    await assert.rejects(() => schedule({ repetirSemanalmente: false, ocorrenciaId: row.id, fim: undefined }), /histórico/);
    assert.equal(await prisma.transacaoLog.count(), before); assert.equal((await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: session.id } })).status, 'FECHADO');
  });
  await check('stop serializes with all generators and preserves existing dates', async () => {
    const result = await schedule(); const before = await prisma.ocorrenciaOperacional.count({ where: { agendaId: result.agendaId } });
    const stopped = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${result.agendaId}/interromper`, payload: {} }); assert.equal(stopped.statusCode, 200, stopped.body);
    const generation = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${result.agendaId}/gerar`, payload: { inicio: '2026-11-01', fim: '2026-11-30' } }); assert.equal(generation.statusCode, 409, generation.body);
    await assert.rejects(() => prisma.$transaction((tx) => generateAgendaDates(tx, { cervejariaId: tenant.id, pontoVendaId: point.id }, result.agendaId!, '2026-11-01', '2026-11-30')), /inativa/);
    assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: result.agendaId } }), before);
  });
  await check('foreign tenant/PDV and denied permission cause no writes', async () => {
    const row = await occurrence(); const before = await prisma.transacaoLog.count();
    await assert.rejects(() => prisma.$transaction((tx) => cancelOccurrence(tx, { ...scope, cervejariaId: 'foreign' }, row.id)), /não encontrado/);
    await assert.rejects(() => prisma.$transaction((tx) => cancelOccurrence(tx, { ...scope, pontoVendaId: 'foreign' }, row.id)), /não encontrado/);
    const response = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', headers: { 'x-qa-user': staff.id }, payload: input() }); assert.equal(response.statusCode, 403, response.body);
    const other = await prisma.cervejaria.create({ data: { nome: 'QA foreign tenant', slug: `foreign-${randomUUID()}` } });
    const otherPoint = await prisma.pontoVenda.create({ data: { nome: 'QA foreign PDV', cervejariaId: other.id } });
    const otherRule = await prisma.agendaOperacional.create({ data: { nome: 'Foreign rule', cervejariaId: other.id, pontoVendaId: otherPoint.id, diaSemana: 6, horaInicio: '18:00' } });
    const otherRow = await prisma.ocorrenciaOperacional.create({ data: { nome: 'Foreign date', cervejariaId: other.id, pontoVendaId: otherPoint.id, data: row.data } });
    const foreignEdit = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ agendaId: otherRule.id }) }); assert.equal(foreignEdit.statusCode, 404, foreignEdit.body);
    const foreignCancel = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${otherRow.id}/cancelar`, payload: {} }); assert.equal(foreignCancel.statusCode, 404, foreignCancel.body);
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: otherRow.id } })).status, 'PROGRAMADA');
    assert.equal(await prisma.transacaoLog.count(), before);
  });
  await check('cash association wins lock: concurrent cancel waits then rejects history', async () => {
    const row = await occurrence(); let unlock!: () => void; let locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; }); const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const association = prisma.$transaction(async (tx) => {
      await lockCaixaEmTx(tx, tenant.id, point.id, row.data); await lockAgendaResource(tx, scope, 'ocorrencia', row.id); locked(); await gate;
      const id = await validateCashOccurrenceSelection(tx, { ...scope, ocorrenciaId: row.id, diaOperacional: row.data });
      return tx.sessaoCaixaOperacao.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, ocorrenciaId: id, diaOperacional: row.data, trocoInicial: 0, abertoPorId: owner.id } });
    }, txOptions);
    await ready; let completed = false;
    const canceled = prisma.$transaction((tx) => cancelOccurrence(tx, scope, row.id), txOptions).then(() => { completed = true; return null; }, (error) => { completed = true; return error; });
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(completed, false); unlock(); await association;
    assert.match(String(await canceled), /histórico/); assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: row.id } })).status, 'PROGRAMADA');
  });
  await check('cancel wins lock: later cash revalidation rejects canceled occurrence', async () => {
    const row = await occurrence(); await prisma.$transaction((tx) => cancelOccurrence(tx, scope, row.id));
    await assert.rejects(() => prisma.$transaction(async (tx) => { await lockCaixaEmTx(tx, tenant.id, point.id, row.data); await lockAgendaResource(tx, scope, 'ocorrencia', row.id); await validateCashOccurrenceSelection(tx, { ...scope, ocorrenciaId: row.id, diaOperacional: row.data }); }), /Somente ocorrências/);
    assert.equal(await prisma.sessaoCaixaOperacao.count({ where: { ocorrenciaId: row.id } }), 0);
  });
  await check('queries have no writes and return total rule counts, actual dates and action blocks', async () => {
    const before = await prisma.transacaoLog.count(); const response = await inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-10-01&fim=2026-10-31' });
    assert.equal(response.statusCode, 200, response.body); assert.ok(response.json().agendas.every((rule: any) => typeof rule._count.ocorrencias === 'number'));
    assert.ok(response.json().ocorrencias.some((row: any) => row.bloqueio && !row.podeCancelar)); assert.equal(await prisma.transacaoLog.count(), before);
  });
  await check('archive active/inactive rules persists without changing dates, cash, migration maps or past audit', async () => {
    const created = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ nome: 'Regra para arquivar', fim: '2026-11-14' }) }); assert.equal(created.statusCode, 200, created.body);
    const id = created.json().agendaId;
    const dates = await prisma.ocorrenciaOperacional.findMany({ where: { agendaId: id }, orderBy: { data: 'asc' } }); assert.equal(dates.length, 6);
    const cash = await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, ocorrenciaId: dates[0].id, diaOperacional: dates[0].data, trocoInicial: 0, abertoPorId: owner.id, status: 'FECHADO' } });
    const run = await prisma.pdvMigrationRun.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, transformVersion: 1, sourceSnapshotHash: 'QA_FIXTURE', status: 'COMPLETED' } });
    const map = await prisma.pdvMigrationMap.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, sourceType: 'QA_FIXTURE', sourceId: randomUUID(), destinationType: 'AgendaOperacional', destinationId: id, transformVersion: 1, payloadHash: 'QA_FIXTURE', lastRunId: run.id } });
    const logsBefore = await prisma.transacaoLog.findMany({ where: { entidadeId: id }, orderBy: { id: 'asc' } });
    const ruleBefore = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id } });
    for (let attempt = 0; attempt < 2; attempt++) { const response = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${id}/arquivar`, payload: {} }); assert.equal(response.statusCode, 200, response.body); }
    const archived = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id } }); assert.ok(archived.archivedAt); assert.equal(archived.ativa, ruleBefore.ativa); assert.equal(archived.nome, ruleBefore.nome);
    assert.deepEqual(await prisma.ocorrenciaOperacional.findMany({ where: { agendaId: id }, orderBy: { data: 'asc' } }), dates);
    assert.deepEqual(await prisma.sessaoCaixaOperacao.findUnique({ where: { id: cash.id } }), cash); assert.deepEqual(await prisma.pdvMigrationMap.findUnique({ where: { id: map.id } }), map);
    assert.deepEqual(await prisma.transacaoLog.findMany({ where: { id: { in: logsBefore.map((row) => row.id) } }, orderBy: { id: 'asc' } }), logsBefore);
    assert.equal(await prisma.transacaoLog.count({ where: { entidadeId: id } }), logsBefore.length + 1);
    const listed = await inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-10-01&fim=2026-10-31' }); assert.equal(listed.statusCode, 200, listed.body); assert.ok(!listed.json().agendas.some((rule: any) => rule.id === id)); assert.equal(listed.json().ocorrencias.filter((row: any) => row.agendaId === id).length, 4);
    const archivedList = await inject({ method: 'GET', url: '/api/operacao/agenda/agendas/arquivadas' }); assert.equal(archivedList.statusCode, 200, archivedList.body); assert.equal(archivedList.json().agendas.find((rule: any) => rule.id === id)._count.ocorrencias, 6);
    const generate = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${id}/gerar`, payload: { inicio: '2026-11-15', fim: '2026-12-31' } }); assert.equal(generate.statusCode, 409, generate.body);
    const save = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ agendaId: id }) }); assert.equal(save.statusCode, 409, save.body);
    const legacyPatch = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${id}`, payload: { ativa: true } }); assert.equal(legacyPatch.statusCode, 404, legacyPatch.body);
    const inactive = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Inativa removida', diaSemana: 6, horaInicio: '18:00', ativa: false } });
    const removed = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${inactive.id}/arquivar`, payload: {} }); assert.equal(removed.statusCode, 200, removed.body); const persisted = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: inactive.id } }); assert.equal(persisted.ativa, false); assert.ok(persisted.archivedAt);
  });
  await check('archive and archived reads reject missing permission and foreign tenant without writes', async () => {
    const target = await prisma.agendaOperacional.findFirstOrThrow({ where: { cervejariaId: tenant.id, archivedAt: null } }); const before = await prisma.transacaoLog.count();
    const denied = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${target.id}/arquivar`, headers: { 'x-qa-user': staff.id }, payload: {} }); assert.equal(denied.statusCode, 403, denied.body);
    const forbiddenRead = await inject({ method: 'GET', url: '/api/operacao/agenda/agendas/arquivadas', headers: { 'x-qa-user': staff.id } }); assert.equal(forbiddenRead.statusCode, 403, forbiddenRead.body);
    const foreign = await prisma.agendaOperacional.findFirstOrThrow({ where: { cervejariaId: { not: tenant.id } } }); const refused = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${foreign.id}/arquivar`, payload: {} }); assert.equal(refused.statusCode, 404, refused.body); assert.equal(await prisma.transacaoLog.count(), before);
  });
  console.log(`QA_AGENDA=${passed} passed; buildApp real + PostgreSQL transactions; no customer data`);
} finally { await app.close(); await prisma.$disconnect(); }
