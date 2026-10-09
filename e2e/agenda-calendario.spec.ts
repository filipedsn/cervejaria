import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  await page.clock.install({ time: new Date('2026-10-09T15:00:00Z') });
  await page.route('**/api/**', (route) => route.abort());
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { usuario: { id: 'qa-owner', nome: 'QA', email: 'qa@qa.test', papel: 'DONO' }, cervejaria: { id: 'qa-tenant', nome: 'Agenda QA', slug: 'qa' } } }));
  await page.route('**/api/operacao/contexto', (route) => route.fulfill({ json: { ativo: true, operationMode: 'CAIXA', operationalSettingsSource: 'CANONICAL_PDV', cashRegisterEnabled: true, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: false, pontosVenda: [{ id: 'qa-pdv', nome: 'QA', ativo: true }] } }));
  const rules = [
    { id: 'old-active', nome: 'Sábado sem datas', diaSemana: 6, horaInicio: '18:00', horaFim: null, local: null, ativa: true, _count: { ocorrencias: 0 } },
    { id: 'old-inactive', nome: 'Repetição inativa', diaSemana: 6, horaInicio: '17:00', horaFim: null, local: null, ativa: false, _count: { ocorrencias: 0 } },
  ];
  const rows = [
    { id: 'one', agendaId: null as string | null, nome: 'Encontro da tarde', data: '2026-10-10', horaInicio: '15:00', horaFim: null, local: 'Salão', status: 'PROGRAMADA', podeEditar: true, podeCancelar: true, bloqueio: null as string | null },
    { id: 'two', agendaId: null as string | null, nome: 'Operação encerrada', data: '2026-10-10', horaInicio: '18:00', horaFim: null, local: null, status: 'FECHADA', podeEditar: false, podeCancelar: false, bloqueio: 'Este agendamento possui histórico operacional ou de caixa. Seus dados e status são preservados.' },
    { id: 'three', agendaId: null as string | null, nome: 'Domingo no jardim', data: '2026-10-11', horaInicio: '11:00', horaFim: null, local: null, status: 'ABERTA', podeEditar: false, podeCancelar: false, bloqueio: 'Somente agendamentos programados e sem histórico operacional podem ser editados ou cancelados.' },
  ];
  const writes: { url: string; body: any }[] = []; const reads: string[] = []; const receipts = new Set<string>();
  let failures = 0; let hold: Promise<void> | null = null;
  await page.route('**/api/operacao/agenda/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === 'GET') { reads.push(url.search); const start = url.searchParams.get('inicio')!; const end = url.searchParams.get('fim')!; return route.fulfill({ json: { agendas: rules, ocorrencias: rows.filter((row) => row.data >= start && row.data <= end) } }); }
    const body = request.postDataJSON(); writes.push({ url: url.pathname, body });
    if (hold) await hold;
    if (failures > 0) { failures--; return route.fulfill({ status: 503, json: { error: 'Falha temporária. Tente salvar novamente.' } }); }
    if (url.pathname.endsWith('/agendamentos')) {
      if (receipts.has(body.requestId)) return route.fulfill({ json: { criadas: 0 } });
      receipts.add(body.requestId);
      if (body.repetirSemanalmente) {
        let rule = rules.find((item) => item.id === body.agendaId);
        if (!rule) { rule = { id: `new-rule-${writes.length}`, nome: body.nome, diaSemana: new Date(`${body.data}T12:00:00`).getDay(), horaInicio: body.horaInicio, horaFim: null, local: null, ativa: true, _count: { ocorrencias: 0 } }; rules.push(rule); }
        rule.nome = body.nome;
        if (body.gerarDatas !== false) { const date = new Date(`${body.data}T12:00:00Z`); while (date.toISOString().slice(0, 10) <= body.fim) { const key = date.toISOString().slice(0, 10); if (!rows.some((row) => row.agendaId === rule!.id && row.data === key)) { rows.push({ ...rows[0], id: `weekly-${rule.id}-${key}`, nome: body.nome, data: key, agendaId: rule.id, horaInicio: body.horaInicio }); rule._count.ocorrencias++; } date.setUTCDate(date.getUTCDate() + 7); } }
      } else if (body.ocorrenciaId) { Object.assign(rows.find((row) => row.id === body.ocorrenciaId)!, { nome: body.nome, data: body.data, horaInicio: body.horaInicio }); }
      else rows.push({ ...rows[0], id: `new-one-${writes.length}`, nome: body.nome, data: body.data, horaInicio: body.horaInicio, agendaId: null });
      return route.fulfill({ json: { criadas: 1 } });
    }
    if (url.pathname.endsWith('/cancelar')) { const id = url.pathname.split('/').at(-2)!; Object.assign(rows.find((row) => row.id === id)!, { status: 'CANCELADA', podeCancelar: false, podeEditar: false }); return route.fulfill({ json: { status: 'CANCELADA' } }); }
    if (url.pathname.endsWith('/interromper')) { const id = url.pathname.split('/').at(-2)!; rules.find((rule) => rule.id === id)!.ativa = false; return route.fulfill({ json: { ativa: false } }); }
    return route.fulfill({ status: 404, json: { error: 'Unexpected write endpoint' } });
  });
  return { writes, reads, rows, rules, failNext: () => { failures++; }, hold: (promise: Promise<void> | null) => { hold = promise; } };
}
async function open(page: Page) { await page.goto('/operacao/agenda'); await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible(); }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function screenshot(page: Page, path: string) { await page.getByText('Reconectando...').evaluate((element) => { (element as HTMLElement).style.display = 'none'; }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path }); }

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
    test('formulário único: erro, rascunho, retry com mesma chave, envio único e repetição com período', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: '+ Novo agendamento' }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Nome', { exact: true }).fill('Novo encontro'); await dialog.getByLabel('Data', { exact: true }).fill('2026-10-10');
      state.failNext(); let release!: () => void; state.hold(new Promise<void>((resolve) => { release = resolve; }));
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
      await dialog.locator('form').dispatchEvent('submit'); expect(state.writes).toHaveLength(1); release();
      await expect(dialog.getByRole('alert')).toContainText('Falha temporária'); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Novo encontro'); state.hold(null);
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      expect(state.writes[0].body.requestId).toBe(state.writes[1].body.requestId); await expect(page.getByRole('button', { name: /Novo encontro/ })).toBeVisible();
      await page.getByRole('button', { name: '+ Novo agendamento' }).click(); await dialog.getByLabel('Nome', { exact: true }).fill('Sábados de outubro'); await dialog.getByLabel('Repetir semanalmente').check();
      await dialog.getByLabel('Primeira data').fill('2026-10-10'); await dialog.getByLabel('Última data da repetição').fill('2026-10-31');
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
    test('regras existentes/inativas, edição, descarte, cancelamento e interrupção preservam datas', async ({ page }) => {
      const state = await fixture(page); await open(page); await page.getByRole('button', { name: 'Repetições (2)' }).click();
      await expect(page.getByRole('dialog').getByText('Ainda sem datas agendadas')).toHaveCount(2);
      await page.getByRole('button', { name: 'Editar repetição Repetição inativa' }).click(); let dialog = page.getByRole('dialog');
      await expect(dialog.getByText(/Repetição inativa:/)).toBeVisible(); await dialog.getByLabel('Nome', { exact: true }).fill('Inativa revisada');
      page.once('dialog', (confirmation) => confirmation.dismiss()); await dialog.getByRole('button', { name: 'Voltar' }).click(); await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.writes.at(-1)!.body).toMatchObject({ agendaId: 'old-inactive', gerarDatas: false }); expect(state.rules[1].ativa).toBe(false);
      await page.getByRole('button', { name: 'Repetições (2)' }).click(); await page.getByRole('button', { name: 'Editar repetição Sábado sem datas' }).click();
      dialog = page.getByRole('dialog'); await dialog.getByLabel('Primeira data').fill('2026-10-10'); await dialog.getByLabel('Última data da repetição').fill('2026-10-24'); await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Lista', exact: true }).click(); await expect(page.getByRole('button', { name: /Sábado sem datas/ })).toHaveCount(3);
      await page.getByRole('button', { name: /Encontro da tarde/ }).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Editar', exact: true }).click();
      await dialog.getByLabel('Nome', { exact: true }).fill('Encontro editado'); await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: /Encontro editado/ }).click(); page.once('dialog', (confirmation) => confirmation.accept()); await dialog.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.rows.find((row) => row.id === 'one')!.status).toBe('CANCELADA');
      await page.getByRole('button', { name: /Operação encerrada/ }).click(); await expect(dialog.getByRole('button', { name: 'Cancelar agendamento' })).toBeDisabled(); await expect(dialog.getByText(/histórico operacional/)).toBeVisible(); await dialog.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: /Sábado sem datas/ }).first().click(); await expect(dialog.getByRole('button', { name: 'Cancelar este agendamento' })).toBeEnabled();
      page.once('dialog', (confirmation) => confirmation.accept()); await dialog.getByRole('button', { name: 'Interromper a repetição' }).click(); await expect(dialog).toHaveCount(0); expect(state.rules[0].ativa).toBe(false); expect(state.rows.filter((row) => row.agendaId === 'old-active')).toHaveLength(3);
      await page.getByRole('button', { name: '+ Novo agendamento' }).click(); await dialog.getByLabel('Nome', { exact: true }).fill('Descartar'); page.once('dialog', (confirmation) => confirmation.accept()); await dialog.getByRole('button', { name: 'Voltar' }).click(); await expect(dialog).toHaveCount(0); await noOverflow(page);
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
  page.once('dialog', (confirmation) => confirmation.dismiss()); await page.goBack();
  await expect(page).toHaveURL(/\/operacao\/agenda$/); await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Rascunho protegido');
  page.once('dialog', (confirmation) => confirmation.accept()); await page.goBack();
  await expect(page).toHaveURL(/\/operacao\/caixa$/);
});
