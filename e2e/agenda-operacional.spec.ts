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
    await expect(page.getByLabel('Ocorrência do caixa (opcional)')).toHaveCount(0);
    expect(agendaRequests).toEqual([]);
  });

  test('usuário sem permissão de agenda é redirecionado sem consultar o endpoint', async ({ page }) => {
    await authenticateAsOwner(page, 'CANONICAL_PDV', 'OPERADOR', []);
    const agendaRequests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/api/operacao/agenda/')) agendaRequests.push(request.url()); });
    await page.goto('/operacao/agenda');
    await expect(page).toHaveURL(/\/operacao\/caixa$/);
    await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toHaveCount(0);
    expect(agendaRequests).toEqual([]);
  });

  test('confirma data diferente, limpa confirmação ao trocar e mostra o contexto persistido', async ({ page }) => {
    await authenticateAsOwner(page);
    const requested: Record<string, unknown>[] = [];
    let cashResponse: { sessao: ReturnType<typeof openedCash> | null; comandasAbertas: number; diaOperacional: string } = {
      sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07',
    };
    const otherOccurrence = { id: 'other-day', nome: 'Outro dia', data: '2026-10-10', status: 'ABERTA' as const, agenda: { nome: 'Sábado', frequencia: 'SEMANAL' as const, diaSemana: 6 } };
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: cashResponse }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { ocorrencias: [
      { id: 'same-day', nome: 'Hoje', data: '2026-10-07', status: 'PROGRAMADA', agenda: null },
      otherOccurrence,
      { id: 'closed', nome: 'Encerrada', data: '2026-10-07', status: 'FECHADA', agenda: null },
      { id: 'cancelled', nome: 'Cancelada', data: '2026-10-07', status: 'CANCELADA', agenda: null },
    ] } }));
    await page.route('**/api/operacao/cardapios?ativo=true', (route) => route.fulfill({ json: [{ id: 'ui-menu', nome: 'Menu de teste', ativo: true, itemCount: 1 }] }));
    await page.route('**/api/operacao/caixa/abrir', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requested.push(body);
      const persisted = body.ocorrenciaId === otherOccurrence.id ? otherOccurrence : null;
      const session = openedCash(persisted);
      cashResponse = { sessao: session, comandasAbertas: 0, diaOperacional: '2026-10-07' };
      return route.fulfill({ status: 201, json: session });
    });
    await page.goto('/operacao/comandas');

    await page.getByRole('button', { name: 'Cardápio salvo' }).click();
    await page.getByRole('radio', { name: /Menu de teste/ }).click();
    const occurrenceSelect = page.getByLabel('Ocorrência do caixa (opcional)');
    await expect(occurrenceSelect.locator('option', { hasText: 'Encerrada' })).toHaveCount(0);
    await expect(occurrenceSelect.locator('option', { hasText: 'Cancelada' })).toHaveCount(0);
    const openButton = page.getByRole('button', { name: 'Abrir caixa' });
    await occurrenceSelect.selectOption('other-day');
    await expect(openButton).toBeDisabled();
    const confirmation = page.getByRole('checkbox');
    await confirmation.check();
    await expect(openButton).toBeEnabled();
    await occurrenceSelect.selectOption('same-day');
    await expect(confirmation).toHaveCount(0);
    await occurrenceSelect.selectOption('other-day');
    await expect(openButton).toBeDisabled();
    await confirmation.check();
    await openButton.click();

    await expect.poll(() => requested.length).toBe(1);
    expect(requested[0]).toMatchObject({ ocorrenciaId: 'other-day', confirmarDataDiferente: true });
    await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('Outro dia');
    await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('10/10/2026');
  });

  test('Sem ocorrência abre sem associação e mostra o contexto persistido vazio', async ({ page }) => {
    await authenticateAsOwner(page);
    let cashResponse: { sessao: ReturnType<typeof openedCash> | null; comandasAbertas: number; diaOperacional: string } = {
      sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07',
    };
    const requested: Record<string, unknown>[] = [];
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: cashResponse }));
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { ocorrencias: [
      { id: 'same-day', nome: 'Hoje', data: '2026-10-07', status: 'PROGRAMADA', agenda: null },
    ] } }));
    await page.route('**/api/operacao/cardapios?ativo=true', (route) => route.fulfill({ json: [{ id: 'ui-menu', nome: 'Menu de teste', ativo: true, itemCount: 1 }] }));
    await page.route('**/api/operacao/caixa/abrir', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requested.push(body);
      const session = openedCash(null);
      cashResponse = { sessao: session, comandasAbertas: 0, diaOperacional: '2026-10-07' };
      return route.fulfill({ status: 201, json: session });
    });
    await page.goto('/operacao/comandas');
    const occurrenceSelect = page.getByLabel('Ocorrência do caixa (opcional)');
    await expect(occurrenceSelect).toHaveValue('');
    await page.getByRole('button', { name: 'Cardápio salvo' }).click();
    await page.getByRole('radio', { name: /Menu de teste/ }).click();
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect.poll(() => requested.length).toBe(1);
    expect(Object.hasOwn(requested[0]!, 'ocorrenciaId')).toBe(false);
    expect(Object.hasOwn(requested[0]!, 'confirmarDataDiferente')).toBe(false);
    await expect(page.getByTestId('caixa-contexto-ocorrencia')).toContainText('Sem ocorrência');
  });

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
