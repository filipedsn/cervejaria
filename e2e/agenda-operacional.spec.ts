import { expect, test, type Page } from '@playwright/test';

type SettingsSource = 'CANONICAL_PDV' | 'LEGACY';

async function authenticateAsOwner(page: Page, source: SettingsSource = 'CANONICAL_PDV', papel: 'DONO' | 'OPERADOR' = 'DONO', permissoesOperacao?: string[]) {
  await page.route('**/api/**', (route) => route.abort());
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: {
    usuario: { id: 'agenda-ui-owner', nome: 'QA Agenda', email: 'agenda-ui@qa.test', papel, permissoesOperacao },
    cervejaria: { id: 'agenda-ui-tenant', nome: 'QA Agenda', slug: 'qa-agenda-ui' },
  } }));
  await page.route('**/api/operacao/contexto', (route) => route.fulfill({ json: {
    ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true,
    tapsEnabled: false, operationalSettingsSource: source, inventoryEnabled: false,
    kitchenEnabled: false, controlaEstoque: false, temCozinha: false, usaCardapio: false,
    quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
    pontosVenda: [{ id: 'agenda-ui-pdv', nome: 'Balcão', ativo: true }],
  } }));
}

async function openAgendaSettings(page: Page) {
  await page.goto('/operacao/agenda');
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible();
}

function openedCash(ocorrencia: { id: string; nome: string; data: string; status: 'ABERTA'; agenda: { nome: string; frequencia: 'SEMANAL'; diaSemana: number } | null } | null) {
  return {
    id: 'cash-ui-session', pontoVendaId: 'agenda-ui-pdv', ocorrenciaId: ocorrencia?.id ?? null,
    ocorrencia, diaOperacional: '2026-10-07', status: 'ABERTO', trocoInicial: 100,
    abertoPorId: 'agenda-ui-owner', abertoEm: '2026-10-07T12:00:00.000Z', fechadoPorId: null,
    fechadoEm: null, observacaoFechamento: null, pendente: 0,
    gaveta: { trocoInicial: 100, entradasDinheiro: 0, suprimentos: 0, sangrias: 0, esperadoDinheiro: 100 },
    esperado: { dinheiro: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0, totalVendas: 0 },
    contado: null, diferencas: null, movimentos: [],
  };
}

