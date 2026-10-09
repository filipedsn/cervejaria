import { expect, test, type Page } from '@playwright/test';

const point = { id: 'pdv-settings-unit', nome: 'Balcão da assinatura', ativo: true };
const context = {
  ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true,
  tapsEnabled: true, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false,
  kitchenEnabled: false, controlaEstoque: false, temCozinha: false, usaCardapio: false,
  quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
  pontosVenda: [point],
};

async function mock(page: Page, options: { source?: string; points?: typeof point[]; fail?: boolean; gate?: Promise<void>; employee?: boolean; initialTapsEnabled?: boolean; patchGate?: Promise<void>; configurationGate?: Promise<void>; configurationError?: boolean; setupIncomplete?: boolean; legacyPlannedOperations?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let tapsEnabled = options.initialTapsEnabled ?? true;
  let setupCompletedAt = options.setupIncomplete ? null : '2026-10-09T00:00:00.000Z';
  let plannedOperations = options.legacyPlannedOperations ?? false;
  const source = options.source ?? 'CANONICAL_PDV';
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) requests.push({ method: r.method(), path: new URL(r.url()).pathname + new URL(r.url()).search, ...(r.method() === 'PATCH' ? { body: r.postDataJSON() } : {}) }); });
  await page.routeWebSocket('**/socket.io/**', s => s.close());
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path === '/api/auth/me') return reply({ usuario: { id: 'settings-owner', nome: 'QA', email: 'settings@qa.test', papel: options.employee ? 'ATENDENTE' : 'DONO', permissoesOperacao: ['command.read'] }, cervejaria: { id: 'settings-tenant', nome: 'QA Settings', slug: 'qa-settings' } });
    if (path === '/api/operacao/contexto') {
      await options.gate;
      if (options.fail) return route.fulfill({ status: 409, json: { error: 'PDV canônico ausente' } });
      return reply({ ...context, tapsEnabled, operationalSettingsSource: options.source ?? 'CANONICAL_PDV', pontosVenda: options.points ?? [point] });
    }
    if (path === '/api/taps') return reply([{ id: 'settings-tap', numero: 1, nome: 'Torneira principal', ativo: true, pontoVendaId: point.id, produtoId: 'beer', produto: { nome: 'Chope QA' } }]);
    if (path === '/api/produtos') return reply([]);
    if (path === '/api/trailers' || path === '/api/eventos/ativos') return reply([]);
    if (path === '/api/cervejaria/configuracao-operacional' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { tapsEnabled?: boolean; operationMode?: 'CAIXA' | 'EVENTO'; completeInitialSetup?: boolean };
      await options.patchGate;
      if (body.tapsEnabled !== undefined) tapsEnabled = body.tapsEnabled;
      if (body.operationMode !== undefined) plannedOperations = body.operationMode === 'EVENTO';
      if (body.completeInitialSetup) setupCompletedAt = '2026-10-09T12:00:00.000Z';
      return reply({ saved: true });
    }
    if (path === '/api/cervejaria/configuracao-operacional') {
      await options.configurationGate;
      if (options.configurationError) return route.fulfill({ status: 409, json: { error: 'Configuração operacional indisponível' } });
      return reply({ configurationSource: source, enablements: { plannedOperations, cashRegister: !plannedOperations, cashMode: !plannedOperations, taps: tapsEnabled, inventory: false, kitchen: false }, configuration: { ...(source === 'CANONICAL_PDV' ? { configurationSource: source } : {}), setupCompletedAt, plannedOperationsEnabled: plannedOperations, tapsEnabled, inventoryEnabled: false, kitchenEnabled: false } });
    }
    if (path === '/api/operacao/agenda/ocorrencias') return reply({ agendas: [], ocorrencias: [] });
    return route.abort();
  });
  return requests;
}

