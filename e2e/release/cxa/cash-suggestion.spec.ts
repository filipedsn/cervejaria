import { expect, test, loginPage, randomUUID } from '../support/ops';
import { prismaClient } from '../support/fixtures';

async function schedule(t: any, name: string, day: string, start = '08:00', end = '11:00') {
  return t.owner.expect(t.owner.post('/api/operacao/agenda/agendamentos', {
    requestId: randomUUID(), nome: name, data: day, horaInicio: start, horaFim: end, repetirSemanalmente: false,
  }), 200, 'synthetic schedule');
}
async function openScreen(page: any, t: any) {
  await loginPage(page, t.ownerEmail, t.ownerPassword);
  await page.goto(`/operacao/comandas?pontoVendaId=${t.pointId}`);
  await expect(page.getByLabel('Agendamento de hoje')).toBeVisible();
  await page.getByRole('button', { name: 'Cardápio salvo', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await page.getByRole('radio').click();
}
async function confirm(page: any) {
  await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Troco inicial');
  const response = page.waitForResponse((r: any) => r.url().endsWith('/api/operacao/caixa/abrir') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmar e abrir caixa', exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('CXA-S09 real browser confirmation persists the selected occurrence and new command', async ({ ops, page }, info) => {
  const t = await ops.tenant();
  const catalog = await t.seedCatalog();
  const state = await t.cashState();
  const day = state.diaOperacional;
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const occurrence = await schedule(t, 'Independent real QA', day);
  await openScreen(page, t);
  await expect(page.getByLabel('Agendamento de hoje')).toHaveValue(occurrence.ocorrenciaId);
  const db = prismaClient();
  const count = () => db.sessaoCaixaOperacao.count({ where: { pontoVendaId: t.pointId } });
  expect(await count()).toBe(0);
  await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Independent real QA');
  expect(await count()).toBe(0);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  expect(await count()).toBe(0);
  await confirm(page);
  const rows = await db.sessaoCaixaOperacao.findMany({ where: { pontoVendaId: t.pointId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ ocorrenciaId: occurrence.ocorrenciaId, cardapioId: catalog.cardapioId, status: 'ABERTO' });
  expect(Number(rows[0].trocoInicial)).toBe(100);
  const command = await t.openComanda(t.owner, []);
  const persisted = await db.comanda.findUniqueOrThrow({ where: { id: command.id } });
  expect(persisted).toMatchObject({ ocorrenciaId: occurrence.ocorrenciaId, sessaoCaixaRealizacaoId: rows[0].id });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Abrir caixa', exact: true })).toHaveCount(0);
  expect(await count()).toBe(1);
  info.annotations.push({ type: 'independent-proof', description: JSON.stringify({ sessionId: rows[0].id, commandId: command.id, occurrenceId: occurrence.ocorrenciaId, mocks: false, browserAndPostgres: true }) });
});

test('CXA-S09 real browser permits no occurrence and persists null', async ({ ops, page }) => {
  const t = await ops.tenant();
  await t.seedCatalog();
  await openScreen(page, t);
  await expect(page.getByText('Nenhum agendamento para hoje', { exact: true })).toBeVisible();
  await confirm(page);
  const rows = await prismaClient().sessaoCaixaOperacao.findMany({ where: { pontoVendaId: t.pointId } });
  expect(rows).toHaveLength(1);
  expect(rows[0].ocorrenciaId).toBeNull();
});

test('CXA-S09 explicit no occurrence survives refetch with a single suggestion', async ({ ops, page }) => {
  await page.clock.install();
  const t = await ops.tenant(); await t.seedCatalog();
  await schedule(t, 'Optional suggestion', (await t.cashState()).diaOperacional);
  await openScreen(page, t);
  const selector = page.getByLabel('Agendamento de hoje');
  await expect(selector).not.toHaveValue('');
  await selector.selectOption('');
  const refreshed = page.waitForResponse(r => r.url().includes('/api/operacao/agenda/ocorrencias?'));
  await page.clock.runFor(31_000);
  await refreshed;
  await expect(selector).toHaveValue('');
  await confirm(page);
  const rows = await prismaClient().sessaoCaixaOperacao.findMany({ where: { pontoVendaId: t.pointId } });
  expect(rows).toHaveLength(1); expect(rows[0].ocorrenciaId).toBeNull();
});

test('CXA-S09 multiple choices require explicit selection and cancelled pending confirmation closes', async ({ ops, page }) => {
  await page.clock.install();
  const t = await ops.tenant(); await t.seedCatalog();
  const day = (await t.cashState()).diaOperacional;
  const occurrence = await schedule(t, 'First option', day);
  await schedule(t, 'Second option', day, '12:00', '14:00');
  await openScreen(page, t);
  const selector = page.getByLabel('Agendamento de hoje');
  await expect(selector).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Abrir caixa', exact: true })).toBeDisabled();
  await selector.selectOption(occurrence.ocorrenciaId);
  await page.getByRole('button', { name: 'Abrir caixa', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await t.owner.expect(t.owner.post(`/api/operacao/agenda/ocorrencias/${occurrence.ocorrenciaId}/cancelar`), 200, 'cancel pending occurrence');
  const refreshed = page.waitForResponse(r => r.url().includes('/api/operacao/agenda/ocorrencias?'));
  await page.clock.runFor(31_000);
  await refreshed;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(selector).toHaveValue('');
  expect(await prismaClient().sessaoCaixaOperacao.count({ where: { pontoVendaId: t.pointId } })).toBe(0);
});

test('CXA-S09 real API rejects wrong date tenant status and concurrent duplicate opening', async ({ ops }) => {
  const t = await ops.tenant(); const other = await ops.tenant();
  const catalog = await t.seedCatalog();
  const day = (await t.cashState()).diaOperacional;
  const tomorrow = new Date(`${day}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = await schedule(t, 'Tomorrow QA', tomorrow.toISOString().slice(0, 10));
  const foreign = await schedule(other, 'Other tenant QA', day);
  const cancelled = await schedule(t, 'Cancelled QA', day);
  await t.owner.expect(t.owner.post(`/api/operacao/agenda/ocorrencias/${cancelled.ocorrenciaId}/cancelar`), 200, 'cancel synthetic occurrence');
  const eligible = await schedule(t, 'Today QA', day);
  const open = (occorrenciaId: string) => t.owner.post('/api/operacao/caixa/abrir', { pontoVendaId: t.pointId, trocoInicial: 0, cardapioId: catalog.cardapioId, ocorrenciaId: occorrenciaId });
  for (const id of [future.ocorrenciaId, foreign.ocorrenciaId, cancelled.ocorrenciaId]) {
    const response = await open(id); expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500);
    expect(await prismaClient().sessaoCaixaOperacao.count({ where: { pontoVendaId: t.pointId } })).toBe(0);
  }
  const responses = await Promise.all([open(eligible.ocorrenciaId), open(eligible.ocorrenciaId)]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.filter((r) => r.status >= 400 && r.status < 500)).toHaveLength(1);
  expect(await prismaClient().sessaoCaixaOperacao.count({ where: { pontoVendaId: t.pointId } })).toBe(1);
});
