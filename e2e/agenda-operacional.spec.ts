import { expect, test, type Page } from '@playwright/test';

type SettingsSource = 'CANONICAL_PDV' | 'LEGACY';

async function authenticateAsOwner(page: Page, source: SettingsSource = 'CANONICAL_PDV') {
  await page.route('**/api/**', (route) => route.abort());
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: {
    usuario: { id: 'agenda-ui-owner', nome: 'QA Agenda', email: 'agenda-ui@qa.test', papel: 'DONO' },
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
  await page.goto('/operacao/configuracoes/equipe');
  await page.getByRole('link', { name: 'Operação' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toBeVisible();
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

  test('recorrência sem ocorrências edita por ID; retry usa PATCH sem reativar; avulsa preserva campos após erro', async ({ page }) => {
    await authenticateAsOwner(page);
    const writes: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    let patchAttempts = 0;
    await page.route('**/api/operacao/agenda/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') return route.fulfill({ json: {
        agendas: [{ id: 'recorrencia-inativa', nome: 'Recorrência sem geração', diaSemana: 6, horaInicio: '18:00', horaFim: null, local: null, ativa: false }],
        ocorrencias: [],
      } });
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ method: request.method(), url: request.url(), body });
      if (request.method() === 'PATCH' && ++patchAttempts === 1) {
        return route.fulfill({ status: 409, json: { error: 'Falha temporária ao salvar' } });
      }
      if (request.method() === 'POST' && request.url().endsWith('/ocorrencias')) {
        return route.fulfill({ status: 400, json: { error: 'Data recusada' } });
      }
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { id: 'recorrencia-inativa' } });
    });
    await openAgendaSettings(page);

    await expect(page.getByText('Nenhuma ocorrência neste período.')).toBeVisible();
    await page.getByRole('button', { name: 'Editar recorrência Recorrência sem geração' }).click();
    const agendaForm = page.locator('form').filter({ hasText: 'Editar recorrência semanal' });
    await expect(agendaForm.getByLabel('Nome')).toHaveValue('Recorrência sem geração');
    await agendaForm.getByLabel('Nome').fill('Recorrência revisada');
    await agendaForm.getByRole('button', { name: 'Salvar edição' }).click();
    await expect(page.getByRole('alert')).toContainText('Falha temporária ao salvar');
    await expect(agendaForm.getByLabel('Nome')).toHaveValue('Recorrência revisada');
    await expect(agendaForm.getByRole('heading', { name: 'Editar recorrência semanal' })).toBeVisible();

    await agendaForm.getByRole('button', { name: 'Salvar edição' }).click();
    await expect(page.getByRole('heading', { name: 'Nova recorrência semanal' })).toBeVisible();
    const patchWrites = writes.filter((write) => write.method === 'PATCH');
    expect(patchWrites).toHaveLength(2);
    expect(patchWrites.map((write) => write.url)).toEqual([
      'http://127.0.0.1:5202/api/operacao/agenda/agendas/recorrencia-inativa',
      'http://127.0.0.1:5202/api/operacao/agenda/agendas/recorrencia-inativa',
    ]);
    expect(patchWrites.every((write) => !Object.hasOwn(write.body, 'ativa'))).toBe(true);
    expect(writes.some((write) => write.method === 'POST' && write.url.endsWith('/agendas'))).toBe(false);

    const avulsaForm = page.locator('form').filter({ hasText: 'Ocorrência avulsa' });
    const occurrenceDate = await avulsaForm.getByLabel('Data').inputValue();
    await avulsaForm.getByLabel('Nome').fill('Avulsa para retry');
    await avulsaForm.getByRole('button', { name: 'Cadastrar ocorrência' }).click();
    await expect(page.getByRole('alert')).toContainText('Data recusada');
    await expect(avulsaForm.getByLabel('Nome')).toHaveValue('Avulsa para retry');
    await expect(avulsaForm.getByLabel('Data')).toHaveValue(occurrenceDate);
  });

  test('erro de consulta é visível, retry recupera a agenda e preserva o formulário', async ({ page }) => {
    await authenticateAsOwner(page);
    let reads = 0;
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => {
      reads += 1;
      if (reads <= 3) return route.fulfill({ status: 503, json: { error: 'Agenda indisponível' } });
      return route.fulfill({ json: { agendas: [], ocorrencias: [] } });
    });
    await openAgendaSettings(page);
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a agenda');
    const form = page.locator('form').filter({ hasText: 'Nova recorrência semanal' });
    await form.getByLabel('Nome').fill('Preservada durante recuperação');
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByText('Nenhuma recorrência cadastrada.')).toBeVisible();
    await expect(form.getByLabel('Nome')).toHaveValue('Preservada durante recuperação');
    expect(reads).toBe(4);
  });

  test('modo LEGACY não monta a gestão nem consulta API canônica da agenda', async ({ page }) => {
    await authenticateAsOwner(page, 'LEGACY');
    const agendaRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/operacao/agenda/')) agendaRequests.push(request.url());
    });
    await page.goto('/operacao/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toHaveCount(0);
    await page.route('**/api/operacao/caixa?pontoVendaId=*', (route) => route.fulfill({ json: { sessao: null, comandasAbertas: 0, diaOperacional: '2026-10-07' } }));
    await page.goto('/operacao/comandas');
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
    await expect(page.getByLabel('Ocorrência do caixa (opcional)')).toHaveCount(0);
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
