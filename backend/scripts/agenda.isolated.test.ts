import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { cancelOccurrence, generateAgendaDates, lockAgendaResource, renewAgendaWindows, saveAgendamento, stopAgenda } from '../src/lib/operacao/agenda.js';
import { validateCashOccurrenceSelection } from '../src/lib/operacao/contexto-ocorrencia.js';
import { lockCaixaEmTx } from '../src/lib/operacao/caixa-lock.js';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
await prisma.$executeRawUnsafe('ALTER TABLE quiosque."AgendaOperacional" DROP CONSTRAINT IF EXISTS "AgendaOperacional_periodo_check"');
await prisma.$executeRawUnsafe('ALTER TABLE quiosque."AgendaOperacional" ADD CONSTRAINT "AgendaOperacional_periodo_check" CHECK ("primeiraData" IS NULL OR "ultimaData" IS NULL OR "ultimaData" >= "primeiraData")');
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
let inputSequence = 0;
function input(extra = {}) { const date = new Date('2026-10-10T00:00:00.000Z'); date.setUTCDate(date.getUTCDate() + inputSequence++ * 35); const end = new Date(date); end.setUTCDate(end.getUTCDate() + 21); return { requestId: randomUUID(), nome: 'Sábado QA', data: date.toISOString().slice(0, 10), horaInicio: '18:00', horaFim: '20:00', repetirSemanalmente: true, fim: end.toISOString().slice(0, 10), ...extra }; }
function plusDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
const txOptions = { timeout: 15000, maxWait: 15000 };
async function schedule(extra = {}) { return prisma.$transaction((tx) => saveAgendamento(tx, scope, input(extra)), txOptions); }
async function occurrence(nome = 'Avulsa QA', extra = {}) { return prisma.ocorrenciaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome, data: new Date('2026-10-10T00:00:00Z'), horaInicio: '12:00', horaFim: '13:00', ...extra } }); }
async function postSchedule(body: any) { return inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body }); }
try {
  await check('real buildApp registers the full frontend contract with authentication', async () => {
    for (const [method, url] of [['POST', '/api/operacao/agenda/agendamentos'], ['POST', '/api/operacao/agenda/ocorrencias/:id/cancelar'], ['POST', '/api/operacao/agenda/ocorrencias/:id/restaurar'], ['POST', '/api/operacao/agenda/agendas/:id/interromper'], ['POST', '/api/operacao/agenda/agendas/:id/retomar'], ['POST', '/api/operacao/agenda/agendas/:id/arquivar'], ['GET', '/api/operacao/agenda/agendas/arquivadas']] as const) assert.equal(app.hasRoute({ method, url }), true, `${method} ${url}`);
    const unauthenticated = await app.inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: {} }); assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    const unauthenticatedRestore = await app.inject({ method: 'POST', url: '/api/operacao/agenda/ocorrencias/example/restaurar', payload: { requestId: randomUUID() } }); assert.equal(unauthenticatedRestore.statusCode, 401, unauthenticatedRestore.body);
  });
  await check('reproduction: legacy definition-only edit is rejected because the shared scheduling contract requires a date', async () => {
    const legacy = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Cia Marítima Igarapé fixture', diaSemana: 5, horaInicio: '18:00', horaFim: '20:00', ativa: false } });
    const response = await postSchedule({ requestId: randomUUID(), agendaId: legacy.id, nome: 'Nome atualizado', horaInicio: '19:00', horaFim: '21:00', repetirSemanalmente: true, gerarDatas: false, fim: null });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.body, /Campo obrigatório/i);
    const unchanged = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(unchanged.nome, 'Cia Marítima Igarapé fixture');
    assert.equal(unchanged.primeiraData, null);
    await prisma.agendaOperacional.delete({ where: { id: legacy.id } });
  });
  await check('weekly atomic save and concurrent retry reuse one receipt/series/dates', async () => {
    const body = input();
    const responses = await Promise.all([inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body }), inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body })]);
    responses.forEach((response) => assert.equal(response.statusCode, 200, response.body));
    assert.deepEqual(responses[0].json(), responses[1].json());
    assert.equal(await prisma.agendaOperacional.count(), 1); assert.equal(await prisma.ocorrenciaOperacional.count(), 4); assert.equal(await prisma.transacaoLog.count(), 1);
    const mismatch = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: { ...body, nome: 'Different' } }); assert.equal(mismatch.statusCode, 409);
  });
  await check('Friday recurrence persists inclusive bounds and creates only Oct 23 and Oct 30 across calendar timezone', async () => {
    const previousTz = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati';
    try {
      const body = input({ nome: 'Sextas limitadas QA', data: '2026-10-23', fim: '2026-10-31' });
      const response = await postSchedule(body); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().criadas, 2);
      assert.deepEqual(response.json().datas, ['2026-10-23', '2026-10-30']);
      const rule = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: response.json().agendaId } });
      assert.equal(rule.diaSemana, 5); assert.equal(rule.primeiraData?.toISOString().slice(0, 10), '2026-10-23'); assert.equal(rule.geracaoDesde?.toISOString().slice(0, 10), '2026-10-23'); assert.equal(rule.ultimaData?.toISOString().slice(0, 10), '2026-10-31');
      const rows = await prisma.ocorrenciaOperacional.findMany({ where: { agendaId: rule.id }, orderBy: { data: 'asc' } });
      assert.deepEqual(rows.map((row) => row.data.toISOString().slice(0, 10)), ['2026-10-23', '2026-10-30']);
      const listed = await inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-10-01&fim=2026-10-31' });
      assert.equal(listed.statusCode, 200); const serialized = listed.json().agendas.find((row: any) => row.id === rule.id);
      assert.equal(serialized.primeiraData, '2026-10-23T00:00:00.000Z'); assert.equal(serialized.ultimaData, '2026-10-31T00:00:00.000Z');
      const before = await prisma.ocorrenciaOperacional.count({ where: { agendaId: rule.id } });
      const beyond = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${rule.id}/gerar`, payload: { inicio: '2026-11-01', fim: '2026-11-30' } });
      assert.equal(beyond.statusCode, 409, beyond.body); assert.equal(beyond.json().code, 'AGENDA_FORA_DO_PERIODO');
      assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: rule.id } }), before);
    } finally { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
  });
  await check('open-ended rule persists null end, reloads, and idempotently renews finite windows without crossing a later end', async () => {
    const open = await postSchedule(input({ nome: 'Sextas sem término QA', data: '2026-11-06', fim: null, horaInicio: '03:00', horaFim: '04:00' }));
    assert.equal(open.statusCode, 200, open.body); const id = open.json().agendaId as string;
    const stored = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id } });
    assert.equal(stored.primeiraData?.toISOString().slice(0, 10), '2026-11-06'); assert.equal(stored.ultimaData, null);
    const listed = await inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-11-01&fim=2026-11-30' });
    assert.equal(listed.statusCode, 200); const reloaded = listed.json().agendas.find((row: any) => row.id === id);
    assert.equal(reloaded.primeiraData, '2026-11-06T00:00:00.000Z'); assert.equal(reloaded.ultimaData, null);
    const pastWindowCount = await prisma.ocorrenciaOperacional.count({ where: { agendaId: id } });
    const renewal = await renewAgendaWindows(prisma, new Date('2027-01-01T00:00:00.000Z'));
    assert.ok(renewal.criadas > 0);
    const renewalRetry = await renewAgendaWindows(prisma, new Date('2027-01-01T00:00:00.000Z'));
    assert.equal(renewalRetry.criadas, 0);
    assert.ok(await prisma.ocorrenciaOperacional.count({ where: { agendaId: id } }) > pastWindowCount);
    const bounded = await postSchedule(input({ nome: 'Sextas com término QA', data: '2026-11-06', fim: '2026-11-20', horaInicio: '04:00', horaFim: '05:00' }));
    assert.equal(bounded.statusCode, 200, bounded.body); const boundedId = bounded.json().agendaId as string;
    const boundedBefore = await prisma.ocorrenciaOperacional.count({ where: { agendaId: boundedId } });
    await renewAgendaWindows(prisma, new Date('2027-01-01T00:00:00.000Z'));
    assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: boundedId } }), boundedBefore);
    assert.equal(boundedBefore, 3);
    const legacy = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Legada retomável QA', diaSemana: 5, horaInicio: '05:00', horaFim: '06:00', ativa: false } });
    const oldCancelled = await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, agendaId: legacy.id, nome: legacy.nome, data: new Date('2026-11-06T00:00:00Z'), horaInicio: '05:00', horaFim: '06:00', status: 'CANCELADA' } });
    const resumeUrl = `/api/operacao/agenda/agendas/${legacy.id}/retomar`;
    const needsStart = await inject({ method: 'POST', url: resumeUrl, payload: { requestId: randomUUID() } });
    assert.equal(needsStart.statusCode, 409); assert.equal(needsStart.json().code, 'AGENDA_INICIO_NECESSARIO');
    const resumed = await inject({ method: 'POST', url: resumeUrl, payload: { requestId: randomUUID(), aPartirDe: '2026-11-06' } });
    assert.equal(resumed.statusCode, 200, resumed.body); assert.equal(resumed.json().agendaId, legacy.id);
    const reloadedLegacy = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(reloadedLegacy.ativa, true); assert.equal(reloadedLegacy.primeiraData, null); assert.equal(reloadedLegacy.geracaoDesde?.toISOString().slice(0, 10), '2026-11-06'); assert.equal(reloadedLegacy.ultimaData, null);
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: oldCancelled.id } })).status, 'CANCELADA');
  });
  await check('shrinking a recurrence reports future dates outside the new bounds and preserves their status and cash history', async () => {
    const initial = { requestId: randomUUID(), nome: 'Shrink QA', data: '2026-10-23', horaInicio: '15:00', horaFim: '16:00', repetirSemanalmente: true, fim: '2026-11-20' };
    const created = await postSchedule(initial); assert.equal(created.statusCode, 200, created.body); assert.equal(created.json().criadas, 5);
    const ruleId = created.json().agendaId as string;
    const historicDate = await prisma.ocorrenciaOperacional.findFirstOrThrow({ where: { agendaId: ruleId, data: new Date('2026-11-13T00:00:00Z') } });
    const session = await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, ocorrenciaId: historicDate.id, diaOperacional: historicDate.data, status: 'FECHADO', trocoInicial: 0, abertoPorId: owner.id, fechadoEm: new Date('2026-11-13T23:00:00Z') } });
    const updateBody = { ultimaData: '2026-10-31' };
    const updated = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${ruleId}`, payload: updateBody }); assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().foraDoPeriodo.length, 3);
    assert.ok(updated.json().foraDoPeriodo.some((row: any) => row.id === historicDate.id && row.data === '2026-11-13' && row.status === 'PROGRAMADA' && row.possuiHistorico));
    const datesAfter = await prisma.ocorrenciaOperacional.findMany({ where: { agendaId: ruleId }, orderBy: { data: 'asc' } });
    assert.equal(datesAfter.length, 5); assert.ok(datesAfter.some((row) => row.id === historicDate.id && row.status === 'PROGRAMADA'));
    assert.deepEqual(await prisma.sessaoCaixaOperacao.findUniqueOrThrow({ where: { id: session.id } }), session);
    const retry = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${ruleId}`, payload: updateBody }); assert.equal(retry.statusCode, 200, retry.body);
  });
  await check('month/year boundary is inclusive and direct creation remains definition-only until explicit audited resume', async () => {
    const inputBody = { nome: 'Virada QA', diaSemana: 5, horaInicio: '18:00', horaFim: '20:00', primeiraData: '2026-12-25', ultimaData: '2027-01-08' };
    const longDefinition = await inject({ method: 'POST', url: '/api/operacao/agenda/agendas', payload: { ...inputBody, primeiraData: '2026-01-01', ultimaData: '2027-01-03' } }); assert.equal(longDefinition.statusCode, 201, longDefinition.body);
    const created = await inject({ method: 'POST', url: '/api/operacao/agenda/agendas', payload: inputBody }); assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id; assert.equal(created.json().ativa, false); assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: id } }), 0);
    const longEdit = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${id}`, payload: { ultimaData: '2028-01-01' } }); assert.equal(longEdit.statusCode, 200, longEdit.body);
    await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${id}`, payload: { ultimaData: '2027-01-08' } });
    const requestId = randomUUID(); const url = `/api/operacao/agenda/agendas/${id}/retomar`;
    const [first, retry] = await Promise.all([inject({ method: 'POST', url, payload: { requestId, aPartirDe: '2026-12-25' } }), inject({ method: 'POST', url, payload: { requestId, aPartirDe: '2026-12-25' } })]);
    assert.equal(first.statusCode, 200, first.body); assert.deepEqual(first.json(), retry.json());
    assert.equal(first.json().criadas, 3); assert.deepEqual(first.json().datas, ['2026-12-25', '2027-01-01', '2027-01-08']);
    assert.equal((await prisma.agendaOperacional.findUniqueOrThrow({ where: { id } })).ativa, true);
    assert.equal(await prisma.transacaoLog.count({ where: { entidadeId: id, metadata: { path: ['acao'], equals: 'REPETICAO_RETOMADA' } } }), 1);
    const shrink = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${id}`, payload: { ultimaData: '2026-12-25' } }); assert.equal(shrink.statusCode, 200, shrink.body);
    assert.deepEqual(shrink.json().foraDoPeriodo.map((row: any) => row.data), ['2027-01-01', '2027-01-08']);
    assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: id } }), 3, 'shrinking the period preserves already-created dates');
  });
  await check('database insertion failure rolls back series, dates and audit receipt', async () => {
    const before = [await prisma.agendaOperacional.count(), await prisma.ocorrenciaOperacional.count(), await prisma.transacaoLog.count()];
    await prisma.$executeRawUnsafe(`CREATE FUNCTION quiosque.qa_agenda_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.nome = 'QA_FAIL' THEN RAISE EXCEPTION 'QA deliberate insert failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_agenda_fail BEFORE INSERT ON quiosque."OcorrenciaOperacional" FOR EACH ROW EXECUTE FUNCTION quiosque.qa_agenda_fail()`);
    await assert.rejects(() => schedule({ nome: 'QA_FAIL' }));
    assert.deepEqual([await prisma.agendaOperacional.count(), await prisma.ocorrenciaOperacional.count(), await prisma.transacaoLog.count()], before);
    await prisma.$executeRawUnsafe(`DROP TRIGGER qa_agenda_fail ON quiosque."OcorrenciaOperacional"`); await prisma.$executeRawUnsafe('DROP FUNCTION quiosque.qa_agenda_fail()');
  });
  await check('legacy active rule without start saves definition, preserves weekday and ID, then explicitly initializes generation', async () => {
    const rule = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Sem datas', diaSemana: 6, horaInicio: '18:00', horaFim: '20:00' } });
    const before = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${rule.id}/gerar`, payload: { inicio: '2026-10-23', fim: '2026-10-31' } });
    assert.equal(before.statusCode, 409, before.body); assert.equal(before.json().code, 'AGENDA_INICIO_NECESSARIO');
    const immutableHistoryStart = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${rule.id}`, payload: { primeiraData: '2026-10-23' } }); assert.equal(immutableHistoryStart.statusCode, 400, immutableHistoryStart.body);
    const saved = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${rule.id}`, payload: { nome: 'Regra editada', diaSemana: 5, horaInicio: '20:00', horaFim: '21:00', ultimaData: '2026-10-31', local: 'Igarapé' } }); assert.equal(saved.statusCode, 200, saved.body);
    const persisted = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: rule.id } });
    assert.equal(persisted.id, rule.id); assert.equal(persisted.nome, 'Regra editada'); assert.equal(persisted.diaSemana, 5); assert.equal(persisted.primeiraData, null); assert.equal(persisted.ultimaData?.toISOString().slice(0, 10), '2026-10-31'); assert.equal(persisted.ativa, true);
    const reloaded = await inject({ method: 'GET', url: '/api/operacao/agenda/ocorrencias?inicio=2026-10-01&fim=2026-10-31' }); assert.equal(reloaded.statusCode, 200); assert.equal(reloaded.json().agendas.find((row: any) => row.id === rule.id).diaSemana, 5);
    const resumeUrl = `/api/operacao/agenda/agendas/${rule.id}/retomar`;
    const needsReference = await inject({ method: 'POST', url: resumeUrl, payload: { requestId: randomUUID() } }); assert.equal(needsReference.statusCode, 409); assert.equal(needsReference.json().code, 'AGENDA_INICIO_NECESSARIO');
    const resumed = await inject({ method: 'POST', url: resumeUrl, payload: { requestId: randomUUID(), aPartirDe: '2026-10-23' } }); assert.equal(resumed.statusCode, 200, resumed.body); assert.deepEqual(resumed.json().datas, ['2026-10-23', '2026-10-30']);
    const afterResume = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: rule.id } }); assert.equal(afterResume.primeiraData, null); assert.equal(afterResume.geracaoDesde?.toISOString().slice(0, 10), '2026-10-23');
  });
  await check('inactive rule edits without reactivation or new dates', async () => {
    const rule = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Inativa', diaSemana: 6, horaInicio: '18:00', horaFim: '20:00', ativa: false } });
    const result = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${rule.id}`, payload: { nome: 'Inativa editada', diaSemana: 0, local: 'Bar' } }); assert.equal(result.statusCode, 200, result.body);
    const persisted = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: rule.id } }); assert.equal(persisted.ativa, false); assert.equal(persisted.nome, 'Inativa editada'); assert.equal(persisted.diaSemana, 0); assert.equal(persisted.geracaoDesde, null);
    assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: rule.id } }), 0);
  });
  await check('one-off retry and per-occurrence edit preserve ID and history', async () => {
    const body = input({ repetirSemanalmente: false, fim: undefined });
    const a = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body }); const b = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: body });
    assert.equal(a.statusCode, 200, a.body); assert.deepEqual(a.json(), b.json());
    const id = a.json().ocorrenciaId;
    const edited = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ repetirSemanalmente: false, ocorrenciaId: id, nome: 'Editada', data: '2026-10-11', fim: undefined }) }); assert.equal(edited.statusCode, 200, edited.body); assert.equal(edited.json().ocorrenciaId, id);
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id } })).nome, 'Editada');
  });
  await check('same start, partial overlap and contained intervals return a scoped 409; adjacent intervals are allowed', async () => {
    const date = '2027-01-08';
    await occurrence('Igarapé', { data: new Date(`${date}T00:00:00Z`), horaInicio: '18:00', horaFim: '20:00' });
    for (const [start, end] of [['18:00', '19:00'], ['19:00', '21:00'], ['18:30', '19:00']] as const) {
      const response = await postSchedule(input({ repetirSemanalmente: false, data: date, horaInicio: start, horaFim: end, fim: undefined }));
      assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().code, 'AGENDA_HORARIO_CONFLITO');
      assert.deepEqual(response.json().details.conflito, { nome: 'Igarapé', data: date, horaInicio: '18:00', horaFim: '20:00' });
    }
    for (const [start, end] of [['16:00', '18:00'], ['20:00', '22:00']] as const) {
      const response = await postSchedule(input({ repetirSemanalmente: false, data: date, horaInicio: start, horaFim: end, fim: undefined })); assert.equal(response.statusCode, 200, response.body);
    }
  });
  await check('alternate occurrence and date-generation routes enforce required valid intervals and conflicts', async () => {
    const date = '2027-04-02'; const blocker = await occurrence('Alternate route blocker', { data: new Date(`${date}T00:00:00Z`), horaInicio: '18:00', horaFim: '20:00' });
    const missingEnd = await postSchedule(input({ repetirSemanalmente: false, data: '2027-04-09', horaFim: null, fim: undefined })); assert.equal(missingEnd.statusCode, 400, missingEnd.body); assert.equal(missingEnd.json().code, 'AGENDA_HORARIO_OBRIGATORIO');
    const overnight = await postSchedule(input({ repetirSemanalmente: false, data: '2027-04-09', horaInicio: '23:00', horaFim: '01:00', fim: undefined })); assert.equal(overnight.statusCode, 400, overnight.body); assert.equal(overnight.json().code, 'AGENDA_INTERVALO_INVALIDO');
    const alternative = await inject({ method: 'POST', url: '/api/operacao/agenda/ocorrencias', payload: { nome: 'Alt route', data: date, horaInicio: '19:00', horaFim: '21:00' } }); assert.equal(alternative.statusCode, 409, alternative.body); assert.equal(alternative.json().code, 'AGENDA_HORARIO_CONFLITO');
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const rule = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Generator blocker', diaSemana: day, primeiraData: new Date(`${date}T00:00:00Z`), geracaoDesde: new Date(`${date}T00:00:00Z`), ultimaData: new Date(`${date}T00:00:00Z`), horaInicio: '19:00', horaFim: '21:00' } });
    const before = await prisma.ocorrenciaOperacional.count({ where: { agendaId: rule.id } });
    const generated = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${rule.id}/gerar`, payload: { inicio: date, fim: date } }); assert.equal(generated.statusCode, 409, generated.body); assert.equal(generated.json().code, 'AGENDA_HORARIO_CONFLITO');
    assert.equal(await prisma.ocorrenciaOperacional.count({ where: { agendaId: rule.id } }), before);
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: blocker.id } })).status, 'PROGRAMADA');
  });
  await check('edit excludes its own reservation, rejects a new overlap, and cancellation frees its interval', async () => {
    const date = '2027-01-15';
    const blocker = await occurrence('Bloqueio', { data: new Date(`${date}T00:00:00Z`), horaInicio: '18:00', horaFim: '20:00' });
    const target = await occurrence('Editar', { data: new Date(`${date}T00:00:00Z`), horaInicio: '12:00', horaFim: '13:00' });
    const unchanged = await postSchedule(input({ repetirSemanalmente: false, ocorrenciaId: target.id, data: date, horaInicio: '12:00', horaFim: '13:00', fim: undefined })); assert.equal(unchanged.statusCode, 200, unchanged.body);
    const conflicted = await postSchedule(input({ repetirSemanalmente: false, ocorrenciaId: target.id, data: date, horaInicio: '19:00', horaFim: '21:00', fim: undefined })); assert.equal(conflicted.statusCode, 409, conflicted.body); assert.equal(conflicted.json().code, 'AGENDA_HORARIO_CONFLITO');
    const canceled = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${blocker.id}/cancelar`, payload: {} }); assert.equal(canceled.statusCode, 200, canceled.body);
    const free = await postSchedule(input({ repetirSemanalmente: false, data: date, horaInicio: '18:00', horaFim: '20:00', fim: undefined })); assert.equal(free.statusCode, 200, free.body);
  });
  await check('archived recurring dates remain reserved and a weekly collision rolls back the entire rule', async () => {
    const recurring = input({ nome: 'Regra arquivada QA', data: '2026-11-07', fim: '2026-11-28' });
    const saved = await postSchedule(recurring); assert.equal(saved.statusCode, 200, saved.body);
    const archived = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${saved.json().agendaId}/arquivar`, payload: {} }); assert.equal(archived.statusCode, 200, archived.body);
    const afterArchive = await postSchedule(input({ repetirSemanalmente: false, data: recurring.data, horaInicio: '19:00', horaFim: '21:00', fim: undefined })); assert.equal(afterArchive.statusCode, 409, afterArchive.body);
    const rollbackBase = new Date('2027-02-06T00:00:00Z'); const conflictDate = new Date(rollbackBase); conflictDate.setUTCDate(conflictDate.getUTCDate() + 7);
    await occurrence('Weekly blocker', { data: conflictDate, horaInicio: '19:00', horaFim: '21:00' });
    const beforeRules = await prisma.agendaOperacional.count(); const beforeRows = await prisma.ocorrenciaOperacional.count();
    const weekly = await postSchedule(input({ nome: 'Rollback semanal QA', data: rollbackBase.toISOString().slice(0, 10), fim: '2027-02-20', horaInicio: '18:00', horaFim: '20:00' }));
    assert.equal(weekly.statusCode, 409, weekly.body); assert.equal(weekly.json().code, 'AGENDA_HORARIO_CONFLITO');
    assert.equal(await prisma.agendaOperacional.count(), beforeRules); assert.equal(await prisma.ocorrenciaOperacional.count(), beforeRows);
  });
  await check('same retry remains idempotent and concurrent conflicting creates serialize by PDV', async () => {
    const body = input({ repetirSemanalmente: false, data: '2027-03-05', horaInicio: '10:00', horaFim: '11:00', fim: undefined });
    const first = await postSchedule(body); assert.equal(first.statusCode, 200, first.body);
    const retry = await postSchedule(body); assert.equal(retry.statusCode, 200, retry.body); assert.deepEqual(retry.json(), first.json());
    const concurrentDate = '2027-03-12';
    const [left, right] = await Promise.all([
      postSchedule(input({ nome: 'Concorrente A', repetirSemanalmente: false, data: concurrentDate, horaInicio: '18:00', horaFim: '20:00', fim: undefined })),
      postSchedule(input({ nome: 'Concorrente B', repetirSemanalmente: false, data: concurrentDate, horaInicio: '19:00', horaFim: '21:00', fim: undefined })),
    ]);
    assert.deepEqual([left.statusCode, right.statusCode].sort(), [200, 409]); assert.equal(await prisma.ocorrenciaOperacional.count({ where: { data: new Date(`${concurrentDate}T00:00:00Z`), nome: { startsWith: 'Concorrente ' } } }), 1);
  });
  await check('incomplete legacy interval blocks same start and unknown comparisons; name edit and completion remain possible', async () => {
    const date = '2027-03-19'; const legacy = await occurrence('Teste antigo', { data: new Date(`${date}T00:00:00Z`), horaInicio: '17:00', horaFim: null });
    const sameStart = await postSchedule(input({ repetirSemanalmente: false, data: date, horaInicio: '17:00', horaFim: '18:00', fim: undefined })); assert.equal(sameStart.statusCode, 409, sameStart.body); assert.equal(sameStart.json().code, 'AGENDA_HORARIO_CONFLITO');
    const uncertain = await postSchedule(input({ repetirSemanalmente: false, data: date, horaInicio: '18:00', horaFim: '19:00', fim: undefined })); assert.equal(uncertain.statusCode, 409, uncertain.body); assert.equal(uncertain.json().code, 'AGENDA_HORARIO_INCOMPLETO');
    const nameEdit = await postSchedule({ requestId: randomUUID(), nome: 'Teste antigo editado', data: date, repetirSemanalmente: false, ocorrenciaId: legacy.id, local: 'Salão' }); assert.equal(nameEdit.statusCode, 200, nameEdit.body);
    const completed = await postSchedule(input({ repetirSemanalmente: false, data: date, ocorrenciaId: legacy.id, horaInicio: '17:00', horaFim: '18:00', fim: undefined })); assert.equal(completed.statusCode, 200, completed.body);
    const afterCompletion = await postSchedule(input({ repetirSemanalmente: false, data: date, horaInicio: '18:00', horaFim: '19:00', fim: undefined })); assert.equal(afterCompletion.statusCode, 200, afterCompletion.body);
  });
  await check('cancel preserves record and atomic audit; retry emits no duplicate audit', async () => {
    const row = await occurrence(); const before = await prisma.transacaoLog.count();
    for (let i = 0; i < 2; i++) { const response = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/cancelar`, payload: {} }); assert.equal(response.statusCode, 200, response.body); }
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: row.id } })).status, 'CANCELADA'); assert.equal(await prisma.transacaoLog.count(), before + 1);
    const log = await prisma.transacaoLog.findFirstOrThrow({ where: { entidadeId: row.id } }); assert.equal((log.metadata as any).acao, 'AGENDAMENTO_CANCELADO');
  });
  await check('restore preserves occurrence id/cancel audit, checks conflict, retries once, and atomically completes legacy times', async () => {
    const date = '2028-04-10'; const row = await occurrence('Restaurável QA', { data: new Date(`${date}T00:00:00Z`), horaInicio: '18:00', horaFim: '20:00' });
    const canceled = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/cancelar`, payload: {} }); assert.equal(canceled.statusCode, 200, canceled.body);
    const blocker = await occurrence('Conflito QA', { data: row.data, horaInicio: '19:00', horaFim: '21:00' }); const beforeConflictLogs = await prisma.transacaoLog.count(); const requestId = randomUUID();
    const conflict = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/restaurar`, payload: { requestId, data: date, horaInicio: '18:00', horaFim: '20:00' } });
    assert.equal(conflict.statusCode, 409, conflict.body); assert.equal(conflict.json().code, 'AGENDA_HORARIO_CONFLITO'); assert.equal(conflict.json().details.conflito.nome, 'Conflito QA');
    assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: row.id } })).status, 'CANCELADA'); assert.equal(await prisma.transacaoLog.count(), beforeConflictLogs);
    const restored = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/restaurar`, payload: { requestId, data: date, horaInicio: '21:00', horaFim: '22:00' } }); assert.equal(restored.statusCode, 200, restored.body);
    const retry = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/restaurar`, payload: { requestId, data: date, horaInicio: '21:00', horaFim: '22:00' } }); assert.equal(retry.statusCode, 200, retry.body); assert.deepEqual(retry.json(), restored.json());
    const after = await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: row.id } }); assert.equal(after.id, row.id); assert.equal(after.status, 'PROGRAMADA'); assert.equal(after.horaInicio, '21:00'); assert.equal(after.horaFim, '22:00');
    const logs = await prisma.transacaoLog.findMany({ where: { entidadeId: row.id }, orderBy: { createdAt: 'asc' } }); assert.equal(logs.filter((log) => (log.metadata as any).acao === 'AGENDAMENTO_CANCELADO').length, 1); assert.equal(logs.filter((log) => (log.metadata as any).acao === 'AGENDAMENTO_RESTAURADO').length, 1); assert.equal((logs.at(-1)!.metadata as any).atorId, owner.id); assert.equal((logs.at(-1)!.metadata as any).statusAnterior, 'CANCELADA'); assert.ok(await prisma.ocorrenciaOperacional.findUnique({ where: { id: blocker.id } }));

    const legacy = await occurrence('Sem término QA', { data: new Date('2028-04-11T00:00:00Z'), horaInicio: '17:00', horaFim: null, status: 'CANCELADA' }); const incompleteId = randomUUID();
    const incomplete = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${legacy.id}/restaurar`, payload: { requestId: incompleteId } }); assert.equal(incomplete.statusCode, 409, incomplete.body); assert.equal(incomplete.json().code, 'AGENDA_HORARIO_INCOMPLETO'); assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: legacy.id } })).status, 'CANCELADA');
    const completed = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${legacy.id}/restaurar`, payload: { requestId: incompleteId, horaInicio: '17:00', horaFim: '18:00' } }); assert.equal(completed.statusCode, 200, completed.body); assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: legacy.id } })).status, 'PROGRAMADA');
  });
  await check('restore rejects open, closed, linked, foreign and unauthorized records without writes', async () => {
    const before = await prisma.transacaoLog.count();
    for (const status of ['ABERTA', 'FECHADA'] as const) { const row = await occurrence('Não cancelável', { status }); const response = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${row.id}/restaurar`, payload: { requestId: randomUUID() } }); assert.equal(response.statusCode, 409, response.body); assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: row.id } })).status, status); }
    const linked = await occurrence('Com caixa', { status: 'CANCELADA' }); await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, ocorrenciaId: linked.id, diaOperacional: linked.data, status: 'FECHADO', trocoInicial: 0, abertoPorId: owner.id } });
    const linkedResponse = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${linked.id}/restaurar`, payload: { requestId: randomUUID() } }); assert.equal(linkedResponse.statusCode, 409, linkedResponse.body); assert.equal((await prisma.ocorrenciaOperacional.findUniqueOrThrow({ where: { id: linked.id } })).status, 'CANCELADA');
    const foreignTenant = await prisma.cervejaria.create({ data: { nome: 'Foreign restore', slug: `restore-foreign-${randomUUID()}` } }); const foreignPdv = await prisma.pontoVenda.create({ data: { nome: 'Foreign', cervejariaId: foreignTenant.id } }); const foreign = await prisma.ocorrenciaOperacional.create({ data: { nome: 'Foreign canceled', cervejariaId: foreignTenant.id, pontoVendaId: foreignPdv.id, data: new Date('2028-04-12T00:00:00Z'), horaInicio: '18:00', horaFim: '20:00', status: 'CANCELADA' } });
    const foreignResponse = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${foreign.id}/restaurar`, payload: { requestId: randomUUID() } }); assert.equal(foreignResponse.statusCode, 404, foreignResponse.body);
    const deniedRow = await occurrence('Denied', { status: 'CANCELADA' }); const denied = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${deniedRow.id}/restaurar`, headers: { 'x-qa-user': staff.id }, payload: { requestId: randomUUID() } }); assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(await prisma.transacaoLog.count(), before);
  });
  await check('restore serializes against overlapping reservations and preserves inactive/archived weekly rule', async () => {
    const date = '2028-05-10'; const canceled = await occurrence('Concurrent restore', { data: new Date(`${date}T00:00:00Z`), horaInicio: '18:00', horaFim: '20:00', status: 'CANCELADA' });
    const createBody = input({ repetirSemanalmente: false, data: date, horaInicio: '19:00', horaFim: '21:00', fim: undefined });
    const responses = await Promise.all([inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${canceled.id}/restaurar`, payload: { requestId: randomUUID(), data: date, horaInicio: '18:00', horaFim: '20:00' } }), postSchedule(createBody)]);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]); assert.equal(await prisma.ocorrenciaOperacional.count({ where: { cervejariaId: tenant.id, pontoVendaId: point.id, data: new Date(`${date}T00:00:00Z`), status: { not: 'CANCELADA' } } }), 1);
    const rule = await schedule(); const ruleId = rule.agendaId!; await prisma.agendaOperacional.update({ where: { id: ruleId }, data: { ativa: false, archivedAt: new Date() } });
    const seriesOccurrence = await prisma.ocorrenciaOperacional.findFirstOrThrow({ where: { agendaId: ruleId } }); await prisma.ocorrenciaOperacional.update({ where: { id: seriesOccurrence.id }, data: { status: 'CANCELADA' } });
    const response = await inject({ method: 'POST', url: `/api/operacao/agenda/ocorrencias/${seriesOccurrence.id}/restaurar`, payload: { requestId: randomUUID() } }); assert.equal(response.statusCode, 200, response.body);
    const unchangedRule = await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: ruleId } }); assert.equal(unchangedRule.ativa, false); assert.ok(unchangedRule.archivedAt);
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
    const ownedRule = await prisma.agendaOperacional.create({ data: { cervejariaId: tenant.id, pontoVendaId: point.id, nome: 'Permission fixture', diaSemana: 5, horaInicio: '18:00', horaFim: '20:00' } });
    const deniedEdit = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${ownedRule.id}`, headers: { 'x-qa-user': staff.id }, payload: { nome: 'Denied edit' } }); assert.equal(deniedEdit.statusCode, 403, deniedEdit.body);
    const other = await prisma.cervejaria.create({ data: { nome: 'QA foreign tenant', slug: `foreign-${randomUUID()}` } });
    const otherPoint = await prisma.pontoVenda.create({ data: { nome: 'QA foreign PDV', cervejariaId: other.id } });
    const otherRule = await prisma.agendaOperacional.create({ data: { nome: 'Foreign rule', cervejariaId: other.id, pontoVendaId: otherPoint.id, diaSemana: 6, horaInicio: '18:00' } });
    const otherRow = await prisma.ocorrenciaOperacional.create({ data: { nome: 'Foreign date', cervejariaId: other.id, pontoVendaId: otherPoint.id, data: row.data } });
    const foreignEdit = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ agendaId: otherRule.id }) }); assert.equal(foreignEdit.statusCode, 400, foreignEdit.body);
    const foreignRuleEdit = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${otherRule.id}`, payload: { nome: 'Cross tenant write' } }); assert.equal(foreignRuleEdit.statusCode, 404, foreignRuleEdit.body);
    assert.equal((await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: ownedRule.id } })).nome, 'Permission fixture');
    assert.equal((await prisma.agendaOperacional.findUniqueOrThrow({ where: { id: otherRule.id } })).nome, 'Foreign rule');
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
    const archiveInput = input({ nome: 'Regra para arquivar' }); archiveInput.fim = plusDays(archiveInput.data, 35);
    const created = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: archiveInput }); assert.equal(created.statusCode, 200, created.body);
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
    const listed = await inject({ method: 'GET', url: `/api/operacao/agenda/ocorrencias?inicio=${archiveInput.data}&fim=${archiveInput.fim}` }); assert.equal(listed.statusCode, 200, listed.body); assert.ok(!listed.json().agendas.some((rule: any) => rule.id === id)); assert.equal(listed.json().ocorrencias.filter((row: any) => row.agendaId === id).length, 6);
    const archivedList = await inject({ method: 'GET', url: '/api/operacao/agenda/agendas/arquivadas' }); assert.equal(archivedList.statusCode, 200, archivedList.body); assert.equal(archivedList.json().agendas.find((rule: any) => rule.id === id)._count.ocorrencias, 6);
    const generate = await inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${id}/gerar`, payload: { inicio: '2026-11-15', fim: '2026-12-31' } }); assert.equal(generate.statusCode, 409, generate.body);
    const save = await inject({ method: 'POST', url: '/api/operacao/agenda/agendamentos', payload: input({ agendaId: id }) }); assert.equal(save.statusCode, 400, save.body);
    const legacyPatch = await inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${id}`, payload: { ativa: true } }); assert.equal(legacyPatch.statusCode, 400, legacyPatch.body);
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
