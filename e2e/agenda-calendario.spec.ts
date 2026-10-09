import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  let nativeDialogs = 0; page.on('dialog', (dialog) => { nativeDialogs++; void dialog.dismiss(); });
  await page.clock.install({ time: new Date('2026-10-09T15:00:00Z') });
  await page.route('**/api/**', (route) => route.abort());
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { usuario: { id: 'qa-owner', nome: 'QA', email: 'qa@qa.test', papel: 'DONO' }, cervejaria: { id: 'qa-tenant', nome: 'Agenda QA', slug: 'qa' } } }));
  await page.route('**/api/operacao/contexto', (route) => route.fulfill({ json: { ativo: true, operationMode: 'CAIXA', operationalSettingsSource: 'CANONICAL_PDV', cashRegisterEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, pontosVenda: [{ id: 'qa-pdv', nome: 'QA', ativo: true }] } }));
  const rules = [
    { id: 'old-active', nome: 'Sábado sem datas', diaSemana: 6, horaInicio: '18:00', horaFim: null, local: null, ativa: true, archivedAt: null as string | null, _count: { ocorrencias: 0 } },
    { id: 'old-inactive', nome: 'Repetição inativa', diaSemana: 6, horaInicio: '17:00', horaFim: null, local: null, ativa: false, archivedAt: null as string | null, _count: { ocorrencias: 0 } },
  ];
  const rows = [
    { id: 'one', agendaId: null as string | null, nome: 'Encontro da tarde', data: '2026-10-10', horaInicio: '15:00', horaFim: '16:00', local: 'Salão', status: 'PROGRAMADA', podeEditar: true, podeCancelar: true, bloqueio: null as string | null },
    { id: 'two', agendaId: null as string | null, nome: 'Operação encerrada', data: '2026-10-10', horaInicio: '18:00', horaFim: null, local: null, status: 'FECHADA', podeEditar: false, podeCancelar: false, bloqueio: 'Este agendamento possui histórico operacional ou de caixa. Seus dados e status são preservados.' },
    { id: 'three', agendaId: null as string | null, nome: 'Domingo no jardim', data: '2026-10-11', horaInicio: '11:00', horaFim: null, local: null, status: 'ABERTA', podeEditar: false, podeCancelar: false, bloqueio: 'Somente agendamentos programados e sem histórico operacional podem ser editados ou cancelados.' },
  ];
  const writes: { url: string; body: any }[] = []; const reads: string[] = []; const receipts = new Set<string>();
  let failures = 0; let conflicts = 0; let restoreConflicts = 0; let hold: Promise<void> | null = null;
  await page.route('**/api/operacao/agenda/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === 'GET') { reads.push(url.search); if (url.pathname.endsWith('/agendas/arquivadas')) return route.fulfill({ json: { agendas: rules.filter((rule) => rule.archivedAt) } }); const start = url.searchParams.get('inicio')!; const end = url.searchParams.get('fim')!; return route.fulfill({ json: { agendas: rules.filter((rule) => !rule.archivedAt), ocorrencias: rows.filter((row) => row.data >= start && row.data <= end) } }); }
    const body = request.postDataJSON(); writes.push({ url: url.pathname, body });
    if (hold) await hold;
    if (failures > 0) { failures--; return route.fulfill({ status: 503, json: { error: 'Falha temporária. Tente salvar novamente.' } }); }
    if (url.pathname.endsWith('/agendamentos')) {
      if (conflicts > 0) { conflicts--; return route.fulfill({ status: 409, json: { error: 'Conflito com Igarapé em 10/10/2026, das 18:00 às 20:00.', code: 'AGENDA_HORARIO_CONFLITO', details: { conflito: { nome: 'Igarapé', data: '2026-10-10', horaInicio: '18:00', horaFim: '20:00' } } } }); }
      if (receipts.has(body.requestId)) return route.fulfill({ json: { criadas: 0 } });
      receipts.add(body.requestId);
      if (body.repetirSemanalmente) {
        let rule = rules.find((item) => item.id === body.agendaId);
        if (!rule) { rule = { id: `new-rule-${writes.length}`, nome: body.nome, diaSemana: new Date(`${body.data}T12:00:00`).getDay(), horaInicio: body.horaInicio, horaFim: null, local: null, ativa: true, archivedAt: null, _count: { ocorrencias: 0 } }; rules.push(rule); }
        rule.nome = body.nome; if (body.horaInicio) rule.horaInicio = body.horaInicio; if (body.horaFim) rule.horaFim = body.horaFim;
        if (body.gerarDatas !== false) { const date = new Date(`${body.data}T12:00:00Z`); while (date.toISOString().slice(0, 10) <= body.fim) { const key = date.toISOString().slice(0, 10); if (!rows.some((row) => row.agendaId === rule!.id && row.data === key)) { rows.push({ ...rows[0], id: `weekly-${rule.id}-${key}`, nome: body.nome, data: key, agendaId: rule.id, horaInicio: body.horaInicio }); rule._count.ocorrencias++; } date.setUTCDate(date.getUTCDate() + 7); } }
      } else if (body.ocorrenciaId) { Object.assign(rows.find((row) => row.id === body.ocorrenciaId)!, { nome: body.nome, data: body.data, ...(body.horaInicio ? { horaInicio: body.horaInicio } : {}), ...(body.horaFim ? { horaFim: body.horaFim } : {}) }); }
      else rows.push({ ...rows[0], id: `new-one-${writes.length}`, nome: body.nome, data: body.data, horaInicio: body.horaInicio, agendaId: null });
      return route.fulfill({ json: { criadas: 1 } });
    }
    if (url.pathname.endsWith('/cancelar')) { const id = url.pathname.split('/').at(-2)!; Object.assign(rows.find((row) => row.id === id)!, { status: 'CANCELADA', podeCancelar: false, podeEditar: false, podeRestaurar: true }); return route.fulfill({ json: { status: 'CANCELADA' } }); }
    if (url.pathname.endsWith('/restaurar')) { const id = url.pathname.split('/').at(-2)!; if (restoreConflicts > 0) { restoreConflicts--; return route.fulfill({ status: 409, json: { error: 'Conflito com Igarapé em 10/10/2026, das 18:00 Ã s 20:00.', code: 'AGENDA_HORARIO_CONFLITO', details: { conflito: { nome: 'Igarapé', data: '2026-10-10', horaInicio: '18:00', horaFim: '20:00' } } } }); } const row = rows.find((item) => item.id === id)!; Object.assign(row, { status: 'PROGRAMADA', data: body.data, horaInicio: body.horaInicio, horaFim: body.horaFim, podeEditar: true, podeCancelar: true, podeRestaurar: false }); return route.fulfill({ json: { id, status: 'PROGRAMADA', data: body.data, horaInicio: body.horaInicio, horaFim: body.horaFim } }); }
    if (url.pathname.endsWith('/interromper')) { const id = url.pathname.split('/').at(-2)!; rules.find((rule) => rule.id === id)!.ativa = false; return route.fulfill({ json: { ativa: false } }); }
    if (url.pathname.endsWith('/arquivar')) { const id = url.pathname.split('/').at(-2)!; rules.find((rule) => rule.id === id)!.archivedAt = '2026-10-09T15:00:00Z'; return route.fulfill({ json: { arquivada: true } }); }
    return route.fulfill({ status: 404, json: { error: 'Unexpected write endpoint' } });
  });
  return { writes, reads, rows, rules, nativeDialogs: () => nativeDialogs, failNext: () => { failures++; }, conflictNext: () => { conflicts++; }, restoreConflictNext: () => { restoreConflicts++; }, hold: (promise: Promise<void> | null) => { hold = promise; } };
}
async function open(page: Page) { await page.goto('/operacao/agenda'); await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible(); }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function screenshot(page: Page, path: string) { await page.getByText('Reconectando...').evaluate((element) => { (element as HTMLElement).style.display = 'none'; }); await page.evaluate(() => scrollTo(0, 0)); if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button').last().scrollIntoViewIfNeeded(); await page.screenshot({ path, animations: 'disabled' }); }

for (const width of [390, 768]) {
  test.describe(`Calendário ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1024 }, serviceWorkers: 'block' });
    test('Mês/Lista, seleção, Hoje, navegação e vazio usam o mesmo período sem escrita', async ({ page }) => {
      const state = await fixture(page); await open(page);
      await expect(page.getByText('Nenhum agendamento neste dia.')).toBeVisible();
      await expect(page.getByRole('button', { name: '+ Novo agendamento', exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: 'sábado, 10 de outubro, 2 agendamentos' }).click();
      await expect(page.getByRole('button', { name: /Encontro da tarde/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Domingo no jardim/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Lista', exact: true }).click(); await expect(page.getByRole('button', { name: /Domingo no jardim/ })).toBeVisible();
      await expect(page.getByText('3 agendamentos no mês')).toBeVisible();
      await page.getByRole('button', { name: 'Mês anterior' }).click(); await expect(page.getByText('Nenhum agendamento neste mês.')).toBeVisible();
      await page.getByRole('button', { name: 'Próximo mês' }).click(); await expect(page.getByText('3 agendamentos no mês')).toBeVisible();
      await page.getByRole('button', { name: 'Hoje', exact: true }).click(); await page.getByRole('button', { name: 'Mês', exact: true }).click();
      await expect(page.getByText('Nenhum agendamento neste dia.')).toBeVisible();
      expect(state.writes).toHaveLength(0); expect(state.reads.every((period) => /inicio=2026-(09|10)-01&fim=2026-(09-30|10-31)/.test(period))).toBe(true);
      await expect(page.getByRole('button', { name: /Gerar datas|Ocorrência avulsa/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'sábado, 10 de outubro, 2 agendamentos' }).click(); await noOverflow(page);
      await screenshot(page, width === 390 ? 'artifacts/agenda-mobile-calendar.png' : 'artifacts/agenda-tablet-calendar.png');
      await page.getByRole('button', { name: 'Lista', exact: true }).click();
      await screenshot(page, width === 390 ? 'artifacts/agenda-mobile-calendar-list.png' : 'artifacts/agenda-tablet-calendar-list.png');
    });
    test('selected day agenda precedes the month calendar and updates with selection', async ({ page }) => {
      await fixture(page); await open(page);
      const initiallySelected = page.locator('section[aria-label="sexta-feira, 9 de outubro"]');
      await expect(initiallySelected).toContainText('Nenhum agendamento neste dia.');
      await page.getByRole('button', { name: 'sábado, 10 de outubro, 2 agendamentos' }).click();
      const selectedDay = page.locator('section[aria-label="sábado, 10 de outubro"]');
      await expect(selectedDay.getByText('Encontro da tarde')).toBeVisible();
      const followsSelectedBeforeCalendar = await selectedDay.evaluate((section) => Boolean(section.compareDocumentPosition(document.querySelector('[aria-label="Dias do mês"]')!) & Node.DOCUMENT_POSITION_FOLLOWING));
      expect(followsSelectedBeforeCalendar).toBe(true);
      await selectedDay.getByRole('button', { name: /Encontro da tarde/ }).click();
      const detail = page.getByRole('dialog', { name: 'Agendamento' }); await expect(detail.getByText('Encontro da tarde')).toBeVisible();
      await detail.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: 'segunda-feira, 12 de outubro, 0 agendamentos' }).click();
      const emptyDay = page.locator('section[aria-label="segunda-feira, 12 de outubro"]'); await expect(emptyDay).toContainText('Nenhum agendamento neste dia.');
      const emptyBeforeCalendar = await emptyDay.evaluate((section) => Boolean(section.compareDocumentPosition(document.querySelector('[aria-label="Dias do mês"]')!) & Node.DOCUMENT_POSITION_FOLLOWING));
      expect(emptyBeforeCalendar).toBe(true); await noOverflow(page);
    });
    test('recurring schedules button is beside the primary action and opens the counted panel', async ({ page }) => {
      const state = await fixture(page); await open(page);
      const recurring = page.getByRole('button', { name: 'Agendamentos recorrentes (2)', exact: true });
      const primary = page.getByRole('button', { name: '+ Novo agendamento', exact: true });
      await expect(recurring).toBeVisible(); await expect(primary).toBeVisible();
      await expect(recurring).toHaveClass(/touch-btn-secondary/); await expect(primary).toHaveClass(/touch-btn-primary/);
      await expect(page.getByRole('button', { name: 'Repetições (2)', exact: true })).toHaveCount(0);
      const recurringBox = await recurring.boundingBox(); const primaryBox = await primary.boundingBox();
      expect(Math.abs(recurringBox!.y - primaryBox!.y)).toBeLessThanOrEqual(1); expect(primaryBox!.x).toBeGreaterThanOrEqual(recurringBox!.x + recurringBox!.width - 1);
      await noOverflow(page); await recurring.click(); const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Repetições', exact: true })).toBeVisible(); await expect(dialog.getByText('Sábado sem datas')).toBeVisible(); await expect(dialog.getByText('Repetição inativa')).toBeVisible();
      expect(state.writes).toHaveLength(0);
    });
    test('formulário único: erro, rascunho, retry com mesma chave, envio único e repetição com período', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: '+ Novo agendamento' }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Nome', { exact: true }).fill('Novo encontro'); await dialog.getByLabel('Data', { exact: true }).fill('2026-10-10');
      await expect(dialog.getByLabel('Horário de início', { exact: true })).toBeVisible(); await expect(dialog.getByLabel('Horário de término', { exact: true })).toBeVisible();
      await dialog.getByLabel('Horário de início', { exact: true }).fill('18:00'); await dialog.getByLabel('Horário de término', { exact: true }).fill('20:00');
      state.failNext(); let release!: () => void; state.hold(new Promise<void>((resolve) => { release = resolve; }));
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
      await dialog.locator('form').dispatchEvent('submit'); expect(state.writes).toHaveLength(1); release();
      await expect(dialog.getByRole('alert')).toContainText('Falha temporária'); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Novo encontro'); state.hold(null);
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      expect(state.writes[0].body.requestId).toBe(state.writes[1].body.requestId); await expect(page.getByRole('button', { name: /Novo encontro/ })).toBeVisible();
      await page.getByRole('button', { name: '+ Novo agendamento' }).click(); await dialog.getByLabel('Nome', { exact: true }).fill('Sábados de outubro'); await dialog.getByLabel('Repetir semanalmente').check();
      await dialog.getByLabel('Primeira data').fill('2026-10-10'); await dialog.getByLabel('Horário de início', { exact: true }).fill('18:00'); await dialog.getByLabel('Horário de término', { exact: true }).fill('20:00'); await dialog.getByLabel('Última data da repetição').fill('2026-10-31');
      await noOverflow(page); await screenshot(page, width === 390 ? 'artifacts/agenda-mobile-calendar-form.png' : 'artifacts/agenda-tablet-calendar-form.png');
      const keyboardHeight = width === 390 ? 500 : 650;
      await page.setViewportSize({ width, height: keyboardHeight });
      await dialog.getByLabel('Última data da repetição').scrollIntoViewIfNeeded();
      const footer = await dialog.getByRole('button', { name: 'Salvar', exact: true }).boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(keyboardHeight); await noOverflow(page);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      expect(state.writes.at(-1)!.body).toMatchObject({ repetirSemanalmente: true, data: '2026-10-10', fim: '2026-10-31' }); expect(state.writes.every((write) => write.url.endsWith('/agendamentos'))).toBe(true);
      await page.getByRole('button', { name: 'Lista', exact: true }).click(); await expect(page.getByRole('button', { name: /Sábados de outubro/ })).toHaveCount(4);
    });
    test('conflito aparece no formulário, mantém os horários e permite nova tentativa livre', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: '+ Novo agendamento' }).click(); const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Nome', { exact: true }).fill('Teste conflito'); await dialog.getByLabel('Data', { exact: true }).fill('2026-10-10'); await dialog.getByLabel('Horário de início', { exact: true }).fill('19:00'); await dialog.getByLabel('Horário de término', { exact: true }).fill('21:00');
      state.conflictNext(); await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText('Conflito com Igarapé em 10/10/2026, das 18:00 às 20:00.'); await expect(dialog.getByLabel('Horário de início', { exact: true })).toHaveValue('19:00'); await expect(dialog.getByLabel('Horário de término', { exact: true })).toHaveValue('21:00');
      await screenshot(page, width === 390 ? 'artifacts/agenda-conflict-mobile.png' : 'artifacts/agenda-conflict-tablet.png');
      await dialog.getByLabel('Horário de início', { exact: true }).fill('20:00'); await dialog.getByLabel('Horário de término', { exact: true }).fill('22:00'); await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.writes).toHaveLength(2); await noOverflow(page);
    });
    test('restore same occurrence after visual confirmation and preserve fields after conflict', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: 'Lista', exact: true }).click();
      await page.getByRole('button', { name: /Encontro da tarde/ }).click(); let dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click(); await dialog.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click();
      await expect(dialog).toHaveCount(0); await page.getByRole('button', { name: /Encontro da tarde/ }).click(); dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Restaurar agendamento' })).toBeEnabled(); await dialog.getByRole('button', { name: 'Restaurar agendamento' }).click();
      await expect(page.getByRole('heading', { name: 'Restaurar agendamento?' })).toBeVisible(); await expect(dialog.getByText(/mesmo registro voltar/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Voltar', exact: true }).click(); await expect(dialog.getByText('Cancelada')).toBeVisible();
      state.restoreConflictNext(); await dialog.getByRole('button', { name: 'Restaurar agendamento' }).click(); await dialog.getByRole('button', { name: 'Restaurar agendamento', exact: true }).click();
      dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: 'Restaurar agendamento' })).toBeVisible();
      await expect(dialog.getByRole('alert')).toContainText('Conflito com Igarapé em 10/10/2026, das 18:00 às 20:00.');
      await expect(dialog.getByLabel('Horário de início')).toHaveValue('15:00'); await expect(dialog.getByLabel('Horário de término')).toHaveValue('16:00');
      await screenshot(page, width === 390 ? 'artifacts/agenda-restore-conflict-mobile.png' : 'artifacts/agenda-restore-conflict-tablet.png');
      await dialog.getByLabel('Horário de início').fill('20:00'); await dialog.getByLabel('Horário de término').fill('22:00'); await dialog.getByRole('button', { name: 'Restaurar agendamento', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Agendamento' })).toBeVisible(); await expect(page.getByRole('dialog').getByText('Programada')).toBeVisible(); expect(state.rows.filter((row) => row.id === 'one')).toHaveLength(1); expect(state.rows.find((row) => row.id === 'one')).toMatchObject({ id: 'one', status: 'PROGRAMADA', horaInicio: '20:00', horaFim: '22:00' });
      const restores = state.writes.filter((write) => write.url.endsWith('/restaurar')); expect(restores).toHaveLength(2); expect(restores[0].body.requestId).toBe(restores[1].body.requestId); expect(state.nativeDialogs()).toBe(0); await noOverflow(page);
    });
    test('regras existentes/inativas, edição, descarte, cancelamento e interrupção preservam datas', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: 'Agendamentos recorrentes (2)' }).click();
      await expect(page.getByRole('dialog').getByText('Ainda sem datas agendadas')).toHaveCount(2);
      await page.getByRole('button', { name: 'Editar repetição Repetição inativa' }).click(); let dialog = page.getByRole('dialog');
      await expect(dialog.getByText(/Repetição inativa:/)).toBeVisible(); await dialog.getByLabel('Nome', { exact: true }).fill('Inativa revisada'); await dialog.getByLabel('Horário de término', { exact: true }).fill('19:00');
      await dialog.getByRole('button', { name: 'Voltar' }).click(); await expect(page.getByRole('heading', { name: 'Descartar alterações?' })).toBeVisible(); await dialog.getByRole('button', { name: 'Continuar editando' }).click(); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Inativa revisada');
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.writes.at(-1)!.body).toMatchObject({ agendaId: 'old-inactive', gerarDatas: false }); expect(state.rules[1].ativa).toBe(false);
      await page.getByRole('button', { name: 'Agendamentos recorrentes (2)' }).click(); await page.getByRole('button', { name: 'Editar repetição Sábado sem datas' }).click();
      dialog = page.getByRole('dialog'); await dialog.getByLabel('Primeira data').fill('2026-10-10'); await dialog.getByLabel('Horário de término', { exact: true }).fill('19:00'); await dialog.getByLabel('Última data da repetição').fill('2026-10-24'); await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Lista', exact: true }).click(); await expect(page.getByRole('button', { name: /Sábado sem datas/ })).toHaveCount(3);
      await page.getByRole('button', { name: /Encontro da tarde/ }).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Editar', exact: true }).click();
      await dialog.getByLabel('Nome', { exact: true }).fill('Encontro editado'); await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: /Encontro editado/ }).click(); await dialog.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Cancelar agendamento?' })).toBeVisible(); await dialog.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.rows.find((row) => row.id === 'one')!.status).toBe('CANCELADA');
      await page.getByRole('button', { name: /Operação encerrada/ }).click(); await expect(dialog.getByRole('button', { name: 'Cancelar agendamento' })).toBeDisabled(); await expect(dialog.getByText(/histórico operacional/)).toBeVisible(); await dialog.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: /Sábado sem datas/ }).first().click(); await expect(dialog.getByRole('button', { name: 'Cancelar este agendamento' })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Interromper a repetição' }).click(); await expect(page.getByRole('heading', { name: 'Interromper repetição?' })).toBeVisible(); await dialog.getByRole('button', { name: 'Interromper repetição', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.rules[0].ativa).toBe(false); expect(state.rows.filter((row) => row.agendaId === 'old-active')).toHaveLength(3);
      await page.getByRole('button', { name: '+ Novo agendamento' }).click(); await dialog.getByLabel('Nome', { exact: true }).fill('Descartar'); const beforeDiscard = state.writes.length; await dialog.getByRole('button', { name: 'Voltar' }).click(); await dialog.getByRole('button', { name: 'Descartar', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.writes).toHaveLength(beforeDiscard); expect(state.nativeDialogs()).toBe(0); await noOverflow(page);
    });
    test('descarte visual preserva todos os campos, foco e teclado; descartar não envia request', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: '+ Novo agendamento' }).click(); const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Nome', { exact: true }).fill('Rascunho completo'); await dialog.getByLabel('Data', { exact: true }).fill('2026-10-10'); await dialog.getByLabel('Horário de início', { exact: true }).fill('16:15');
      await dialog.getByLabel('Horário de término', { exact: true }).fill('22:30'); await dialog.getByLabel('Local (opcional)').fill('Jardim'); await dialog.getByLabel('Repetir semanalmente').check(); await dialog.getByLabel('Última data da repetição').fill('2026-10-31');
      await dialog.getByRole('button', { name: 'Voltar' }).click(); await expect(page.getByRole('heading', { name: 'Descartar alterações?', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Continuar editando' })).toBeFocused(); await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Descartar', exact: true })).toBeFocused(); await noOverflow(page);
      await screenshot(page, width === 390 ? 'artifacts/agenda-discard-mobile.png' : 'artifacts/agenda-discard-tablet.png');
      await page.keyboard.press('Escape'); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho completo'); await expect(dialog.getByLabel('Primeira data')).toHaveValue('2026-10-10'); await expect(dialog.getByLabel('Horário de início', { exact: true })).toHaveValue('16:15'); await expect(dialog.getByLabel('Horário de término', { exact: true })).toHaveValue('22:30'); await expect(dialog.getByLabel('Local (opcional)')).toHaveValue('Jardim'); await expect(dialog.getByLabel('Última data da repetição')).toHaveValue('2026-10-31'); await expect(dialog.getByLabel('Repetir semanalmente')).toBeChecked();
      await expect(dialog.getByRole('button', { name: 'Voltar' })).toBeFocused();
      await dialog.getByRole('button', { name: 'Voltar' }).click(); await dialog.getByRole('button', { name: 'Continuar editando' }).click(); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho completo');
      await dialog.getByRole('button', { name: 'Voltar' }).click(); await dialog.getByRole('button', { name: 'Descartar', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.writes).toHaveLength(0); expect(state.nativeDialogs()).toBe(0);
    });
    test('repetições ativas/inativas têm ações claras e arquivamento persistente com consulta secundária', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: 'Agendamentos recorrentes (2)' }).click(); const dialog = page.getByRole('dialog');
      const active = dialog.locator('li').filter({ hasText: 'Sábado sem datas' }); const inactive = dialog.locator('li').filter({ hasText: 'Repetição inativa' });
      await expect(active.getByRole('button', { name: 'Editar repetição Sábado sem datas' })).toBeVisible(); await expect(active.getByRole('button', { name: 'Interromper repetição', exact: true })).toBeVisible(); await expect(active.getByRole('button', { name: 'Remover da lista' })).toBeVisible();
      await expect(inactive.getByRole('button', { name: 'Editar repetição Repetição inativa' })).toBeVisible(); await expect(inactive.getByRole('button', { name: 'Interromper repetição' })).toHaveCount(0); await expect(inactive.getByText(/total em todos os períodos/)).toBeVisible();
      await inactive.getByRole('button', { name: 'Remover da lista' }).click(); await expect(page.getByRole('heading', { name: 'Remover repetição da lista?' })).toBeVisible(); await expect(dialog.getByText(/datas existentes, comandas, caixa, estoque e auditoria serão mantidos/)).toBeVisible(); await dialog.getByRole('button', { name: 'Voltar' }).click(); expect(state.writes).toHaveLength(0);
      await inactive.getByRole('button', { name: 'Remover da lista' }).click(); await screenshot(page, width === 390 ? 'artifacts/agenda-archive-confirm-mobile.png' : 'artifacts/agenda-archive-confirm-tablet.png'); await dialog.getByRole('button', { name: 'Remover da lista', exact: true }).click(); await expect(inactive).toHaveCount(0); await expect(dialog.getByRole('status')).toContainText('Repetição removida da lista'); expect(state.rules[1].ativa).toBe(false); expect(state.rules[1].archivedAt).toBeTruthy();
      await dialog.getByRole('button', { name: 'Voltar' }).click(); await page.reload(); await page.getByRole('button', { name: 'Agendamentos recorrentes (1)' }).click(); await expect(inactive).toHaveCount(0); await dialog.getByRole('button', { name: 'Ver arquivadas' }).click(); await expect(page.getByRole('heading', { name: 'Repetições arquivadas' })).toBeVisible(); await expect(inactive).toBeVisible(); await expect(inactive.getByText(/Inativa · Arquivada/)).toBeVisible(); await expect(inactive.getByRole('button')).toHaveCount(0);
      await screenshot(page, width === 390 ? 'artifacts/agenda-archived-mobile.png' : 'artifacts/agenda-archived-tablet.png'); await dialog.getByRole('button', { name: 'Voltar à lista' }).click();
      await active.getByRole('button', { name: 'Remover da lista' }).click(); await dialog.getByRole('button', { name: 'Remover da lista', exact: true }).click(); await expect(active).toHaveCount(0); expect(state.rules[0].ativa).toBe(true); expect(state.rows).toHaveLength(3);
      await dialog.getByRole('button', { name: 'Voltar' }).click(); await page.getByRole('button', { name: 'Lista', exact: true }).click(); await expect(page.getByRole('button', { name: /Encontro da tarde/ })).toBeVisible(); expect(state.nativeDialogs()).toBe(0); await noOverflow(page);
    });
  });
}

test('erro de consulta oferece retry e mantém calendário vazio sem escrita', async ({ page }) => {
  const state = await fixture(page); let reads = 0;
  await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => { reads++; return reads <= 3 ? route.fulfill({ status: 503, json: { error: 'Indisponível' } }) : route.fulfill({ json: { agendas: [], ocorrencias: [] } }); });
  await open(page); await expect(page.getByRole('alert')).toContainText('Não foi possível carregar'); await page.getByRole('button', { name: 'Tentar novamente' }).click(); await expect(page.getByText('Nenhum agendamento neste dia.')).toBeVisible(); expect(state.writes).toHaveLength(0);
});

test('Voltar do navegador exige confirmação e mantém rascunho quando recusado', async ({ page }) => {
  await fixture(page); await page.goto('/operacao/caixa'); await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: '+ Novo agendamento' }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Nome', { exact: true }).fill('Rascunho protegido');
  await page.goBack(); await page.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(page).toHaveURL(/\/operacao\/agenda$/); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho protegido');
  await page.goBack(); await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page).toHaveURL(/\/operacao\/caixa$/);
});
