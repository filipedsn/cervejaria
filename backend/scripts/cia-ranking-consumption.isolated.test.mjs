import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { PrismaClient } from '@prisma/client';
import { buildApp, setupSocketIO } from '../src/app.js';
import { signUserToken } from '../src/lib/session.js';
import { emitToCervejaria, realtimeRoomTenantCommands } from '../src/lib/realtime.js';
import { AUTH_COOKIE_NAME } from '../src/lib/security-config.js';
import { chromium } from '../../node_modules/playwright/index.mjs';

assert.equal(validateIsolatedQaEnvironment(process.env).toString(), process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const app = await buildApp();
setupSocketIO(app, app.server);
await app.ready();
function day(value) { return new Date(`${value}T00:00:00.000Z`); }
function operationalDateSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function auth(user) { return { authorization: `Bearer ${signUserToken(app, user)}` }; }
async function check(name, fn) { process.stdout.write(`RUN ${name}\n`); await fn(); process.stdout.write(`PASS ${name}\n`); }
try {
  const company = await prisma.cervejaria.create({ data: { nome: `CIA Ranking QA ${suffix}`, slug: `cia-rank-${suffix}` } });
  const foreignCompany = await prisma.cervejaria.create({ data: { nome: `CIA Outra QA ${suffix}`, slug: `cia-other-${suffix}` } });
  const point = await prisma.pontoVenda.create({ data: { cervejariaId: company.id, nome: 'Principal QA', ativo: true, usaCaixa: true } });
  const foreignPoint = await prisma.pontoVenda.create({ data: { cervejariaId: foreignCompany.id, nome: 'Outro PDV QA', ativo: true, usaCaixa: true } });
  for (const [tenant, pdv] of [[company, point], [foreignCompany, foreignPoint]]) {
    await prisma.configuracaoOperacao.create({ data: { cervejariaId: tenant.id, ativo: true, exclusivo: true } });
    await prisma.configuracaoOperacional.create({ data: { cervejariaId: tenant.id, setupCompletedAt: day('2026-10-01'), directSalesEnabled: true, plannedOperationsEnabled: true, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: true } });
    await prisma.configuracaoPontoVenda.create({ data: { cervejariaId: tenant.id, pontoVendaId: pdv.id, tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: true, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } });
  }
  const owner = await prisma.usuario.create({ data: { nome: 'Owner QA', email: `owner-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'DONO' } });
  const denied = await prisma.usuario.create({ data: { nome: 'Denied QA', email: `denied-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'ATENDENTE', permissoesOperacao: [] } });
  const viewer = await prisma.usuario.create({ data: { nome: 'Viewer QA', email: `viewer-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: company.id, papel: 'ATENDENTE', permissoesOperacao: ['command.read'] } });
  const foreignOwner = await prisma.usuario.create({ data: { nome: 'Foreign QA', email: `foreign-${suffix}@qa.test`, senhaHash: 'QA_ONLY', cervejariaId: foreignCompany.id, papel: 'DONO' } });
  const primaryClient = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Cliente Homônimo QA', telefone: null } });
  const homonym = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: 'Cliente Homônimo QA', telefone: null } });
  const foreignClient = await prisma.cliente.create({ data: { cervejariaId: foreignCompany.id, nome: 'Cliente Homônimo QA', telefone: null } });
  await prisma.clienteEstatisticas.create({ data: { clienteId: primaryClient.id } });
  const saleDay = operationalDateSaoPaulo();
  const saleDayDate = day(saleDay);
  const saleWeekday = saleDayDate.getUTCDay();
  const salesItatiaiaAgenda = await prisma.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Itatiaia QA · ${suffix}`, diaSemana: saleWeekday, primeiraData: saleDayDate, ultimaData: saleDayDate, horaInicio: '18:00', horaFim: '22:00', ativa: true } });
  const salesIgarapeAgenda = await prisma.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Igarapé QA · ${suffix}`, diaSemana: saleWeekday, primeiraData: saleDayDate, ultimaData: saleDayDate, horaInicio: '18:00', horaFim: '22:00', ativa: true } });
  const salesIgarapeOccurrence = await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: salesIgarapeAgenda.id, nome: 'Igarapé QA', data: saleDayDate, horaInicio: '18:00', horaFim: '22:00' } });
  const salesItatiaiaOccurrence = await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: salesItatiaiaAgenda.id, nome: 'Itatiaia QA', data: saleDayDate, horaInicio: '18:00', horaFim: '22:00' } });
  const salesClientPhone = `119${String(Date.now()).slice(-8)}`;
  const salesClient = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: `Cliente E2E QA ${suffix}`, telefone: salesClientPhone } });
  const beerCategory = await prisma.categoriaProdutoPdv.create({ data: { cervejariaId: company.id, nome: 'Chope', nomeNormalizado: 'chope', gamificada: false } });
  const mountedBeer = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Chope Montado QA ${suffix}`, categoria: 'Chope', categoriaPdvId: beerCategory.id, tipo: 'BEBIDA', formato: 'CHOPE', exigePreparo: true } });
  await prisma.preco.createMany({ data: [[300, 12], [500, 18], [700, 24]].map(([volumeMl, preco]) => ({ produtoId: mountedBeer.id, volumeMl, preco })) });
  const salesMenu = await prisma.cardapio.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: `Cardápio E2E QA ${suffix}`, chopeVolumesConfigurados: true, produtos: { create: [[300, 12], [500, 18], [700, 24]].map(([volumeMl, preco]) => ({ produtoId: mountedBeer.id, cervejariaId: company.id, pontoVendaId: point.id, volumeMl, precoUnit: preco })) } } });
  const salesTap = await prisma.tap.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, numero: 1, nome: 'E2E', ativo: true } });
  const agenda = await prisma.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Itatiaia QA', diaSemana: 5, primeiraData: day('2025-07-01'), ultimaData: day('2026-11-30'), horaInicio: '18:00', horaFim: '22:00', ativa: true } });
  const agendaIgarape = await prisma.agendaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Igarapé QA', diaSemana: 5, primeiraData: day('2026-10-01'), ultimaData: day('2026-11-30'), horaInicio: '18:00', horaFim: '22:00', ativa: true } });
  const occurrenceRows = [];
  for (const value of ['2025-07-01', '2026-10-01', '2026-10-31', '2026-11-01']) {
    occurrenceRows.push(await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: agenda.id, nome: 'Sextas QA', data: day(value), horaInicio: '18:00', horaFim: '22:00' } }));
  }
  const igarapeOccurrenceRows = [];
  for (const value of ['2026-10-01', '2026-10-31', '2026-11-01']) {
    igarapeOccurrenceRows.push(await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: agendaIgarape.id, nome: 'Igarapé QA', data: day(value), horaInicio: '18:00', horaFim: '22:00' } }));
  }
  const oneOffRows = new Map();
  for (const value of ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']) {
    oneOffRows.set(value, await prisma.ocorrenciaOperacional.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, agendaId: null, nome: `Avulsa ${value} QA`, data: day(value), horaInicio: '18:00', horaFim: '22:00' } }));
  }
  const product = await prisma.produto.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, nome: 'Chope QA', tipo: 'BEBIDA', formato: 'CHOPE' } });
  async function sale({ client = primaryClient, origin = 'EVENTO', occurrence, operationalDate, volume, status = 'FECHADA', canceled = false, paid = false, discount = 0, pointOfSale = point, product: saleProduct = product }) {
    const command = await prisma.comanda.create({ data: { origem: origin, clienteId: client.id, status, tipo: 'COMANDA', pontoVendaId: pointOfSale.id, ocorrenciaId: occurrence?.id ?? null, diaOperacional: operationalDate ? day(operationalDate) : null, total: 10 - discount, desconto: discount, fechadaEm: day(occurrence?.data.toISOString().slice(0, 10) ?? operationalDate ?? '2026-10-01') } });
    await prisma.itemComanda.create({ data: { comandaId: command.id, produtoId: saleProduct.id, volumeMl: volume, quantidade: 1, precoUnit: 10, ...(canceled ? { canceladoEm: day('2026-10-02') } : {}) } });
    if (paid) await prisma.pagamento.create({ data: { comandaId: command.id, forma: 'PIX', valor: 10 - discount } });
    return command;
  }
  await sale({ occurrence: occurrenceRows[0], volume: 1500, paid: true, discount: 2 });
  await sale({ occurrence: occurrenceRows[1], volume: 500 });
  await sale({ origin: 'CAIXA', occurrence: occurrenceRows[1], operationalDate: '2026-10-01', volume: 300 });
  await sale({ occurrence: occurrenceRows[2], volume: 1000, client: homonym });
  await sale({ occurrence: occurrenceRows[3], volume: 700 });
  await sale({ occurrence: occurrenceRows[1], volume: 900, canceled: true, status: 'CANCELADA' });
  await sale({ occurrence: igarapeOccurrenceRows[0], volume: 1200 });
  await sale({ origin: 'CAIXA', occurrence: igarapeOccurrenceRows[1], operationalDate: '2026-10-31', volume: 400 });
  await sale({ occurrence: igarapeOccurrenceRows[2], volume: 600 });
  const igarapeExclusiveClient = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: `Exclusivo Igarapé QA ${suffix}`, telefone: null } });
  await sale({ client: igarapeExclusiveClient, occurrence: igarapeOccurrenceRows[1], volume: 2500 });
  const foreignProduct = await prisma.produto.create({ data: { cervejariaId: foreignCompany.id, pontoVendaId: foreignPoint.id, nome: 'Chope estrangeiro QA', tipo: 'BEBIDA', formato: 'CHOPE' } });
  await sale({ client: foreignClient, pointOfSale: foreignPoint, product: foreignProduct, volume: 500, status: 'FECHADA' });

  const cardinalityDays = new Map();
  for (const [count, date] of [[1, '2026-12-02'], [2, '2026-12-03'], [3, '2026-12-04'], [12, '2026-12-05']]) {
    const clients = [];
    for (let index = 0; index < count; index++) {
      const clientName = count === 12 && index === 11
        ? `Participante 12 com nome extenso para testar quebra em telas menores QA ${suffix}`
        : `Participante ${String(index + 1).padStart(2, '0')} QA ${suffix}`;
      const client = await prisma.cliente.create({ data: { cervejariaId: company.id, nome: clientName, telefone: null } });
      clients.push(client);
      await sale({ client, origin: 'CAIXA', occurrence: oneOffRows.get(date), operationalDate: date, volume: (count - index) * 100 });
    }
    cardinalityDays.set(count, { date, clients });
  }

  await check('ranking is canonical by tenant and PDV and accepts migrated EVENTO and current CAIXA origins', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?ocorrenciaId=${occurrenceRows[1].id}&agendaId=${agenda.id}&dia=2026-10-01`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.ocorrencia.data, '2026-10-01');
    assert.deepEqual(body.ranking.map((row) => [row.clienteId, row.totalMl]), [[primaryClient.id, 800]]);
    const deniedResponse = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}`, headers: auth(denied) });
    assert.equal(deniedResponse.statusCode, 403, deniedResponse.body);
    const foreignResponse = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}`, headers: auth(foreignOwner) });
    assert.equal(foreignResponse.statusCode, 404, foreignResponse.body);
    const foreignLaunch = await app.inject({ method: 'POST', url: '/api/operacao/comandas', headers: auth(foreignOwner), payload: { pontoVendaId: point.id, tipo: 'APELIDO', identificador: `foreign-${suffix}` } });
    assert.equal(foreignLaunch.statusCode, 404, foreignLaunch.body);
  });

  await check('daily API returns the same participant count, total, and stable position for 0, 1, 2, 3, and many participants', async () => {
    const missingOccurrence = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=2026-12-01`, headers: auth(owner) });
    assert.equal(missingOccurrence.statusCode, 400, missingOccurrence.body);
    const empty = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=2026-12-01&ocorrenciaId=${oneOffRows.get('2026-12-01').id}`, headers: auth(owner) });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().ranking, []);
    for (const count of [1, 2, 3, 12]) {
      const { date, clients } = cardinalityDays.get(count);
      const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=${date}&ocorrenciaId=${oneOffRows.get(date).id}`, headers: auth(owner) });
      assert.equal(response.statusCode, 200, response.body);
      const rows = response.json().ranking;
      assert.equal(rows.length, count);
      assert.equal(rows.reduce((sum, row) => sum + row.totalMl, 0), clients.reduce((sum, _client, index) => sum + (count - index) * 100, 0));
      assert.deepEqual(rows.map((row) => row.posicao), Array.from({ length: count }, (_, index) => index + 1));
      assert.deepEqual(rows.map((row) => row.clienteId), clients.map((client) => client.id));
    }
  });

  await check('monthly DATE boundaries include October 1 and 31, exclude November 1, and list months from sales', async () => {
    const previousTz = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati';
    try {
      const response = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agenda.id}&mes=2026-10`, headers: auth(owner) });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.deepEqual(body.mesesDisponiveis, ['2026-11', '2026-10', '2025-07']);
      assert.equal(body.entries.reduce((sum, row) => sum + row.totalMl, 0), 1800);
      assert.equal(body.entries.length, 2, 'same-name clients remain separate identities');
      assert.deepEqual(new Set(body.entries.map((row) => row.clienteId)), new Set([primaryClient.id, homonym.id]));
    } finally { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
  });

  await check('monthly and general ranking stay inside the selected agenda and month boundaries', async () => {
    const itatiaiaMonth = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agenda.id}&mes=2026-10`, headers: auth(owner) });
    const igarapeMonth = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agendaIgarape.id}&mes=2026-10`, headers: auth(owner) });
    const itatiaiaGeneral = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agenda.id}`, headers: auth(owner) });
    const igarapeGeneral = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agendaIgarape.id}`, headers: auth(owner) });
    for (const response of [itatiaiaMonth, igarapeMonth, itatiaiaGeneral, igarapeGeneral]) assert.equal(response.statusCode, 200, response.body);
    assert.equal(itatiaiaMonth.json().entries.reduce((sum, row) => sum + row.totalMl, 0), 1800);
    assert.equal(igarapeMonth.json().entries.reduce((sum, row) => sum + row.totalMl, 0), 4100);
    assert.equal(itatiaiaGeneral.json().entries.reduce((sum, row) => sum + row.totalMl, 0), 4000);
    assert.equal(igarapeGeneral.json().entries.reduce((sum, row) => sum + row.totalMl, 0), 4700);
    const itatiaiaShared = itatiaiaGeneral.json().entries.find((row) => row.clienteId === primaryClient.id);
    const igarapeShared = igarapeGeneral.json().entries.find((row) => row.clienteId === primaryClient.id);
    assert.equal(itatiaiaShared.totalMl, 3000);
    assert.equal(igarapeShared.totalMl, 2200);
    assert.ok(!itatiaiaGeneral.json().entries.some((row) => row.clienteId === igarapeExclusiveClient.id));
    assert.ok(!igarapeGeneral.json().entries.some((row) => row.clienteId === homonym.id));
    assert.deepEqual(igarapeGeneral.json().mesesDisponiveis, ['2026-11', '2026-10']);
    assert.equal(itatiaiaGeneral.json().agenda.id, agenda.id);
    assert.equal(igarapeGeneral.json().agenda.id, agendaIgarape.id);
  });

  await check('agenda and occurrence parameters are validated within the selected company and PDV', async () => {
    const mismatch = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agenda.id}&ocorrenciaId=${igarapeOccurrenceRows[0].id}`, headers: auth(owner) });
    assert.equal(mismatch.statusCode, 400, mismatch.body);
    const invalidDailyContext = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?ocorrenciaId=${igarapeOccurrenceRows[0].id}&agendaId=${agenda.id}`, headers: auth(owner) });
    assert.equal(invalidDailyContext.statusCode, 400, invalidDailyContext.body);
    const foreignAgenda = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${foreignPoint.id}`, headers: auth(owner) });
    assert.equal(foreignAgenda.statusCode, 404, foreignAgenda.body);
    const unassignedAccumulation = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${oneOffRows.get('2026-12-01').id}`, headers: auth(owner) });
    assert.equal(unassignedAccumulation.statusCode, 404, unassignedAccumulation.body);
    const standaloneDay = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?ocorrenciaId=${oneOffRows.get('2026-12-02').id}`, headers: auth(owner) });
    assert.equal(standaloneDay.statusCode, 200, standaloneDay.body);
    assert.equal(standaloneDay.json().ranking.length, 1);
    assert.equal(standaloneDay.json().ranking[0].totalMl, 100);
  });

  await check('recurrence aggregation preserves exact agenda identity and occurrence picker reaches older history', async () => {
    const ranking = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`, headers: auth(owner) });
    assert.equal(ranking.statusCode, 200, ranking.body);
    assert.equal(ranking.json().ranking.reduce((sum, row) => sum + row.totalMl, 0), 4000);
    const rankingBeforeEdit = ranking.json().ranking;
    await prisma.agendaOperacional.update({ where: { id: agenda.id }, data: { nome: 'Itatiaia QA editada', diaSemana: 4, horaInicio: '19:00' } });
    const afterDefinitionEdit = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agenda.id}`, headers: auth(owner) });
    assert.equal(afterDefinitionEdit.statusCode, 200, afterDefinitionEdit.body);
    assert.deepEqual(afterDefinitionEdit.json().ranking, rankingBeforeEdit, 'definition changes do not change agenda identity or historical ranking');
    const list = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/ocorrencias`, headers: auth(owner) });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(list.json().ocorrencias.some((row) => row.id === occurrenceRows[0].id && row.data === '2025-07-01'));
  });

  await check('customer history keeps unpaid closed sale, exposes canonical context, and never fabricates an event ID', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/clientes/${primaryClient.id}/historico`, headers: auth(owner) });
    assert.equal(response.statusCode, 200, response.body);
    const rows = response.json().items;
    assert.ok(rows.some((row) => row.ocorrencia?.id === occurrenceRows[1].id && row.evento === null && row.pontoVenda.id === point.id));
    assert.ok(rows.some((row) => row.status === 'CANCELADA'));
    assert.ok(rows.some((row) => row.total === 0 && row.valorPendente === 10));
    assert.ok(rows.some((row) => row.total === 8 && row.desconto === 2 && row.valorPendente === 0));
    const detail = await app.inject({ method: 'GET', url: `/api/clientes/${primaryClient.id}`, headers: auth(owner) });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().estatisticas.totalComandasFechadas, 7);
    assert.equal(detail.json().estatisticas.totalMlChope, 5200);
    assert.equal(detail.json().estatisticas.totalGasto, 8);
    const foreignHistory = await app.inject({ method: 'GET', url: `/api/clientes/${foreignClient.id}/historico`, headers: auth(owner) });
    assert.equal(foreignHistory.statusCode, 404, foreignHistory.body);
  });

  await check('ranking desktop, mobile, TV, filters, and permissions use the real local API and disposable PostgreSQL fixtures', async () => {
    const apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
    const apiPort = app.server.address().port;
    const portProbe = net.createServer();
    await new Promise((resolve, reject) => portProbe.once('error', reject).listen(0, '127.0.0.1', resolve));
    const frontendPort = portProbe.address().port;
    await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
    const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
    const frontendRoot = path.resolve('../frontend');
    const vite = spawn(process.execPath, [path.join(frontendRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      cwd: frontendRoot,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, VITE_API_PORT: String(apiPort), VITE_SOCKET_URL: apiOrigin },
    });
    let browser;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (vite.exitCode !== null) throw new Error(`Vite exited before readiness: ${vite.exitCode}`);
        try { if ((await fetch(frontendOrigin)).ok) { ready = true; break; } } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(ready, true, 'Vite frontend did not become ready');
      browser = await chromium.launch({ headless: true });
      const screenshots = path.resolve(process.env.QA_EVIDENCE_DIR ?? '../.worktrees/ranking-agenda-scope-evidence');
      await mkdir(screenshots, { recursive: true });

      const ownerToken = signUserToken(app, owner);
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      await context.addInitScript((key) => localStorage.setItem(key, '1'), `tap-quiver:onboarding-dismissed:${company.id}:${owner.id}`);
      await context.addCookies([{ name: AUTH_COOKIE_NAME, value: ownerToken, url: frontendOrigin, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      const rankingUrl = (params) => `${frontendOrigin}/operacao/ranking?${new URLSearchParams({ pontoVendaId: point.id, ...params })}`;
      const volumeLabel = (totalMl) => {
        const liters = totalMl / 1000;
        const digits = liters >= 10 ? 1 : 2;
        return `${liters.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} L`;
      };
      const waitForSuccessfulRefresh = async (target) => {
        await target.locator('.tap-champions-updated').waitFor();
        await target.waitForFunction(() => !document.querySelector('.tap-champions-updated')?.textContent?.includes('aguardando'), null, { timeout: 15000 });
      };
      const waitForCommandsSocket = async () => {
        const room = realtimeRoomTenantCommands(company.id);
        for (let attempt = 0; attempt < 40; attempt++) {
          const connected = [...app.io.of('/').sockets.values()].some((socket) => socket.rooms.has(room));
          if (connected) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Browser did not join the authenticated tenant commands socket room.');
      };
      await check('real browser sale lifecycle opens scheduled and unscheduled turns, launches priced beer, pays, closes, reconciles history and ranking', async () => {
        const operationUrl = `${frontendOrigin}/operacao/comandas?pontoVendaId=${encodeURIComponent(point.id)}`;
        const records = [];
        async function openTurn(occurrenceId, label) {
          await page.goto(operationUrl, { waitUntil: 'domcontentloaded' });
          const occurrenceSelect = page.getByRole('combobox', { name: 'Agendamento de hoje' });
          await occurrenceSelect.waitFor({ timeout: 15000 });
          await occurrenceSelect.click();
          await page.getByRole('option', { name: occurrenceId === salesIgarapeOccurrence.id ? 'Igarapé QA' : occurrenceId === salesItatiaiaOccurrence.id ? 'Itatiaia QA' : 'Abrir sem agendamento' }).click();
          const savedMenuMode = page.getByRole('button', { name: 'Cardápio salvo', exact: true });
          try { await savedMenuMode.click({ timeout: 10000 }); } catch {
            throw new Error(`${label}: saved-menu selector unavailable url=${page.url()} buttons=${JSON.stringify(await page.getByRole('button').allInnerTexts())} body=${(await page.locator('body').innerText()).slice(0, 1800)}`);
          }
          await page.getByRole('radio', { name: new RegExp(salesMenu.nome) }).click();
          await page.getByLabel('Troco inicial em reais').fill('0,00');
          await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
          const openingResponse = page.waitForResponse((response) => response.url().includes('/api/operacao/caixa/abrir') && response.request().method() === 'POST');
          await page.getByRole('button', { name: 'Confirmar e abrir caixa' }).click();
          const opened = await openingResponse;
          assert.equal(opened.status(), 201, `${label}: opening route: ${await opened.text()}`);
          const openedBody = await opened.json();
          const turn = await prisma.sessaoCaixaOperacao.findUnique({ where: { id: openedBody.id } });
          assert.ok(turn, `${label}: UI opening creates a cash session`);
          assert.equal(turn.ocorrenciaId, occurrenceId ?? null);
          if (occurrenceId) assert.equal((await prisma.ocorrenciaOperacional.findUnique({ where: { id: turn.ocorrenciaId } })).agendaId, occurrenceId === salesIgarapeOccurrence.id ? salesIgarapeAgenda.id : salesItatiaiaAgenda.id);
          await page.getByRole('button', { name: 'Montar chope nas Taps' }).click();
          const tapSelect = page.locator('section.card select').first();
          await tapSelect.waitFor({ timeout: 15000 });
          await tapSelect.selectOption(mountedBeer.id);
          await page.locator('section.card p').filter({ hasText: mountedBeer.nome }).first().waitFor();
          const mounted = await prisma.tapMontagem.findFirst({ where: { sessaoCaixaId: turn.id, tapId: salesTap.id, produtoId: mountedBeer.id, encerradoEm: null } });
          assert.ok(mounted, `${label}: beer is mounted to the turn by the UI`);
          await page.getByRole('button', { name: 'Fechar', exact: true }).click();
          records.push({ label, turnId: turn.id, occurrenceId: occurrenceId ?? null, trocoInicial: Number(turn.trocoInicial) });
          return turn;
        }
        async function launchAndPay(volumes, label, expectedTotal) {
          await page.getByRole('link', { name: 'Nova comanda', exact: true }).click();
          await page.waitForURL(/\/operacao\/comandas\/nova$/);
          await page.locator('input[type="tel"]').fill(salesClientPhone);
          await page.locator('input[autocomplete="off"]').waitFor();
          await page.waitForFunction((name) => document.querySelector('input[autocomplete="off"]')?.value === name, salesClient.nome);
          const commandCreate = page.waitForResponse((response) => response.url().endsWith('/api/operacao/comandas') && response.request().method() === 'POST');
          await page.getByRole('button', { name: 'Abrir comanda', exact: true }).click();
          const createdCommand = await commandCreate;
          assert.equal(createdCommand.status(), 201, `${label}: create-command route: ${await createdCommand.text()}`);
          const createdCommandBody = await createdCommand.json();
          await page.getByRole('button', { name: '+ Itens', exact: true }).click();
          await page.getByRole('dialog').waitFor();
          const itemTabs = await page.getByRole('dialog').locator('.segmented-control button').allInnerTexts();
          if (!itemTabs.some((tab) => /chope/i.test(tab))) {
            const tapData = await page.evaluate(async (id) => (await fetch(`/api/operacao/caixa/taps?pontoVendaId=${id}`, { credentials: 'include' })).json(), point.id);
            const productData = await page.evaluate(async (id) => (await fetch(`/api/operacao/produtos?pontoVendaId=${id}&incluirTodosChopes=true`, { credentials: 'include' })).json(), point.id);
            throw new Error(`Tap tab missing. tabs=${JSON.stringify(itemTabs)} taps=${JSON.stringify(tapData)} products=${JSON.stringify(productData)}`);
          }
          await page.getByRole('button', { name: /chope/i }).first().click();
          const dialogText = await page.getByRole('dialog').innerText();
          if (!/Tap|torneira/i.test(dialogText)) {
            const tapData = await page.evaluate(async (id) => (await fetch(`/api/operacao/caixa/taps?pontoVendaId=${id}`, { credentials: 'include' })).json(), point.id);
            throw new Error(`No mounted tap in launch dialog. dialog=${dialogText} taps=${JSON.stringify(tapData)}`);
          }
          for (const volume of volumes) {
            const tapButtons = page.getByRole('dialog').locator('button').filter({ hasText: mountedBeer.nome });
            assert.equal(await tapButtons.count(), 1, `exactly one mounted tap button must appear in the launch dialog: ${await page.getByRole('dialog').innerText()}`);
            await tapButtons.first().click();
            await page.getByRole('button', { name: new RegExp(`${volume} ml`) }).click();
            const price = ({ 300: 'R$ 12,00', 500: 'R$ 18,00', 700: 'R$ 24,00' })[volume];
            await page.getByText(`${price} cada`, { exact: false }).waitFor();
            const launchCall = page.waitForResponse((response) => response.url().includes(`/api/operacao/comandas/${createdCommandBody.id}/pedidos`) && response.request().method() === 'POST');
            await page.getByRole('button', { name: 'Adicionar à comanda', exact: true }).click();
            const launchResult = await launchCall;
            assert.equal(launchResult.status(), 201, `${label}: immediate tap launch: ${await launchResult.text()}`);
            await page.getByRole('button', { name: 'Adicionar à comanda', exact: true }).waitFor();
          }
          const detailPath = new URL(page.url()).pathname;
          const comandaId = detailPath.split('/').at(-1);
          assert.ok(comandaId, `${label}: comanda route includes its server ID`);
          assert.equal(createdCommandBody.id, comandaId, `${label}: browser route retains the server command ID`);
          await page.locator('text=Consumo da comanda').waitFor();
          const beforePayment = await prisma.comanda.findUnique({ where: { id: comandaId }, include: { itens: true } });
          assert.equal(beforePayment.clienteId, salesClient.id);
          assert.equal(beforePayment.ocorrenciaId, records.at(-1).occurrenceId);
          if (volumes.length === 3) {
            await page.locator('body').screenshot({ path: path.join(screenshots, 'sale-igarape-desktop.png'), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('body').screenshot({ path: path.join(screenshots, 'sale-igarape-mobile.png'), fullPage: true });
            await page.setViewportSize({ width: 1440, height: 1000 });
          }
          const returned = await prisma.comanda.findUniqueOrThrow({ where: { id: comandaId } });
          assert.equal(Number(returned.total), expectedTotal, `${label}: server calculated the explicit menu total`);
          records.at(-1).valorLancado = Number(returned.total);
          await page.getByRole('button', { name: 'Fechar', exact: true }).click();
          if (volumes.length === 3) {
            await page.locator('body').screenshot({ path: path.join(screenshots, 'sale-igarape-launch-confirmed-desktop.png'), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('body').screenshot({ path: path.join(screenshots, 'sale-igarape-launch-confirmed-mobile.png'), fullPage: true });
            await page.setViewportSize({ width: 1440, height: 1000 });
          }
          const stored = await prisma.comanda.findUnique({ where: { id: comandaId }, include: { itens: true, pagamentos: true } });
          assert.equal(Number(stored.total), expectedTotal);
          assert.deepEqual(stored.itens.map((item) => item.volumeMl).sort((a, b) => a - b), [...volumes].sort((a, b) => a - b));
          assert.ok(stored.itens.every((item) => item.produtoId === mountedBeer.id && item.tapId === salesTap.id), `${label}: items preserve product and tap IDs`);
          let amountToPay = expectedTotal;
          let netVolumeMl = volumes.reduce((sum, volume) => sum + volume, 0);
          if (volumes.length === 3) {
            const baseline = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=${saleDay}&ocorrenciaId=${salesIgarapeOccurrence.id}`, headers: auth(owner) });
            assert.equal(baseline.statusCode, 200, baseline.body);
            assert.equal(baseline.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 1500, 'all launched volumes count before cancellation');
            await page.goto(`${frontendOrigin}/operacao/comandas/${comandaId}`, { waitUntil: 'domcontentloaded' });
            const cancellationTarget = await prisma.itemComanda.findFirst({ where: { comandaId, volumeMl: 500 }, orderBy: { createdAt: 'asc' } });
            assert.ok(cancellationTarget, '500 ml line is linked to the active command by item ID');
            const cancellationTargetRow = page.locator(`[data-comanda-item-id="${cancellationTarget.id}"]`);
            await cancellationTargetRow.waitFor({ state: 'visible', timeout: 15000 });
            assert.equal(await cancellationTargetRow.count(), 1, 'the rendered sale line is linked by item ID');
            await cancellationTargetRow.getByRole('button', { name: `Remover ${cancellationTarget.nome}`, exact: true }).click();
            await page.getByRole('heading', { name: /Cancelar item/ }).waitFor();
            await page.locator('#cancel-delivered-quantity').fill('1');
            await page.locator('#cancel-delivered-reason').fill('Chope de 500 ml preparado e entregue; ajuste solicitado pelo cliente.');
            const cancelResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/operacao/comandas/${comandaId}/itens/${cancellationTarget.id}`) && response.request().method() === 'DELETE');
            await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
            const cancelResponse = await cancelResponsePromise;
            assert.equal(cancelResponse.status(), 200, `delivered-item cancellation route: ${await cancelResponse.text()}`);
            const cancelBody = await cancelResponse.json();
            const cancelPayload = cancelResponse.request().postDataJSON();
            assert.equal(cancelPayload.quantidade, 1);
            assert.equal(cancelPayload.quantidadeEsperada, 1);
            assert.equal(cancelPayload.tratamentoEstoque, 'PREPARADO_ENTREGUE_OU_PERDIDO');
            assert.equal(Number(cancelBody.total), 36);
            const retry = await page.evaluate(async ({ url, payload }) => {
              const response = await fetch(url, { method: 'DELETE', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
              return { status: response.status, body: await response.json() };
            }, { url: `/api/operacao/comandas/${comandaId}/itens/${cancellationTarget.id}`, payload: cancelPayload });
            assert.equal(retry.status, 200, JSON.stringify(retry.body));
            assert.equal(Number(retry.body.total), 36, 'same idempotency key cannot remove the R$18 twice');
            const persistedCancellation = await prisma.itemComandaCancelamentoEntregue.findMany({ where: { itemComandaId: cancellationTarget.id } });
            assert.equal(persistedCancellation.length, 1);
            assert.equal(Number(persistedCancellation[0].valorRetirado), 18);
            assert.equal(persistedCancellation[0].tratamentoEstoque, 'SEM_RETORNO_PRODUTO_PREPARADO_ENTREGUE_OU_PERDIDO');
            assert.equal(await prisma.inventoryMovement.count({ where: { pedidoId: cancellationTarget.pedidoCozinhaId, produtoId: mountedBeer.id } }), 0, 'prepared or delivered volume is not returned to stock');
            const cancelledItem = await prisma.itemComanda.findUniqueOrThrow({ where: { id: cancellationTarget.id } });
            assert.ok(cancelledItem.canceladoEm, 'cancelled item remains as a historical line');
            const commandAfterCancellation = await prisma.comanda.findUniqueOrThrow({ where: { id: comandaId } });
            assert.equal(Number(cancelBody.subtotal), 36);
            assert.equal(Number(commandAfterCancellation.desconto), 0, 'retry does not apply a discount');
            assert.equal(Number(commandAfterCancellation.total), 36);
            assert.equal(await prisma.pagamento.count({ where: { comandaId } }), 0, 'cancellation precedes payment');
            const afterCancelRank = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=${saleDay}&ocorrenciaId=${salesIgarapeOccurrence.id}`, headers: auth(owner) });
            assert.equal(afterCancelRank.statusCode, 200, afterCancelRank.body);
            assert.equal(afterCancelRank.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 1000);
            amountToPay = 36;
            records.at(-1).valorAposCancelamento = amountToPay;
            netVolumeMl = 1000;
            records.at(-1).cancelledItemId = cancellationTarget.id;
            records.at(-1).cancellationId = persistedCancellation[0].id;
            records.at(-1).cancellationRetryRepeated = persistedCancellation.length === 1 && Number(retry.body.total) === 36;
            records.at(-1).cancelledValue = Number(persistedCancellation[0].valorRetirado);
            records.at(-1).stockTreatment = persistedCancellation[0].tratamentoEstoque;
            records.at(-1).cancelledLinePreserved = true;
          } else {
            await page.goto(`${frontendOrigin}/operacao/comandas/${comandaId}`, { waitUntil: 'domcontentloaded' });
          }
          await page.getByRole('button', { name: /Fechar Comanda/ }).click();
          await page.getByRole('button', { name: new RegExp(`Revisar pagamento · R\\$ ${amountToPay.toFixed(2).replace('.', ',')}`) }).click();
          const settlementCall = page.waitForResponse((response) => response.url().includes(`/api/operacao/comandas/${comandaId}/pagamentos`) && response.request().method() === 'POST');
          await page.getByRole('button', { name: new RegExp(`Efetuar pagamento · R\\$ ${amountToPay.toFixed(2).replace('.', ',')}`) }).click();
          const paymentResponse = await settlementCall;
          assert.equal(paymentResponse.status(), 200, `${label}: payment route: ${await paymentResponse.text()}`);
          const paymentBody = await paymentResponse.json();
          const paymentPayload = paymentResponse.request().postDataJSON();
          assert.equal(paymentPayload.pagamentos.reduce((sum, payment) => sum + payment.valor, 0), amountToPay);
          assert.equal(Number(paymentBody.total), amountToPay);
          assert.equal(Number(paymentBody.valorEmAberto), 0);
          await page.getByRole('button', { name: 'OK', exact: true }).click();
          const closed = await prisma.comanda.findUnique({ where: { id: comandaId }, include: { itens: true, pagamentos: true } });
          assert.equal(closed.status, 'FECHADA');
          assert.equal(closed.pagamentos.length, 1);
          assert.equal(Number(closed.pagamentos[0].valor), amountToPay);
          records.at(-1).valorRecebido = Number(closed.pagamentos[0].valor);
          records.at(-1).desconto = Number(closed.desconto);
          records.at(-1).pendencia = 0;
          records.at(-1).valorCobrado = amountToPay;
          assert.equal(Number(closed.desconto), 0);
          assert.equal(closed.ocorrenciaId, records.at(-1).occurrenceId);
          records.at(-1).comandaId = comandaId;
          records.at(-1).volumeMl = netVolumeMl;
          records.at(-1).valorLancado = expectedTotal;
          return comandaId;
        }
        async function closeTurn(expectedPix, label) {
          await page.goto(`${frontendOrigin}/operacao/caixa?pontoVendaId=${encodeURIComponent(point.id)}`, { waitUntil: 'domcontentloaded' });
          const showCashPanel = page.getByRole('button', { name: 'Mostrar painel do caixa' });
          if (await showCashPanel.count()) await showCashPanel.click();
          await page.getByRole('button', { name: 'Fechar caixa', exact: true }).click();
          await page.getByLabel(/Contado.*Dinheiro/).fill('0,00');
          await page.getByLabel(/Conferido.*Pix/).fill(expectedPix.toFixed(2).replace('.', ','));
          await page.getByLabel(/Conferido.*Débito/).fill('0,00');
          await page.getByLabel(/Conferido.*Crédito/).fill('0,00');
          const closeResponse = page.waitForResponse((response) => response.url().includes('/api/operacao/caixa/fechar') && response.request().method() === 'POST');
          await page.getByRole('button', { name: 'Confirmar fechamento' }).click();
          const closedResponse = await closeResponse;
          assert.equal(closedResponse.status(), 200, `${label}: close route: ${await closedResponse.text()}`);
          const turn = await prisma.sessaoCaixaOperacao.findFirst({ where: { id: records.at(-1).turnId } });
          assert.equal(turn.status, 'FECHADO');
          assert.equal(Number(turn.contadoPix), expectedPix);
          assert.equal(Number(turn.contadoDinheiro), 0);
          assert.equal(Number(turn.trocoInicial), 0);
          assert.equal(records.at(-1).valorRecebido, expectedPix, `${label}: cash close matches payment receipts`);
          records.at(-1).pixConferido = expectedPix;
          records.at(-1).fechado = true;
          return turn;
        }

        await openTurn(salesIgarapeOccurrence.id, 'Igarapé');
        const igarapeComandaId = await launchAndPay([300, 500, 700], 'Igarapé', 54);
        await closeTurn(36, 'Igarapé');
        await openTurn(salesItatiaiaOccurrence.id, 'Itatiaia');
        const itatiaiaComandaId = await launchAndPay([500], 'Itatiaia', 18);
        await closeTurn(18, 'Itatiaia');
        await openTurn(null, 'Sem agendamento');
        const unscheduledComandaId = await launchAndPay([300], 'Sem agendamento', 12);
        await closeTurn(12, 'Sem agendamento');

        const historical = await app.inject({ method: 'GET', url: `/api/clientes/${salesClient.id}/historico`, headers: auth(owner) });
        assert.equal(historical.statusCode, 200, historical.body);
        const saleRows = historical.json().items.filter((row) => [igarapeComandaId, itatiaiaComandaId, unscheduledComandaId].includes(row.id));
        const saleNetVolumes = saleRows.map((row) => row.itens.filter((item) => !item.canceladoEm && !item.cancelamentoPendenteEm).reduce((sum, item) => sum + item.volumeMl * item.quantidade, 0)).sort((a, b) => a - b);
        assert.deepEqual(saleNetVolumes, [300, 500, 1000]);
        const cancelledHistoryItem = saleRows.find((row) => row.id === igarapeComandaId).itens.find((item) => item.volumeMl === 500);
        assert.ok(cancelledHistoryItem.canceladoEm, 'customer history retains the cancelled 500 ml line');
        assert.equal(saleRows.find((row) => row.id === igarapeComandaId).ocorrencia.id, salesIgarapeOccurrence.id);
        assert.equal(saleRows.find((row) => row.id === itatiaiaComandaId).ocorrencia.id, salesItatiaiaOccurrence.id);
        assert.equal(saleRows.find((row) => row.id === unscheduledComandaId).ocorrencia, null);
        assert.deepEqual([igarapeComandaId, itatiaiaComandaId, unscheduledComandaId].map((id) => Number(saleRows.find((row) => row.id === id).total)).sort((a, b) => a - b), [12, 18, 36]);
        assert.ok(saleRows.every((row) => row.evento === null && row.pontoVenda.id === point.id && row.desconto === 0 && row.valorPendente === 0));
        const igarapeDaily = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=${saleDay}&ocorrenciaId=${salesIgarapeOccurrence.id}`, headers: auth(owner) });
        const itatiaiaDaily = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}?dia=${saleDay}&ocorrenciaId=${salesItatiaiaOccurrence.id}`, headers: auth(owner) });
        assert.equal(igarapeDaily.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 1000);
        assert.equal(itatiaiaDaily.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 500);
        const detail = await app.inject({ method: 'GET', url: `/api/clientes/${salesClient.id}`, headers: auth(owner) });
        assert.equal(detail.json().estatisticas.totalMlChope, 1800);

        for (const [name, agendaId, occurrenceId, expectedMl] of [['igarape', salesIgarapeAgenda.id, salesIgarapeOccurrence.id, 1000], ['itatiaia', salesItatiaiaAgenda.id, salesItatiaiaOccurrence.id, 500]]) {
          const period = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agendaId}&mes=${saleDay.slice(0, 7)}`, headers: auth(owner) });
          assert.equal(period.statusCode, 200, period.body);
          assert.equal(period.json().entries.find((row) => row.clienteId === salesClient.id).totalMl, expectedMl);
          const general = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/periodo?agendaId=${agendaId}`, headers: auth(owner) });
          assert.equal(general.statusCode, 200, general.body);
          assert.equal(general.json().entries.find((row) => row.clienteId === salesClient.id).totalMl, expectedMl);
          const perAgenda = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${agendaId}`, headers: auth(owner) });
          assert.equal(perAgenda.statusCode, 200, perAgenda.body);
          assert.equal(perAgenda.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, expectedMl);
          await page.goto(rankingUrl({ dia: saleDay, ocorrenciaId: occurrenceId }), { waitUntil: 'domcontentloaded' });
          await page.locator('.tap-champions-podium-card').first().waitFor({ timeout: 15000 });
          await waitForSuccessfulRefresh(page);
          const uiMl = await page.locator('.tap-champions-podium-volume').first().innerText();
          assert.equal(uiMl, volumeLabel(expectedMl));
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.tap-champions-podium-card').first().waitFor({ timeout: 15000 });
          await waitForSuccessfulRefresh(page);
          assert.equal(await page.locator('.tap-champions-podium-volume').first().innerText(), volumeLabel(expectedMl), 'reload does not duplicate consumption');
          const screenshotPath = path.join(screenshots, `ranking-${name}-daily-desktop.png`);
          await page.locator('.ranking-operational').screenshot({ path: screenshotPath });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator('.ranking-operational').screenshot({ path: path.join(screenshots, `ranking-${name}-daily-mobile.png`) });
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
        const renameAgenda = await app.inject({ method: 'PATCH', url: `/api/operacao/agenda/agendas/${salesIgarapeAgenda.id}`, headers: auth(owner), payload: { nome: `Igarape QA renamed ${suffix}` } });
        assert.equal(renameAgenda.statusCode, 200, renameAgenda.body);
        const renamedRanking = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${salesIgarapeAgenda.id}`, headers: auth(owner) });
        assert.equal(renamedRanking.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 1000, 'agenda rename preserves historical identity');
        const archiveAgenda = await app.inject({ method: 'POST', url: `/api/operacao/agenda/agendas/${salesIgarapeAgenda.id}/arquivar`, headers: auth(owner) });
        assert.equal(archiveAgenda.statusCode, 200, archiveAgenda.body);
        const archivedRanking = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${salesIgarapeAgenda.id}`, headers: auth(owner) });
        assert.equal(archivedRanking.statusCode, 200, archivedRanking.body);
        assert.equal(archivedRanking.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 1000, 'archiving an agenda does not transfer its consumption');
        const unaffectedAgenda = await app.inject({ method: 'GET', url: `/api/ranking/pdv/${point.id}/agendas/${salesItatiaiaAgenda.id}`, headers: auth(owner) });
        assert.equal(unaffectedAgenda.json().ranking.find((row) => row.clienteId === salesClient.id).totalMl, 500, 'the other agenda retains its own consumption after archive');
        await prisma.agendaOperacional.update({ where: { id: salesIgarapeAgenda.id }, data: { archivedAt: null, nome: salesIgarapeAgenda.nome } });
        await page.goto(`${frontendOrigin}/clientes/${salesClient.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Histórico de consumo', exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await page.getByText('1.8L', { exact: true }).count(), 1, 'customer browser stats match 1,800 ml net API history');
        assert.equal(await page.getByText('R$ 66,00', { exact: true }).count(), 1, 'customer browser received total matches settled API payments');
        assert.equal(await page.getByText('Saldo pendente', { exact: true }).count(), 0, 'settled customer history has no pending balance');
        const renderedHistory = await page.locator('article.card').allInnerTexts();
        assert.ok(renderedHistory.some((text) => text.includes('Igarapé QA') && [300, 500, 700].every((volume) => text.includes(`${volume} ml`))));
        assert.ok(renderedHistory.some((text) => text.includes('Itatiaia QA') && text.includes('500 ml')));
        assert.ok(renderedHistory.some((text) => text.includes(`Caixa · ${point.nome}`) && text.includes('300 ml')));
        await page.locator('body').screenshot({ path: path.join(screenshots, 'customer-history-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('body').screenshot({ path: path.join(screenshots, 'customer-history-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1000 });

        const databaseCommands = await prisma.$queryRaw`SELECT id, "clienteId", "pontoVendaId", "ocorrenciaId", total::text AS total, desconto::text AS desconto FROM public."Comanda" WHERE id IN (${igarapeComandaId}, ${itatiaiaComandaId}, ${unscheduledComandaId}) ORDER BY id`;
        const databaseItems = await prisma.$queryRaw`SELECT id, "comandaId", "produtoId", "tapId", "volumeMl", quantidade, "canceladoEm" FROM public."ItemComanda" WHERE "comandaId" IN (${igarapeComandaId}, ${itatiaiaComandaId}, ${unscheduledComandaId}) ORDER BY "comandaId", id`;
        assert.equal(databaseCommands.length, 3, 'read-only SQL confirms all three E2E commands');
        assert.ok(databaseCommands.every((row) => row.clienteId === salesClient.id && row.pontoVendaId === point.id));
        assert.equal(databaseCommands.find((row) => row.id === igarapeComandaId).ocorrenciaId, salesIgarapeOccurrence.id);
        assert.equal(databaseCommands.find((row) => row.id === itatiaiaComandaId).ocorrenciaId, salesItatiaiaOccurrence.id);
        assert.equal(databaseCommands.find((row) => row.id === unscheduledComandaId).ocorrenciaId, null);
        assert.ok(databaseItems.every((row) => row.produtoId === mountedBeer.id && row.tapId === salesTap.id));
        assert.ok(databaseItems.some((row) => row.id === records[0].cancelledItemId && row.canceladoEm));
        const manifest = { runId: process.env.QA_RUN_ID ?? suffix, companyId: company.id, pointOfSaleId: point.id, clientId: salesClient.id, agendaIds: { igarape: salesIgarapeAgenda.id, itatiaia: salesItatiaiaAgenda.id }, occurrenceIds: { igarape: salesIgarapeOccurrence.id, itatiaia: salesItatiaiaOccurrence.id }, cashSessions: records, productId: mountedBeer.id, menuId: salesMenu.id, tapId: salesTap.id, pricesByVolumeMl: { 300: 12, 500: 18, 700: 24 }, baselineVolumesMl: { igarape: 1500, itatiaia: 500, unscheduled: 300, consolidated: 2300 }, netVolumesMl: { igarape: 1000, itatiaia: 500, unscheduled: 300, consolidated: 1800 }, expectedVsObtained: [{ scope: 'Igarape before cancellation', expectedMl: 1500, obtainedMl: 1500, launched: 54, cancelled: 0, received: 0, discount: 0, pending: null }, { scope: 'Igarape after cancellation before payment', expectedMl: 1000, obtainedMl: 1000, launched: 54, cancelled: 18, received: 0, discount: 0, pending: null }, { scope: 'Igarape settled', expectedMl: 1000, obtainedMl: 1000, launched: 54, cancelled: 18, received: 36, discount: 0, pending: 0 }, { scope: 'Itatiaia', expectedMl: 500, obtainedMl: 500, launched: 18, cancelled: 0, received: 18, discount: 0, pending: 0 }, { scope: 'Unscheduled', expectedMl: 300, obtainedMl: 300, launched: 12, cancelled: 0, received: 12, discount: 0, pending: 0 }, { scope: 'Customer consolidated net', expectedMl: 1800, obtainedMl: 1800, launched: 84, cancelled: 18, received: 66, discount: 0, pending: 0 }], databaseReadOnly: { commands: databaseCommands, items: databaseItems } };
        await writeFile(path.join(screenshots, 'canonical-sale-evidence.json'), JSON.stringify(manifest, null, 2));
        console.log(`CANONICAL_SALE_EVIDENCE=${JSON.stringify(manifest)}`);
      });

      for (const [count, date] of [[0, '2026-12-01'], [1, '2026-12-02'], [2, '2026-12-03'], [3, '2026-12-04'], [12, '2026-12-05']]) {
        const occurrenceId = oneOffRows.get(date).id;
        await page.goto(rankingUrl({ dia: date, ocorrenciaId: occurrenceId }), { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Ranking de chope', exact: true }).waitFor({ timeout: 15000 });
        await page.locator('.tap-champions-stats').waitFor();
        await waitForSuccessfulRefresh(page);
        const apiResult = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}?dia=${date}&ocorrenciaId=${occurrenceId}`);
        assert.equal(apiResult.ranking.length, count);
        assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), count);
        assert.equal(await page.locator('.tap-champions-stat-value').nth(1).innerText(), volumeLabel(apiResult.ranking.reduce((sum, row) => sum + row.totalMl, 0)));
        assert.equal(await page.locator('.tap-champions-podium-card').count(), Math.min(count, 3));
        assert.equal(await page.locator('.tap-champions-rest-card').count(), Math.max(0, count - 3));
        if (count === 1 || count === 2) {
          const layoutColumns = await page.locator('.tap-champions-podium').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(/\s+/).length);
          assert.equal(layoutColumns, count, `${count} participant(s) use an adapted podium grid`);
        }
        const rendered = await page.locator('.tap-champions-podium-card,.tap-champions-rest-card').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
        const expected = apiResult.ranking.map((row) => `${row.posicao}º lugar: ${row.nome}`).sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]));
        assert.deepEqual(rendered.sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0])), expected);
        const viewport = await page.evaluate(() => ({ width: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
        assert.ok(viewport.documentWidth <= viewport.width, `horizontal overflow at ${viewport.width}px: ${viewport.documentWidth}px`);
        if (count === 12) {
          assert.equal(await page.locator('.ranking-client-link').count(), 12, 'owner can open customer history');
          await page.addStyleTag({ content: '.app-bottom-nav,.app-shell-header,.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
          await page.locator('.ranking-operational').screenshot({ path: path.join(screenshots, 'desktop.png') });
        }
      }

      await check('socket invalidation and visibility reconnection refresh launches and cancellations', async () => {
        await page.goto(rankingUrl({ dia: '2026-12-06', ocorrenciaId: oneOffRows.get('2026-12-06').id }), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.ranking-operational-state')?.textContent?.includes('consumo registrado'));
        await waitForCommandsSocket();
        const launched = await sale({ client: cardinalityDays.get(12).clients[0], origin: 'CAIXA', occurrence: oneOffRows.get('2026-12-06'), operationalDate: '2026-12-06', volume: 450 });
        emitToCervejaria(app.io, company.id, { type: 'operacao:comanda-atualizada', data: { comandaId: launched.id } });
        await page.locator('.tap-champions-podium-card').waitFor();
        await waitForSuccessfulRefresh(page);
        assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), 1);
        assert.equal(await page.locator('.tap-champions-podium-volume').innerText(), '0,45 L');
        await prisma.itemComanda.updateMany({ where: { comandaId: launched.id }, data: { canceladoEm: day('2026-12-06') } });
        await prisma.comanda.update({ where: { id: launched.id }, data: { status: 'CANCELADA' } });
        emitToCervejaria(app.io, company.id, { type: 'operacao:comanda-atualizada', data: { comandaId: launched.id } });
        await page.waitForFunction(() => document.querySelector('.ranking-operational-state')?.textContent?.includes('consumo registrado'));
        assert.equal(await page.locator('.tap-champions-podium-card').count(), 0);
        assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), 0);
        const afterReconnect = await sale({ client: cardinalityDays.get(12).clients[0], origin: 'CAIXA', occurrence: oneOffRows.get('2026-12-06'), operationalDate: '2026-12-06', volume: 750 });
        await page.context().setOffline(true);
        await page.waitForTimeout(100);
        await page.context().setOffline(false);
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.locator('.tap-champions-podium-card').waitFor();
        await waitForSuccessfulRefresh(page);
        assert.equal(await page.locator('.tap-champions-podium-volume').innerText(), '0,75 L', 'visibility reconnect refreshes the selected daily occurrence');
        assert.ok(afterReconnect.id);
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(rankingUrl({ dia: '2026-12-05', ocorrenciaId: oneOffRows.get('2026-12-05').id }), { waitUntil: 'domcontentloaded' });
      await page.locator('.tap-champions-rest-card').first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile layout has no horizontal overflow');
      assert.ok(await page.getByText(/nome extenso para testar quebra/i).isVisible());
      await page.addStyleTag({ content: '.app-bottom-nav,.app-shell-header,.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
      await page.locator('.ranking-operational').screenshot({ path: path.join(screenshots, 'mobile.png') });

      const monthly = new URLSearchParams({ pontoVendaId: point.id, escopo: 'mensal', mes: '2026-10', dia: '2026-10-01', agendaId: agenda.id });
      await page.goto(`${frontendOrigin}/operacao/ranking?${monthly}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.ranking-operational').waitFor();
      const agendaUiResponse = await page.evaluate(async (id) => { const response = await fetch(`/api/ranking/pdv/${id}/ocorrencias`, { credentials: 'include' }); return { status: response.status, body: await response.json() }; }, point.id);
      assert.equal(agendaUiResponse.status, 200, JSON.stringify(agendaUiResponse));
      assert.ok(agendaUiResponse.body.agendas.some((item) => item.id === agenda.id && item.nome === 'Itatiaia QA editada'), JSON.stringify(agendaUiResponse.body.agendas));
      await page.waitForTimeout(500);
      const agendaContextUi = await page.locator('.ranking-operational').innerText();
      assert.match(agendaContextUi, /Agenda · Itatiaia QA editada · Mensal · outubro de 2026/i, `agenda UI context missing; url=${page.url()} body=${agendaContextUi}`);
      const monthlyUiText = await page.locator('.ranking-operational').innerText();
      assert.match(monthlyUiText, /Agenda · Itatiaia QA editada · Mensal · outubro de 2026/i, `Unexpected monthly ranking context: ${monthlyUiText.slice(0, 800)}`);
      const monthApi = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}/periodo?agendaId=${agenda.id}&mes=2026-10`);
      await waitForSuccessfulRefresh(page);
      assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), monthApi.entries.length);
      assert.equal(await page.locator('.tap-champions-stat-value').nth(1).innerText(), volumeLabel(monthApi.entries.reduce((sum, row) => sum + row.totalMl, 0)));

      await page.goto(rankingUrl({ dia: '2026-10-01', ocorrenciaId: occurrenceRows[1].id }), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => new URL(location.href).searchParams.has('agendaId'));
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id, 'historical occurrence supplies its exact agenda context');
      await page.getByRole('button', { name: 'Mensal' }).click();
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id, 'switching to monthly keeps the selected agenda');
      assert.equal(new URL(page.url()).searchParams.get('ocorrenciaId'), occurrenceRows[1].id, 'switching scope preserves the selected occurrence context');
      await waitForSuccessfulRefresh(page);
      await page.getByRole('button', { name: 'Geral' }).click();
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id, 'switching to general keeps the selected agenda');
      await waitForSuccessfulRefresh(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForSuccessfulRefresh(page);
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id, 'refresh keeps the selected agenda');
      await page.goBack();
      await waitForSuccessfulRefresh(page);
      assert.equal(new URL(page.url()).searchParams.get('escopo'), 'mensal', 'browser back restores the previous scope');
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id, 'browser back restores the same agenda');
      await page.goForward();
      await waitForSuccessfulRefresh(page);
      assert.equal(new URL(page.url()).searchParams.get('escopo'), 'geral', 'browser forward restores the general scope');

      const general = new URLSearchParams({ pontoVendaId: point.id, escopo: 'geral', dia: '2026-10-01', agendaId: agenda.id });
      await page.goto(`${frontendOrigin}/operacao/ranking?${general}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Agenda · Itatiaia QA editada · Geral · todo o histórico').waitFor();
      const generalApi = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}/periodo?agendaId=${agenda.id}`);
      await waitForSuccessfulRefresh(page);
      assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), generalApi.entries.length);
      assert.equal(await page.locator('.tap-champions-stat-value').nth(1).innerText(), volumeLabel(generalApi.entries.reduce((sum, row) => sum + row.totalMl, 0)));

      await page.getByLabel('Agenda').selectOption(agendaIgarape.id);
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agendaIgarape.id, 'changing the agenda updates the URL context');
      await page.getByText('Agenda · Igarapé QA · Geral · todo o histórico').waitFor();
      const agendaApi = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), `/api/ranking/pdv/${point.id}/periodo?agendaId=${agendaIgarape.id}`);
      await waitForSuccessfulRefresh(page);
      assert.equal(Number(await page.locator('.tap-champions-stat-value').nth(0).innerText()), agendaApi.entries.length);
      assert.equal(await page.locator('.tap-champions-stat-value').nth(1).innerText(), volumeLabel(agendaApi.entries.reduce((sum, row) => sum + row.totalMl, 0)));
      const expectedAgendaCards = agendaApi.entries.map((row) => `${row.posicao}º lugar: ${row.nome}`);
      const agendaCards = await page.locator('.tap-champions-podium-card,.tap-champions-rest-card').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
      const byPosition = (a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]);
      assert.deepEqual([...agendaCards].sort(byPosition), [...expectedAgendaCards].sort(byPosition), 'pódio e lista do acumulado coincidem com a API');
      assert.ok(await page.getByText('Exclusivo Igarapé QA', { exact: false }).isVisible());
      await page.getByRole('link', { name: 'Abrir modo TV' }).click();
      await page.locator('.qt-tv .tap-champions').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('escopo'), 'geral');
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agendaIgarape.id);
      const tvCards = await page.locator('.qt-tv .tap-champions-podium-card,.qt-tv .tap-champions-rest-card').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
      assert.deepEqual([...tvCards].sort(byPosition), agendaApi.entries.map((row) => `${row.posicao}º lugar: ${row.nome}`).sort(byPosition), 'TV usa o mesmo conjunto filtrado da API');
      await page.getByRole('link', { name: 'Sair da tela cheia' }).click();
      assert.equal(new URL(page.url()).searchParams.get('escopo'), 'geral');
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agendaIgarape.id);

      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(rankingUrl({ dia: '2026-12-05', ocorrenciaId: oneOffRows.get('2026-12-05').id }), { waitUntil: 'domcontentloaded' });
      await page.locator('.ranking-operational').waitFor();
      const originalSearch = new URL(page.url()).search;
      await page.getByRole('link', { name: 'Abrir modo TV' }).click();
      await page.locator('.qt-tv .tap-champions').waitFor();
      assert.equal(new URL(page.url()).pathname, '/operacao/ranking/tv');
      assert.equal(new URL(page.url()).search, originalSearch, 'TV navigation preserves all ranking filters');
      assert.equal(await page.getByText('AO VIVO', { exact: true }).count(), 0, 'polling status is not mislabeled as live socket');
      await page.getByText('Atualiza a cada minuto').waitFor();
      assert.equal(await page.locator('.tap-champions-podium-card').count(), 3);
      assert.equal(await page.locator('.tap-champions-rest-card').count(), 9);
      const tvBody = await page.locator('body').innerText();
      assert.equal(tvBody.includes(viewer.email), false);
      assert.equal(tvBody.includes('@qa.test'), false, 'TV contains no email or personal contact details');
      await page.screenshot({ path: path.join(screenshots, 'tv.png'), fullPage: true });
      const fullscreenButton = page.getByRole('button', { name: 'Tela cheia do navegador' });
      await page.keyboard.press('Tab');
      assert.equal(await fullscreenButton.evaluate((el) => el.matches(':focus-visible')), true, 'fullscreen action has visible keyboard focus');
      await page.getByRole('link', { name: 'Sair da tela cheia' }).click();
      assert.equal(new URL(page.url()).pathname, '/operacao/ranking');
      assert.equal(new URL(page.url()).search, originalSearch, 'TV exit returns to the exact ranking context');

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${frontendOrigin}/operacao/comandas?pontoVendaId=${encodeURIComponent(point.id)}`, { waitUntil: 'domcontentloaded' });
      const trophy = page.getByRole('link', { name: 'Ranking de chope', exact: true });
      const qr = page.getByRole('button', { name: 'Abrir QR Code para comandas' });
      await trophy.waitFor();
      assert.equal(await page.locator('text=Ranking de chope').count(), 0, 'text-only ranking access is absent');
      assert.equal(await qr.count(), 1, 'QR Code control remains in the header');
      assert.equal(await trophy.getAttribute('title'), 'Ranking de chope', 'accessible name has a tooltip');
      const desktopHeaderGeometry = await page.locator('.app-shell-header').evaluate((header) => {
        const elements = [...header.querySelectorAll('a[aria-label="Ranking de chope"],button[aria-label="Abrir QR Code para comandas"]')];
        const rects = elements.map((element) => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; });
        return { width: document.documentElement.scrollWidth, viewport: window.innerWidth, rects };
      });
      assert.equal(desktopHeaderGeometry.rects.length, 2);
      assert.ok(desktopHeaderGeometry.rects[0].right <= desktopHeaderGeometry.rects[1].left || desktopHeaderGeometry.rects[1].right <= desktopHeaderGeometry.rects[0].left, 'QR and trophy do not overlap on desktop');
      assert.ok(desktopHeaderGeometry.width <= desktopHeaderGeometry.viewport, 'desktop header has no horizontal overflow');
      await trophy.focus();
      assert.equal(await trophy.evaluate((element) => element.matches(':focus-visible')), true, 'trophy has visible keyboard focus');
      await page.addStyleTag({ content: '.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
      await page.locator('.app-shell-header').screenshot({ path: path.join(screenshots, 'header-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addStyleTag({ content: '.fixed.top-0.left-0.right-0.z-50{display:none!important}' });
      const mobileGeometry = await page.locator('.app-shell-header').evaluate((header) => ({
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        rects: [...header.querySelectorAll('a[aria-label="Ranking de chope"],button[aria-label="Abrir QR Code para comandas"]')].map((element) => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { left, right, top, bottom }; }),
      }));
      assert.equal(mobileGeometry.rects.length, 2);
      assert.ok(mobileGeometry.rects[0].right <= mobileGeometry.rects[1].left || mobileGeometry.rects[1].right <= mobileGeometry.rects[0].left, 'QR and trophy do not overlap at 390 px');
      assert.ok(mobileGeometry.width <= mobileGeometry.viewport, 'mobile header has no horizontal overflow');
      await page.locator('.app-shell-header').screenshot({ path: path.join(screenshots, 'header-mobile.png') });
      await prisma.configuracaoPontoVenda.updateMany({ where: { cervejariaId: company.id, pontoVendaId: point.id }, data: { tapsEnabled: false } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.getByRole('link', { name: 'Ranking de chope', exact: true }).count(), 0, 'trophy is hidden when Taps is disabled');
      await prisma.configuracaoPontoVenda.updateMany({ where: { cervejariaId: company.id, pontoVendaId: point.id }, data: { tapsEnabled: true } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Ranking de chope', exact: true }).waitFor();
      await prisma.sessaoCaixaOperacao.create({ data: { cervejariaId: company.id, pontoVendaId: point.id, diaOperacional: day('2026-10-01'), status: 'ABERTO', trocoInicial: 0, abertoPorId: owner.id, ocorrenciaId: occurrenceRows[1].id } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await trophy.click();
      assert.equal(new URL(page.url()).pathname, '/operacao/ranking');
      assert.equal(new URL(page.url()).searchParams.get('pontoVendaId'), point.id, 'ranking link preserves the selected PDV');
      await page.waitForFunction(() => new URL(location.href).searchParams.has('agendaId'));
      assert.equal(new URL(page.url()).searchParams.get('ocorrenciaId'), occurrenceRows[1].id, 'turno aberto preselects its linked occurrence');
      assert.equal(new URL(page.url()).searchParams.get('agendaId'), agenda.id, 'linked occurrence supplies the agenda context');
      await context.close();

      const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await staffContext.addInitScript((key) => localStorage.setItem(key, '1'), `tap-quiver:onboarding-dismissed:${company.id}:${viewer.id}`);
      await staffContext.addCookies([{ name: AUTH_COOKIE_NAME, value: signUserToken(app, viewer), url: frontendOrigin, httpOnly: true, sameSite: 'Lax' }]);
      const staffPage = await staffContext.newPage();
      await staffPage.goto(rankingUrl({ dia: '2026-12-05', ocorrenciaId: oneOffRows.get('2026-12-05').id }), { waitUntil: 'domcontentloaded' });
      await staffPage.locator('.tap-champions-podium-card').first().waitFor();
      await waitForSuccessfulRefresh(staffPage);
      assert.equal(await staffPage.locator('.ranking-client-link').count(), 0, 'command.read without clients.manage has no customer-history link');
      await staffPage.goto(`${frontendOrigin}/operacao/comandas?pontoVendaId=${encodeURIComponent(point.id)}`, { waitUntil: 'domcontentloaded' });
      assert.equal(await staffPage.getByRole('link', { name: 'Ranking de chope', exact: true }).count(), 0, 'staff without command.read has no trophy in the header');
      await staffContext.close();

      const deniedContext = await browser.newContext({ serviceWorkers: 'block' });
      await deniedContext.addInitScript((key) => localStorage.setItem(key, '1'), `tap-quiver:onboarding-dismissed:${company.id}:${denied.id}`);
      await deniedContext.addCookies([{ name: AUTH_COOKIE_NAME, value: signUserToken(app, denied), url: frontendOrigin, httpOnly: true, sameSite: 'Lax' }]);
      const deniedPage = await deniedContext.newPage();
      await deniedPage.goto(`${frontendOrigin}/operacao/ranking/tv?pontoVendaId=${point.id}&dia=2026-12-05`, { waitUntil: 'domcontentloaded' });
      await deniedPage.waitForTimeout(500);
      assert.notEqual(new URL(deniedPage.url()).pathname, '/operacao/ranking/tv', 'TV remains protected by command.read');
      await deniedContext.close();
      console.log(`RANKING_UI_EVIDENCE=${screenshots}`);
      console.log(`RANKING_UI_API=${apiOrigin}`);
    } finally {
      await browser?.close();
      vite.kill();
    }
  });
} finally {
  await app.close();
  await prisma.$disconnect();
}
