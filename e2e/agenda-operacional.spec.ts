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

  test('legacy weekly rule requires explicit dates and keeps saving separate from resume', async ({ page }) => {
    await authenticateAsOwner(page);
    const rule: Record<string, unknown> = { id: 'legacy-weekly', nome: 'Legacy Friday', diaSemana: 5, primeiraData: null, ultimaData: null, horaInicio: '18:00', horaFim: '20:00', local: null, ativa: false, archivedAt: null, _count: { ocorrencias: 0 } };
    const savedBodies: Record<string, unknown>[] = []; const resumeBodies: Record<string, unknown>[] = [];
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => route.fulfill({ json: { agendas: [rule], ocorrencias: [] } }));
    await page.route('**/api/operacao/agenda/agendamentos', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>; savedBodies.push(body);
      rule.primeiraData = String(body.data) + 'T00:00:00.000Z'; rule.ultimaData = String(body.fim) + 'T00:00:00.000Z';
      return route.fulfill({ json: { agendaId: rule.id, salva: true, criadas: 0, datas: [], motivo: 'DEFINICAO_SALVA_SEM_AGENDAR' } });
    });
    await page.route('**/api/operacao/agenda/agendas/legacy-weekly/retomar', async (route) => {
      resumeBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { agendaId: rule.id, salva: true, reativada: true, criadas: 2, datas: ['2026-10-23', '2026-10-30'] } });
    });
    await page.goto('/operacao/agenda');
    await page.getByRole('button', { name: /Agendamentos recorrentes/ }).click();
    await expect(page.getByText(/Regra antiga sem limites persistidos/)).toBeVisible();
    await page.getByRole('button', { name: /Legacy Friday/ }).click();
    await expect(page.getByText(/limites persistidos/)).toBeVisible();
    const firstDate = page.getByLabel('Primeira data'); const lastDate = page.locator('[role="dialog"] input[type="date"]').nth(1);
    await expect(firstDate).toHaveValue(''); await expect(lastDate).toHaveValue('');
    await firstDate.fill('2026-10-23'); await lastDate.fill('2026-10-31');
    await page.getByRole('button', { name: /Salvar defini/ }).click();
    await expect.poll(() => savedBodies.length).toBe(1);
    expect(savedBodies[0]).toMatchObject({ agendaId: 'legacy-weekly', data: '2026-10-23', fim: '2026-10-31', gerarDatas: false });
    await expect(page.getByRole('status').filter({ hasText: 'Regra salva' })).toBeVisible();
    await page.getByRole('button', { name: /Agendamentos recorrentes/ }).click();
    await page.getByRole('button', { name: /Legacy Friday/ }).click();
    await expect(page.getByLabel('Primeira data')).toHaveValue('2026-10-23');
    await expect(page.locator('[role="dialog"] input[type="date"]').nth(1)).toHaveValue('2026-10-31');
    await page.getByRole('dialog').getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: /Agendamentos recorrentes/ }).click();
    await page.getByRole('button', { name: 'Retomar e agendar datas' }).click();
    await expect(page.getByRole('heading', { name: /Retomar repeti/ })).toBeVisible();
    await page.getByRole('button', { name: 'Retomar e agendar datas' }).click();
    await expect.poll(() => resumeBodies.length).toBe(1);
    expect(resumeBodies[0]?.requestId).toBeTruthy();
    await expect(page.getByRole('status').filter({ hasText: /retomad/ })).toBeVisible();
  });
});
