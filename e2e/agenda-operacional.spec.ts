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
});