test.describe('Agenda operacional canônica', () => {
  test.use({ serviceWorkers: 'block' });

  test('modo LEGACY não monta a gestão nem consulta API canônica da agenda', async ({ page }) => {
    await authenticateAsOwner(page, 'LEGACY');
    const agendaRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/operacao/agenda/')) agendaRequests.push(request.url());
    });
    await page.goto('/operacao/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toHaveCount(0);
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: { sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07' } }));
    await page.goto('/operacao/comandas');
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
    await expect(page.getByLabel('Agendamento de hoje')).toHaveCount(0);
    expect(agendaRequests).toEqual([]);
  });

  test('usuário sem permissão de agenda é redirecionado sem consultar o endpoint', async ({ page }) => {
    await authenticateAsOwner(page, 'CANONICAL_PDV', 'OPERADOR', []);
    const agendaRequests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/api/operacao/agenda/')) agendaRequests.push(request.url()); });
    await page.goto('/operacao/agenda');
    await expect(page).toHaveURL(/\/operacao\/sem-acesso$/);
    await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toHaveCount(0);
    expect(agendaRequests).toEqual([]);
  });

  test('consulta somente hoje, sugere a única ocorrência e só abre após confirmação final', async ({ page }) => {
    await authenticateAsOwner(page);
    const requested: Record<string, unknown>[] = [];
    const occurrenceUrls: string[] = [];
    let cashResponse: { sessao: ReturnType<typeof openedCash> | null; comandasAbertas: number; diaOperacional: string } = {
      sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07',
    };
    const selectedOccurrence = { id: 'same-day-b', nome: 'Hoje B', data: '2026-10-07', status: 'ABERTA' as const, agenda: null };
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: cashResponse }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => { occurrenceUrls.push(route.request().url()); return route.fulfill({ json: { ocorrencias: [
      { id: 'same-day', nome: 'Hoje', data: '2026-10-07', status: 'PROGRAMADA', agenda: null },
      selectedOccurrence,
      { id: 'yesterday', nome: 'Ontem', data: '2026-10-06', status: 'PROGRAMADA', agenda: null },
      { id: 'tomorrow', nome: 'Amanhã', data: '2026-10-08', status: 'PROGRAMADA', agenda: null },
      { id: 'closed', nome: 'Encerrada', data: '2026-10-07', status: 'FECHADA', agenda: null },
      { id: 'cancelled', nome: 'Cancelada', data: '2026-10-07', status: 'CANCELADA', agenda: null },
    ] } }); });
    await page.route('**/api/operacao/cardapios?ativo=true', (route) => route.fulfill({ json: [{ id: 'ui-menu', nome: 'Menu de teste', ativo: true, itemCount: 1 }] }));
    await page.route('**/api/operacao/caixa/abrir', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requested.push(body);
      const persisted = body.ocorrenciaId === selectedOccurrence.id ? selectedOccurrence : null;
      const session = openedCash(persisted);
      cashResponse = { sessao: session, comandasAbertas: 0, diaOperacional: '2026-10-07' };
      return route.fulfill({ status: 201, json: session });
    });
    await page.goto('/operacao/comandas');

    await expect.poll(() => occurrenceUrls.length).toBeGreaterThan(0);
    for (const requestedUrl of occurrenceUrls) {
      const url = new URL(requestedUrl);
      expect(url.searchParams.get('inicio')).toBe('2026-10-07');
      expect(url.searchParams.get('fim')).toBe('2026-10-07');
    }
    await page.getByRole('button', { name: 'Cardápio salvo' }).click();
    await page.getByRole('radio', { name: /Menu de teste/ }).click();
    const occurrenceSelect = page.getByLabel('Agendamento de hoje');
    await expect(occurrenceSelect).toHaveValue('');
    await expect(occurrenceSelect.locator('option', { hasText: 'Hoje B' })).toHaveCount(1);
    await expect(occurrenceSelect.locator('option', { hasText: 'Ontem' })).toHaveCount(0);
    await expect(occurrenceSelect.locator('option', { hasText: 'Amanhã' })).toHaveCount(0);
    await expect(occurrenceSelect.locator('option', { hasText: 'Encerrada' })).toHaveCount(0);
    await expect(occurrenceSelect.locator('option', { hasText: 'Cancelada' })).toHaveCount(0);
    const openButton = page.getByRole('button', { name: 'Abrir caixa' });
    await expect(openButton).toBeEnabled();
    await occurrenceSelect.selectOption(selectedOccurrence.id);
    await openButton.click();
    await expect(page.getByRole('dialog')).toContainText('Hoje B');
    await expect(page.getByRole('dialog')).toContainText('Confirmar e abrir caixa');
    expect(requested).toHaveLength(0);
    await expect(page.getByRole('dialog')).toContainText('Troco inicial');
    await expect(page.getByRole('dialog')).toContainText('Menu de teste');
    await expect.poll(() => page.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(openButton).toBeFocused();
    expect(requested).toHaveLength(0);
    await openButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar' }).click();
    expect(requested).toHaveLength(0);
    await openButton.click();
    await page.getByRole('button', { name: 'Confirmar e abrir caixa' }).click();

    await expect.poll(() => requested.length).toBe(1);
    expect(requested[0]).toMatchObject({ ocorrenciaId: selectedOccurrence.id });
    expect(Object.hasOwn(requested[0]!, 'confirmarDataDiferente')).toBe(false);
    await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('Hoje B');
    await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('07/10/2026');
  });

  test('Sem ocorrência abre sem associação e mostra o contexto persistido vazio', async ({ page }) => {
    await authenticateAsOwner(page);
    let cashResponse: { sessao: ReturnType<typeof openedCash> | null; comandasAbertas: number; diaOperacional: string } = {
      sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07',
    };
    const requested: Record<string, unknown>[] = [];
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: cashResponse }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { ocorrencias: [] } }));
    await page.route('**/api/operacao/cardapios?ativo=true', (route) => route.fulfill({ json: [{ id: 'ui-menu', nome: 'Menu de teste', ativo: true, itemCount: 1 }] }));
    await page.route('**/api/operacao/caixa/abrir', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requested.push(body);
      const session = openedCash(null);
      cashResponse = { sessao: session, comandasAbertas: 0, diaOperacional: '2026-10-07' };
      return route.fulfill({ status: 201, json: session });
    });
    await page.goto('/operacao/comandas');
    const occurrenceSelect = page.getByLabel('Agendamento de hoje');
    await expect(occurrenceSelect).toHaveValue('');
    await expect(page.getByText('Nenhum agendamento para hoje')).toBeVisible();
    await page.getByRole('button', { name: 'Cardápio salvo' }).click();
    await page.getByRole('radio', { name: /Menu de teste/ }).click();
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByRole('dialog')).toContainText('Sem agendamento');
    expect(requested).toHaveLength(0);
    await page.getByRole('button', { name: 'Confirmar e abrir caixa' }).click();
    await expect.poll(() => requested.length).toBe(1);
    expect(Object.hasOwn(requested[0]!, 'ocorrenciaId')).toBe(false);
    expect(Object.hasOwn(requested[0]!, 'confirmarDataDiferente')).toBe(false);
    await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('Sem ocorrência');
  });

  test('falha na consulta mostra nova tentativa e recupera a lista', async ({ page }) => {
    await authenticateAsOwner(page);
    let fail = true;
    let attempts = 0;
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: { sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07' } }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => {
      attempts++;
      return fail
        ? route.fulfill({ status: 503, json: { error: 'synthetic fixture failure' } })
        : route.fulfill({ json: { ocorrencias: [{ id: 'retry-today', nome: 'Hoje após retry', data: '2026-10-07', status: 'PROGRAMADA', agenda: null }] } });
    });
    await page.goto('/operacao/comandas');
    const retry = page.getByRole('button', { name: 'Tentar novamente' });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    expect(attempts).toBeGreaterThan(1);
    fail = false;
    await retry.click();
    await expect(page.getByLabel('Agendamento de hoje')).toBeVisible();
    await expect(page.getByLabel('Agendamento de hoje')).toHaveValue('retry-today');
    await expect(page.getByRole('option', { name: /Hoje após retry/ })).toHaveCount(1);
  });

  test('seleção é invalidada quando a API avança o dia operacional na virada de Brasília', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install({ time: new Date('2026-10-23T02:59:50.000Z') });
    await authenticateAsOwner(page);
    let operationalDay = '2026-10-22';
    const requestedDays: string[] = [];
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: { sessao: null, comandasAbertas: 0, diaOperacional: operationalDay } }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => {
      const url = new URL(route.request().url());
      requestedDays.push(`${url.searchParams.get('inicio')}/${url.searchParams.get('fim')}`);
      const date = url.searchParams.get('inicio')!;
      return route.fulfill({ json: { ocorrencias: [{ id: `event-${date}`, nome: `Evento ${date}`, data: date, status: 'PROGRAMADA', agenda: null }] } });
    });
    await page.goto('/operacao/comandas');
    const occurrenceSelect = page.getByLabel('Agendamento de hoje');
    await expect(occurrenceSelect).toBeVisible();
    await occurrenceSelect.selectOption('event-2026-10-22');
    await page.clock.runFor(30_000);
    await expect(occurrenceSelect).toHaveValue('event-2026-10-22');

    operationalDay = '2026-10-23';
    await page.clock.runFor(30_000);
    await expect(occurrenceSelect).toHaveValue('event-2026-10-23');
    await expect(occurrenceSelect.locator('option', { hasText: 'Evento 2026-10-23' })).toHaveCount(1);
    expect(requestedDays).toContain('2026-10-22/2026-10-22');
    expect(requestedDays).toContain('2026-10-23/2026-10-23');
  });

  for (const width of [390, 1280]) {
    test(`seletor opcional cabe na interface em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await authenticateAsOwner(page);
      await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: { sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07' } }));
      await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { ocorrencias: [{ id: 'today', nome: 'Hoje', data: '2026-10-07', status: 'PROGRAMADA', agenda: null }] } }));
      await page.goto('/operacao/comandas');
      const occurrenceSelect = page.getByLabel('Agendamento de hoje');
      await expect(occurrenceSelect).toBeVisible();
      await expect(occurrenceSelect).toHaveValue('today');
      await expect(occurrenceSelect).toBeEnabled();
      const bounds = await occurrenceSelect.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    });
  }

for (const width of [390, 1280]) {
  test(`paused legacy recurrence definition, activation, reload and Friday dates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.clock.install({ time: new Date('2026-10-22T15:00:00Z') });
    await authenticateAsOwner(page);
    const rule: Record<string, any> = { id: 'legacy-weekly', nome: 'Legacy Friday', diaSemana: 5, primeiraData: null, geracaoDesde: null, ultimaData: '2026-10-31T00:00:00.000Z', horaInicio: '18:00', horaFim: '20:00', local: null, ativa: false, archivedAt: null, _count: { ocorrencias: 0 } };
    const rows: Array<Record<string, any>> = []; const updates: Record<string, unknown>[] = []; const activations: Record<string, unknown>[] = [];
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { agendas: [rule], ocorrencias: rows } }));
    await page.route('**/api/operacao/agenda/agendas/legacy-weekly', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>; updates.push(body); Object.assign(rule, body);
      return route.fulfill({ json: rule });
    });
    await page.route('**/api/operacao/agenda/agendas/legacy-weekly/salvar-e-ativar', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>; activations.push(body);
      rule.ativa = true; rule.geracaoDesde = `${String(body.aPartirDe)}T00:00:00.000Z`;
      const start = new Date(`${String(body.aPartirDe)}T00:00:00Z`); const end = new Date(String(body.ultimaData) + 'T00:00:00Z');
      for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) if (date.getUTCDay() === rule.diaSemana) rows.push({ id: `occ-${date.toISOString().slice(0, 10)}`, agendaId: rule.id, nome: rule.nome, data: date.toISOString().slice(0, 10), horaInicio: rule.horaInicio, horaFim: rule.horaFim, status: 'PROGRAMADA', podeEditar: true, podeCancelar: true, bloqueio: null });
      rule._count.ocorrencias = rows.length;
      const dates = rows.map((row) => row.data);
      return route.fulfill({ json: { agendaId: rule.id, nome: rule.nome, salva: true, reativada: true, criadas: dates.length, datas: dates, datasCriadas: dates } });
    });
    await page.goto('/operacao/agenda');
    await page.getByRole('button', { name: /Agendamentos recorrentes/ }).click();
    await expect(page.getByText('Pausada — nenhuma nova data será gerada')).toBeVisible();
    await page.getByRole('button', { name: 'Editar repetição Legacy Friday' }).click();
    await expect(page.getByText('Pausada — nenhuma nova data será gerada')).toBeVisible();
    await expect(page.getByLabel('Dia da semana')).toHaveValue('5');
    await expect(page.getByLabel('Gerar próximas datas a partir de')).toHaveCount(0);
    await page.getByLabel('Nome').fill('Igarapé');
    await page.getByLabel('Local (opcional)').fill('Bar QA');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toMatchObject({ nome: 'Igarapé', local: 'Bar QA', diaSemana: 5, ultimaData: '2026-10-31' });
    await expect(page.getByRole('status').filter({ hasText: 'Igarapé: alterações salvas.' })).toContainText('A repetição continua pausada.');
    await page.reload();
    await page.getByRole('button', { name: /Agendamentos recorrentes/ }).click();
    await expect(page.getByText('Pausada — nenhuma nova data será gerada')).toBeVisible();
    await page.getByRole('button', { name: 'Editar repetição Igarapé' }).click();
    await expect(page.getByLabel('Nome')).toHaveValue('Igarapé');
    await expect(page.getByLabel('Dia da semana')).toHaveValue('5');
    await expect(page.getByRole('button', { name: 'Salvar e ativar' })).toBeVisible();
    await page.getByRole('button', { name: 'Salvar e ativar' }).click();
    const generationDate = page.getByLabel('Gerar próximas datas a partir de');
    await expect(generationDate).toBeVisible(); await generationDate.fill('2026-10-23');
    await page.getByRole('button', { name: 'Salvar e ativar' }).click();
    await expect.poll(() => activations.length).toBe(1);
    expect(activations[0]).toMatchObject({ nome: 'Igarapé', diaSemana: 5, aPartirDe: '2026-10-23', ultimaData: '2026-10-31' });
    await expect(page.getByRole('status').filter({ hasText: 'Igarapé ativada:' })).toContainText('2 novas datas criadas');
    await expect(page.getByRole('status').filter({ hasText: 'Igarapé ativada:' })).toContainText('2026-10-23 até 2026-10-30');
    await page.reload();
    await page.getByRole('button', { name: /sexta-feira, 23 de outubro, 1 agendamentos/ }).click();
    await expect(page.getByRole('button', { name: /Igarapé Programada · Semanal/ })).toBeVisible();
    await page.getByRole('button', { name: /sexta-feira, 30 de outubro, 1 agendamentos/ }).click();
    await expect(page.getByRole('button', { name: /Igarapé Programada · Semanal/ })).toBeVisible();
    await page.getByRole('button', { name: /Agendamentos recorrentes/ }).click();
    await expect(page.getByText('Ativa — próximas datas são geradas automaticamente')).toBeVisible();
    await expect(page.getByText('2 datas no total')).toBeVisible();
    expect(rows.map((row) => row.data)).toEqual(['2026-10-23', '2026-10-30']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
});