for (const width of [390, 768]) {
  test(`PDV, TAP e QR corretos; rotas antigas; zero Trailer em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await mock(page);
    for (const path of ['/operacao/configuracoes/trailers', '/configuracoes/trailers', '/configuracoes/carretos', '/configuracoes/clientes']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/operacao\/configuracoes\/pdv$/);
      await expect(page.getByRole('link', { name: 'PDV', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Trailers', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: point.nome })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Torneiras deste PDV' })).toBeVisible();
      await expect(page.getByText('Chope QA', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Novo trailer|Novo PDV|Excluir PDV|Desativar PDV/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: `test-results/pdv-settings/pdv-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Editar', exact: true }).click({ trial: true });
    await page.screenshot({ path: `test-results/pdv-settings/taps-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'QR Code para abrir comanda', exact: true }).click();
    await expect(page.locator('[title="QR Code abrir comanda no caixa"] svg')).toBeVisible();
    await page.screenshot({ path: `test-results/pdv-settings/qr-${width}.png`, fullPage: true, animations: 'disabled' });
    // QR value is encoded in the SVG, so observe the real component through its
    // sharing flow without opening WhatsApp or sending any message.
    await page.route('**/api/clientes?**', r => r.fulfill({ json: { items: [{ id: 'client', nome: 'Cliente QA', telefone: '11987654321' }], pagination: { page: 1, pages: 1 } } }));
    await page.getByRole('button', { name: 'Enviar link por WhatsApp' }).click();
    await page.getByRole('checkbox').last().check();
    await page.evaluate(() => { window.open = (url) => { (window as unknown as { qaShare: string }).qaShare = String(url); return { opener: null } as Window; }; });
    await page.getByRole('button', { name: /Abrir WhatsApp/ }).click();
    const shared = await page.evaluate(() => (window as unknown as { qaShare: string }).qaShare);
    expect(decodeURIComponent(shared)).toContain(`/c/qa-settings/p/${point.id}`);
    expect(decodeURIComponent(shared)).not.toContain('/t/');
    await page.goto('/operacao/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Torneiras deste PDV' })).toHaveCount(0);
    expect(requests.some(r => r.path.startsWith('/api/trailers'))).toBe(false);
    expect(requests.filter(r => r.path.startsWith('/api/taps')).every(r => r.path.includes(`pontoVendaId=${point.id}`))).toBe(true);
    expect(requests.filter(r => r.method !== 'GET' && r.path !== '/api/audit/events')).toEqual([]);
  });
}

test('carregamento aguarda contexto sem consultar Trailer', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests = await mock(page, { gate });
  await page.goto('/configuracoes/trailers');
  await expect(page.getByText('Carregando...').first()).toBeVisible();
  expect(requests.some(r => r.path.startsWith('/api/trailers'))).toBe(false);
  release();
  await expect(page).toHaveURL(/\/operacao\/configuracoes\/pdv$/);
  expect(requests.some(r => r.path.startsWith('/api/trailers'))).toBe(false);
});

for (const points of [[], [point, { ...point, id: 'ambiguous' }], [{ ...point, ativo: false }]]) {
  test(`contexto inválido (${points.length} unidades, ativa=${points[0]?.ativo}) não provisiona nem monta legado`, async ({ page }) => {
    const requests = await mock(page, { points });
    await page.goto('/operacao/configuracoes/pdv');
    await expect(page.getByRole('alert')).toContainText('exatamente um PDV ativo');
    await expect(page.getByRole('button', { name: /Adicionar Tap|QR Code/ })).toHaveCount(0);
    expect(requests.some(r => r.path.startsWith('/api/trailers') || r.path.startsWith('/api/taps') || r.method !== 'GET')).toBe(false);
  });
}

test('erro do contexto falha fechado', async ({ page }) => {
  const requests = await mock(page, { fail: true });
  await page.goto('/operacao/configuracoes/trailers');
  await expect(page.getByRole('alert')).toContainText('validar o contexto');
  expect(requests.some(r => r.path.startsWith('/api/trailers') || r.method !== 'GET')).toBe(false);
});

test('LEGACY preserva gestão de Trailer', async ({ page }) => {
  const requests = await mock(page, { source: 'LEGACY' });
  await page.goto('/operacao/configuracoes/trailers');
  await expect(page.getByRole('button', { name: '+ Novo trailer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trailers', exact: true })).toBeVisible();
  expect(requests.some(r => r.path.startsWith('/api/trailers'))).toBe(true);
});

test('funcionário continua sem acesso às configurações', async ({ page }) => {
  const requests = await mock(page, { employee: true });
  await page.goto('/operacao/configuracoes/pdv');
  await expect(page).toHaveURL(/\/operacao\/comandas$/);
  await expect(page.getByRole('heading', { name: 'Torneiras deste PDV' })).toHaveCount(0);
  expect(requests.some(r => r.path.startsWith('/api/trailers'))).toBe(false);
});

test('seleção direta de Trailer redireciona tenant canônico sem consultar legado', async ({ page }) => {
  const requests = await mock(page);
  await page.goto('/trailer');
  await expect(page).toHaveURL(/\/operacao\/comandas$/);
  expect(requests.some(r => r.path.startsWith('/api/trailers'))).toBe(false);
});

test('parâmetro TAP desligado oculta manutenção, não consulta TAP/produto e preserva PDV/QR', async ({ page }) => {
  const requests = await mock(page, { initialTapsEnabled: false });
  await page.goto('/operacao/configuracoes/pdv');
  await expect(page.getByRole('heading', { name: point.nome })).toBeVisible();
  await expect(page.getByRole('button', { name: 'QR Code para abrir comanda' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Torneiras deste PDV' })).toHaveCount(0);
  expect(requests.some(r => r.path.startsWith('/api/taps') || r.path === '/api/produtos'), JSON.stringify(requests)).toBe(false);
});

test('alterar TAPs atualiza a seção somente após salvar e recarregar o contexto', async ({ page }) => {
  let release!: () => void;
  let patchStarted!: () => void;
  let holdNextPatch = false;
  let patchGate: Promise<void> | undefined;
  const requests = await mock(page, {
    initialTapsEnabled: true,
    get patchGate() { return patchGate; },
  });
  // Install a narrow route before the broad API mock so the test controls the
  // backend confirmation boundary without changing client state optimistically.
  await page.route('**/api/cervejaria/configuracao-operacional', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    if (holdNextPatch) {
      patchStarted();
      await patchGate;
    }
    return route.fallback();
  });

  const holdPatch = () => {
    holdNextPatch = true;
    patchGate = new Promise<void>(resolve => { release = resolve; });
    return new Promise<void>(resolve => { patchStarted = resolve; });
  };
  const releasePatch = () => { holdNextPatch = false; release(); };

  await page.goto('/operacao/configuracoes/operacao');
  const toggle = page.getByRole('button', { name: 'Desativar Torneiras de chope' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const disabling = holdPatch();
  await toggle.click();
  await disabling;
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(requests.filter(r => r.path === '/api/operacao/contexto').length).toBe(1);
  releasePatch();
  await expect(page.getByRole('button', { name: 'Ativar Torneiras de chope' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => requests.filter(r => r.path === '/api/operacao/contexto').length).toBeGreaterThan(1);
  await page.goto('/operacao/configuracoes/pdv');
  await expect(page.getByRole('heading', { name: point.nome })).toBeVisible();
  await expect(page.getByRole('button', { name: 'QR Code para abrir comanda' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Torneiras deste PDV' })).toHaveCount(0);
  expect(requests.some(r => r.path.startsWith('/api/taps') || r.path === '/api/produtos'), JSON.stringify(requests)).toBe(false);

  const enabling = holdPatch();
  await page.goto('/operacao/configuracoes/operacao');
  const enableToggle = page.getByRole('button', { name: 'Ativar Torneiras de chope' });
  await expect(enableToggle).toHaveAttribute('aria-pressed', 'false');
  await enableToggle.click();
  await enabling;
  await expect(enableToggle).toBeDisabled();
  await expect(enableToggle).toHaveAttribute('aria-pressed', 'false');
  expect(requests.filter(r => r.path === '/api/operacao/contexto').length).toBeGreaterThan(1);
  releasePatch();
  await expect(page.getByRole('button', { name: 'Desativar Torneiras de chope' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => requests.filter(r => r.path === '/api/operacao/contexto').length).toBeGreaterThan(2);
  await page.goto('/operacao/configuracoes/pdv');
  await expect(page.getByRole('heading', { name: point.nome })).toBeVisible();
  await expect(page.getByRole('button', { name: 'QR Code para abrir comanda' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Torneiras deste PDV' })).toBeVisible();
  await expect(page.getByText('Chope QA', { exact: true })).toBeVisible();
  expect(requests.filter(r => r.path.startsWith('/api/taps')).every(r => r.path.includes(`pontoVendaId=${point.id}`))).toBe(true);
  expect(requests.filter(r => r.method === 'PATCH' && r.path === '/api/cervejaria/configuracao-operacional').every(r => !Object.hasOwn(r.body as object, 'operationMode') && !Object.hasOwn(r.body as object, 'plannedOperationsEnabled'))).toBe(true);
});

test('configuração canônica remove modo e criação de PDV, preservando a orientação por caixa', async ({ page }) => {
  await mock(page);
  await page.goto('/operacao/configuracoes/operacao');
  await expect(page.getByText('O PDV opera por caixa. Você pode associar uma ocorrência ao abrir o caixa.')).toBeVisible();
  await expect(page.getByText('Como você trabalha?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Por caixa', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Por operações \/ eventos/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Criar ponto de venda' })).toHaveCount(0);
});

test('LEGACY mantém a escolha de modo e envia operationMode', async ({ page }) => {
  const requests = await mock(page, { source: 'LEGACY', legacyPlannedOperations: true });
  await page.goto('/operacao/configuracoes/operacao');
  await expect(page.getByText('Como você trabalha?')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Por caixa/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Por operações \/ eventos/ })).toBeVisible();
  await page.getByRole('button', { name: /^Por caixa/ }).click();
  await expect.poll(() => requests.some(r => r.method === 'PATCH' && (r.body as { operationMode?: string })?.operationMode === 'CAIXA')).toBe(true);
});

test('carregamento e erro da configuração não exibem controles LEGACY', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await mock(page, { configurationGate: gate });
  await page.goto('/operacao/configuracoes/operacao');
  await expect(page.getByText('Carregando configuração operacional…')).toBeVisible();
  await expect(page.getByText('Como você trabalha?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Por caixa', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Criar ponto de venda' })).toHaveCount(0);
  release();
  await expect(page.getByText('O PDV opera por caixa. Você pode associar uma ocorrência ao abrir o caixa.')).toBeVisible();

  const errorPage = await page.context().newPage();
  await mock(errorPage, { configurationError: true });
  await errorPage.goto('/operacao/configuracoes/operacao');
  await expect(errorPage.getByRole('alert')).toContainText('validar a configuração operacional');
  await expect(errorPage.getByText('Como você trabalha?')).toHaveCount(0);
  await expect(errorPage.getByRole('link', { name: 'Criar ponto de venda' })).toHaveCount(0);
  await errorPage.close();
});

test('setup canônico pula escolha de modo, envia recursos sem seletor e conclui', async ({ page }) => {
  const requests = await mock(page, { setupIncomplete: true, initialTapsEnabled: true });
  await page.goto('/operacao/configuracoes/operacao');
  await expect(page.getByRole('heading', { name: 'Quais recursos quer ativar?' })).toBeVisible();
  await expect(page.getByText('Como você vai operar?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Por caixa', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Por operações ou eventos/ })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('checkbox', { name: /Controle de estoque/ }).check();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByRole('heading', { name: 'Quais recursos quer ativar?' })).toHaveCount(0);
  const setupWrite = requests.find(r => r.method === 'PATCH' && (r.body as { completeInitialSetup?: boolean })?.completeInitialSetup);
  expect(setupWrite?.body).toMatchObject({ tapsEnabled: true, inventoryEnabled: true, kitchenEnabled: false, completeInitialSetup: true });
  expect(Object.hasOwn(setupWrite?.body as object, 'operationMode')).toBe(false);
  expect(Object.hasOwn(setupWrite?.body as object, 'plannedOperationsEnabled')).toBe(false);
});

test('setup LEGACY continua pedindo modo e envia operationMode', async ({ page }) => {
  const requests = await mock(page, { source: 'LEGACY', setupIncomplete: true, legacyPlannedOperations: true });
  await page.goto('/operacao/configuracoes/operacao');
  await expect(page.getByRole('heading', { name: 'Como você vai operar?' })).toBeVisible();
  const setupDialog = page.getByRole('dialog');
  await setupDialog.getByRole('button', { name: /^Por caixa/ }).click();
  await setupDialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Quais recursos quer ativar?' })).toBeVisible();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect.poll(() => requests.some(r => r.method === 'PATCH' && (r.body as { completeInitialSetup?: boolean })?.completeInitialSetup)).toBe(true);
  const setupWrite = requests.find(r => r.method === 'PATCH' && (r.body as { completeInitialSetup?: boolean })?.completeInitialSetup);
  expect(setupWrite?.body).toMatchObject({ operationMode: 'CAIXA', tapsEnabled: true, completeInitialSetup: true });
});
