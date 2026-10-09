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

  test('lista e agrupamento; edição, avulsa e geração explícita preservam rascunho e período', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticateAsOwner(page);
    const writes: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    let patchAttempts = 0;
    const agendaRows = [{ id: 'recorrencia-inativa', nome: 'Recorrência sem geração', diaSemana: 6, horaInicio: '18:00', horaFim: null, local: null, ativa: false }];
    await page.route('**/api/operacao/agenda/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') return route.fulfill({ json: {
        agendas: agendaRows,
        ocorrencias: [
          { id: 'occ-1', agendaId: null, nome: 'Abertura de sábado', data: '2026-10-10', horaInicio: '18:00', horaFim: '22:00', local: null, status: 'PROGRAMADA', agenda: null },
          { id: 'occ-2', agendaId: null, nome: 'Encontro da tarde', data: '2026-10-10', horaInicio: null, horaFim: null, local: null, status: 'ABERTA', agenda: null },
          { id: 'occ-3', agendaId: null, nome: 'Domingo', data: '2026-10-11', horaInicio: '11:00', horaFim: null, local: null, status: 'FECHADA', agenda: null },
        ],
      } });
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ method: request.method(), url: request.url(), body });
      if (request.method() === 'PATCH' && ++patchAttempts === 1) {
        return route.fulfill({ status: 409, json: { error: 'Falha temporária ao salvar' } });
      }
      if (request.method() === 'POST' && request.url().endsWith('/agendas')) {
        agendaRows.push({ id: 'recorrencia-nova', nome: String(body.nome), diaSemana: Number(body.diaSemana), horaInicio: String(body.horaInicio), horaFim: null, local: null, ativa: true });
      }
      if (request.method() === 'PATCH') {
        const updated = agendaRows.find((agenda) => request.url().endsWith(`/${agenda.id}`));
        if (updated) Object.assign(updated, body);
      }
      if (request.method() === 'POST' && request.url().endsWith('/ocorrencias')) {
        return route.fulfill({ status: 400, json: { error: 'Data recusada' } });
      }
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { id: 'recorrencia-inativa' } });
    });
    await openAgendaSettings(page);

    await expect(page.getByText('Abertura de sábado')).toBeVisible();
    await expect(page.getByText('Encontro da tarde')).toBeVisible();
    await expect(page.getByText('18:00–22:00 · Programada')).toBeVisible();
    await expect(page.getByText('11:00 · Fechada')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'sábado, 10 de outubro de 2026' })).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.getByRole('button', { name: 'Filtrar período' }).click();
    await page.getByLabel('Início do período').fill('2026-10-01');
    await page.getByLabel('Fim do período').fill('2026-10-31');
    await page.getByText('Recorrências', { exact: true }).click();
    await expect(page.getByText('Recorrência sem geração')).toBeVisible();

    await page.getByRole('button', { name: '+ Agendar' }).click();
    await page.getByRole('button', { name: 'Recorrência semanal', exact: true }).click();
    const createRecurrence = page.getByRole('dialog');
    await createRecurrence.getByLabel('Nome').fill('Nova recorrência semanal');
    const createButton = createRecurrence.getByRole('button', { name: 'Cadastrar recorrência' });
    await createButton.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const createWrites = writes.filter((write) => write.method === 'POST' && write.url.endsWith('/agendas'));
    expect(createWrites).toHaveLength(1);
    expect(createWrites[0]?.body).toMatchObject({ nome: 'Nova recorrência semanal', ativa: true });
    await expect(page.getByText('Nova recorrência semanal')).toBeVisible();

    await page.getByRole('button', { name: 'Editar recorrência Recorrência sem geração' }).click();
    const agendaForm = page.getByRole('dialog');
    await expect(agendaForm.getByLabel('Nome')).toHaveValue('Recorrência sem geração');
    await agendaForm.getByLabel('Nome').fill('Recorrência revisada');
    await agendaForm.getByRole('button', { name: 'Salvar edição' }).click();
    await expect(page.getByRole('alert')).toContainText('Falha temporária ao salvar');
    await expect(agendaForm.getByLabel('Nome')).toHaveValue('Recorrência revisada');
    await expect(agendaForm.getByRole('heading', { name: 'Editar recorrência semanal' })).toBeVisible();

    await agendaForm.getByRole('button', { name: 'Salvar edição' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Recorrência revisada')).toBeVisible();
    await expect(page.getByLabel('Início do período')).toHaveValue('2026-10-01');
    await expect(page.getByLabel('Fim do período')).toHaveValue('2026-10-31');
    const patchWrites = writes.filter((write) => write.method === 'PATCH');
    expect(patchWrites).toHaveLength(2);
    expect(patchWrites.every((write) => write.url.endsWith('/api/operacao/agenda/agendas/recorrencia-inativa'))).toBe(true);
    expect(patchWrites.every((write) => !Object.hasOwn(write.body, 'ativa'))).toBe(true);
    await page.getByRole('button', { name: '+ Agendar' }).click();
    await page.getByRole('button', { name: 'Ocorrência avulsa' }).click();
    const avulsaForm = page.getByRole('dialog');
    const occurrenceDate = await avulsaForm.getByLabel('Data').inputValue();
    await avulsaForm.getByLabel('Nome').fill('Avulsa para retry');
    await avulsaForm.getByRole('button', { name: 'Cadastrar ocorrência' }).click();
    await expect(page.getByRole('alert')).toContainText('Data recusada');
    await expect(avulsaForm.getByLabel('Nome')).toHaveValue('Avulsa para retry');
    await expect(avulsaForm.getByLabel('Data')).toHaveValue(occurrenceDate);
    page.once('dialog', (dialog) => dialog.accept());
    await avulsaForm.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const recurrenceRow = page.locator('details li').filter({ hasText: 'Recorrência revisada' });
    await recurrenceRow.getByRole('button', { name: 'Gerar datas' }).click();
    const gerarForm = page.getByRole('dialog');
    await expect(gerarForm.getByLabel('Recorrência')).toHaveValue('recorrencia-inativa');
    await expect(gerarForm.getByText(/Período da geração:/)).toBeVisible();
    await gerarForm.getByRole('button', { name: 'Gerar datas' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const generation = writes.find((write) => write.url.endsWith('/recorrencia-inativa/gerar'));
    expect(generation?.method).toBe('POST');
    expect(generation?.body).toMatchObject({ inicio: expect.any(String), fim: expect.any(String) });
    expect(writes.filter((write) => write.url.endsWith('/gerar'))).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByText('Reconectando...').evaluate((element) => { (element as HTMLElement).style.display = 'none'; });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/agenda-mobile.png' });
    await page.getByRole('button', { name: '+ Agendar' }).click();
    await page.getByRole('button', { name: 'Recorrência semanal', exact: true }).click();
    await page.screenshot({ path: 'artifacts/agenda-mobile-form.png' });
    await page.getByRole('button', { name: 'Voltar' }).click();
  });

  test('erro de consulta, vazio, retry e descarte em tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await authenticateAsOwner(page);
    let reads = 0;
    await page.route('**/api/operacao/agenda/ocorrencias?**', (route) => {
      reads += 1;
      if (reads <= 3) return route.fulfill({ status: 503, json: { error: 'Agenda indisponível' } });
      return route.fulfill({ json: { agendas: [], ocorrencias: [] } });
    });
    await openAgendaSettings(page);
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a agenda');
    await page.getByRole('button', { name: '+ Agendar' }).click();
    await page.getByRole('button', { name: 'Recorrência semanal', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Nome').fill('Preservada durante recuperação');
    await form.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByText('Nenhuma ocorrência no período')).toBeVisible();
    await expect(form.getByLabel('Nome')).toHaveValue('Preservada durante recuperação');
    expect(reads).toBe(4);
    page.once('dialog', (dialog) => dialog.dismiss());
    await form.getByRole('button', { name: 'Voltar' }).click();
    await expect(form).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await form.getByRole('button', { name: 'Voltar' }).click();
    await expect(form).toHaveCount(0);
    await page.getByText('Recorrências', { exact: true }).click();
    await expect(page.getByText('Nenhuma recorrência cadastrada.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByText('Reconectando...').evaluate((element) => { (element as HTMLElement).style.display = 'none'; });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/agenda-tablet.png' });
  });

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
