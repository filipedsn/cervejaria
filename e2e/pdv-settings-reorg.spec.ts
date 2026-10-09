import { expect, test, type Page } from '@playwright/test';

const point = { id: 'pdv-reorg-unit', nome: 'PDV da assinatura', ativo: true };
const context = {
  ativo: true,
  operationMode: 'CAIXA',
  cashRegisterEnabled: true,
  tapsEnabled: true,
  inventoryEnabled: false,
  kitchenEnabled: true,
  controlaEstoque: false,
  temCozinha: true,
  quantidadeMesas: 0,
  kitchenItemsChargeAtLaunch: true,
  allowCloseComandaWithPendingKitchenOrders: false,
  whatsappPedidoProntoEnabled: true,
  pontosVenda: [point],
  operationalSettingsSource: 'CANONICAL_PDV',
};

type MockOptions = { tapsEnabled?: boolean; failOperationalPatch?: boolean; failPixPatch?: boolean; source?: 'CANONICAL_PDV' | 'LEGACY' };

async function mockApi(page: Page, options: MockOptions = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let tapsEnabled = options.tapsEnabled ?? true;
  let pix = '';
  let companySettings = { exibirKpisComanda: true, comandasColunaUnica: true };
  const source = options.source ?? 'CANONICAL_PDV';
  const body = (route: Parameters<Parameters<Page['route']>[1]>[0]) => route.request().postDataJSON() as Record<string, unknown>;
  page.on('request', request => {
    const path = new URL(request.url()).pathname + new URL(request.url()).search;
    if (path.startsWith('/api/')) requests.push({ method: request.method(), path, ...(request.method() !== 'GET' ? { body: request.postDataJSON() } : {}) });
  });
  await page.routeWebSocket('**/socket.io/**', socket => socket.close());
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const reply = (json: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (path === '/api/auth/me') return reply({ usuario: { id: 'reorg-owner', nome: 'QA', email: 'qa@example.test', papel: 'DONO' }, cervejaria: { id: 'reorg-tenant', nome: 'QA Reorg', slug: 'qa-reorg', chavePix: pix, ...companySettings } });
    if (path === '/api/operacao/contexto') return reply({ ...context, tapsEnabled, operationalSettingsSource: source, pontosVenda: [point] });
    if (path === '/api/eventos/ativos') return reply([]);
    if (path === '/api/trailers') return reply([]);
    if (path === '/api/public/dev/app-origin') return reply({ origin: null });
    if (path === '/api/cervejaria/configuracao-operacional' && route.request().method() === 'GET') {
      return reply({
        configurationSource: source,
        enablements: { cashMode: true, cashRegister: true, plannedOperations: false, taps: tapsEnabled, inventory: false, kitchen: true },
        configuration: {
          ...(source === 'CANONICAL_PDV' ? { configurationSource: source } : {}), setupCompletedAt: '2026-10-09T00:00:00.000Z', tapsEnabled, inventoryEnabled: false, kitchenEnabled: true,
          kitchenItemsChargeAtLaunch: true, allowCloseComandaWithPendingKitchenOrders: false,
          whatsappPedidoProntoEnabled: true, whatsappPedidoProntoNaCozinha: false,
        },
      });
    }
    if (path === '/api/cervejaria/configuracao-operacional' && route.request().method() === 'PATCH') {
      if (options.failOperationalPatch) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada ao salvar parâmetro' }) });
      const payload = body(route);
      if (typeof payload.tapsEnabled === 'boolean') tapsEnabled = payload.tapsEnabled;
      return reply({ saved: true });
    }
    if (path === '/api/cervejaria/chave-pix' && route.request().method() === 'PATCH') {
      if (options.failPixPatch) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada ao salvar PIX' }) });
      pix = String(body(route).chavePix ?? '');
      return reply({ id: 'reorg-tenant', nome: 'QA Reorg', slug: 'qa-reorg', chavePix: pix, ...companySettings });
    }
    if (path === '/api/cervejaria/operacao' && route.request().method() === 'PATCH') {
      companySettings = { ...companySettings, ...body(route) } as typeof companySettings;
      return reply({ id: 'reorg-tenant', nome: 'QA Reorg', slug: 'qa-reorg', chavePix: pix, ...companySettings });
    }
    if (path === '/api/operacao/config' && route.request().method() === 'PATCH') return reply({ saved: true });
    if (path === '/api/produtos/categorias-comanda/ordem') return reply({ ordem: route.request().method() === 'PUT' ? body(route).ordem : ['chope', 'comidas', 'bebidas', 'outros'] });
    if (path === '/api/operacao/produtos/categorias') return reply({ categorias: ['Bebidas', 'Comidas', 'Chope'], ordem: ['Bebidas', 'Comidas', 'Chope'], catalogoCanonico: true });
    if (path === '/api/operacao/produtos/categorias/ordem' && route.request().method() === 'PUT') return reply({ ordem: body(route).ordem });
    if (path === '/api/taps') return reply([{ id: 'reorg-tap', numero: 1, nome: 'Torneira QA', ativo: true, pontoVendaId: point.id, produtoId: 'beer', produto: { nome: 'Chope QA' } }]);
    if (path === '/api/produtos') return reply([{ id: 'beer', nome: 'Chope QA', ativo: true, categoria: 'Chope' }]);
    if (path === '/api/clientes') return reply({ items: [{ id: 'qa-client', nome: 'Cliente QA', telefone: '11987654321' }], pagination: { page: 1, pages: 1 } });
    if (path === '/api/onboarding/readiness') return reply({ mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: true, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: false, missingSteps: [] } } });
    if (path === '/api/operacao/agenda/ocorrencias') return reply({ agendas: [], ocorrencias: [] });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Mock sem rota para ${path}` }) });
  });
  return requests;
}

for (const width of [390, 768]) {
  test(`configurações do PDV organizadas sem overflow em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await mockApi(page);
    await page.goto('/operacao/configuracoes/pdv');

    await expect(page.getByRole('link', { name: 'Equipe', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'PDV', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aparência', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operação', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Trailers', exact: true })).toHaveCount(0);
    await expect(page.getByText('Equipe, PDV e aparência')).toBeVisible();
    await expect(page.getByRole('heading', { name: point.nome })).toHaveCount(0);
    await expect(page.getByText('PDV único desta assinatura. Evento pode ser associado como contexto ao abrir o caixa.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('O PDV opera por caixa. Você pode associar uma ocorrência ao abrir o caixa.', { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('canonical-pdv-settings').locator(':scope > details').first().locator('summary')).toContainText('Recursos do PDV');

    for (const title of ['Recursos do PDV', 'Atendimento e comandas', 'Tela de comandas', 'Catálogo', 'Pagamentos e notificações', 'Portal do cliente', 'Torneiras']) {
      await expect(page.locator('summary').getByText(title, { exact: true })).toHaveCount(1);
    }
    await expect.poll(() => requests.some(request => request.path.startsWith('/api/taps') && request.path.includes(`pontoVendaId=${point.id}`))).toBe(true);
    for (const name of ['Torneiras de chope', 'Controle de estoque', 'Cozinha / preparo', 'Mesas físicas', 'KPIs na tela de comandas', 'Lista de comandas em coluna única', 'Ordem das categorias na comanda', 'Ordem das categorias do catálogo', 'Chave PIX da empresa', 'Avisar cliente quando o pedido ficar pronto']) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(1);
    }
    await expect(page.getByText('Pedidos pendentes na cozinha compõem o valor da comanda', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Permitir fechar comanda com pedido pendente na cozinha', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Como você trabalha?')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Como começar a vender' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Como você vai operar?' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    const payments = page.locator('details').filter({ has: page.locator('summary').getByText('Pagamentos e notificações', { exact: true }) });
    const summary = payments.locator('summary');
    await summary.click();
    const pix = payments.getByRole('textbox', { name: 'Chave PIX da empresa' });
    await pix.fill('rascunho@qa.test');
    await summary.click();
    await expect(payments).not.toHaveAttribute('open', '');
    await summary.click();
    await expect(pix).toHaveValue('rascunho@qa.test');
    await pix.fill('pix@qa.test');
    await payments.getByRole('button', { name: 'Salvar chave PIX' }).click();
    await expect.poll(() => requests.some(request => request.method === 'PATCH' && request.path === '/api/cervejaria/chave-pix' && (request.body as { chavePix?: string })?.chavePix === 'pix@qa.test')).toBe(true);
    await expect(payments.getByRole('status')).toContainText('Chave PIX salva');

    const qrGroup = page.locator('details').filter({ has: page.locator('summary').getByText('Portal do cliente', { exact: true }) });
    await qrGroup.locator('summary').click();
    await qrGroup.getByRole('button', { name: 'QR Code para abrir comanda' }).click();
    await expect(page.locator('[title="QR Code abrir comanda no caixa"] svg')).toBeVisible();
    await page.evaluate(() => { window.open = (url) => { (window as unknown as { shared: string }).shared = String(url); return { opener: null } as Window; }; });
    await page.getByRole('button', { name: 'Enviar link por WhatsApp' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Abrir WhatsApp/ }).click();
    expect(decodeURIComponent(await page.evaluate(() => (window as unknown as { shared: string }).shared))).toContain(`/c/qa-reorg/p/${point.id}`);

    for (const legacyPath of ['/operacao/configuracoes/operacao', '/operacao/configuracoes/trailers', '/configuracoes/operacao', '/configuracoes/trailers', '/configuracoes/carretos', '/configuracoes/clientes']) {
      await page.goto(legacyPath);
      await expect(page).toHaveURL(/\/operacao\/configuracoes\/pdv$/);
    }
    expect(requests.some(request => request.path.startsWith('/api/trailers'))).toBe(false);
  });
}

test('rascunho permanece ao recolher grupos e erros de salvamento são exibidos', async ({ page }) => {
  await mockApi(page, { failPixPatch: true, failOperationalPatch: true });
  await page.goto('/operacao/configuracoes/pdv');

  const payments = page.locator('details').filter({ has: page.locator('summary').getByText('Pagamentos e notificações', { exact: true }) });
  await payments.locator('summary').click();
  const pix = payments.getByRole('textbox', { name: 'Chave PIX da empresa' });
  await pix.fill('falha@qa.test');
  await payments.getByRole('button', { name: 'Salvar chave PIX' }).click();
  await expect(payments.getByRole('alert')).toContainText('Falha simulada ao salvar PIX');
  await payments.locator('summary').click();
  await payments.locator('summary').click();
  await expect(pix).toHaveValue('falha@qa.test');

  const resources = page.locator('details').filter({ has: page.locator('summary').getByText('Recursos do PDV', { exact: true }) });
  await resources.locator('summary').click();
  await resources.getByRole('button', { name: 'Desativar Cozinha / preparo' }).click();
  await expect(resources.getByRole('alert')).toContainText('Falha simulada ao salvar parâmetro');
});

test('controles agrupados continuam salvando pelos endpoints existentes', async ({ page }) => {
  const requests = await mockApi(page);
  await page.goto('/operacao/configuracoes/pdv');

  const attendance = page.locator('details').filter({ has: page.locator('summary').getByText('Atendimento e comandas', { exact: true }) });
  await attendance.locator('summary').click();
  const mesas = attendance.getByRole('spinbutton', { name: 'Quantidade de mesas' });
  await expect(mesas).toHaveValue('0');
  await mesas.fill('4');
  await attendance.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => requests.some(request => request.method === 'PATCH' && request.path === '/api/operacao/config' && (request.body as { quantidadeMesas?: number })?.quantidadeMesas === 4)).toBe(true);

  const display = page.locator('details').filter({ has: page.locator('summary').getByText('Tela de comandas', { exact: true }) });
  await display.locator('summary').click();
  await display.getByRole('button', { name: 'Ocultar KPIs na comanda' }).click();
  await display.getByRole('button', { name: 'Usar duas colunas na lista' }).click();
  await expect.poll(() => requests.filter(request => request.method === 'PATCH' && request.path === '/api/cervejaria/operacao').length).toBe(2);

  await display.getByRole('button', { name: 'Organizar categorias' }).click();
  await page.getByRole('button', { name: 'Mover Comidas para cima' }).click();
  await page.getByRole('button', { name: 'Salvar ordem' }).click();
  await expect.poll(() => requests.some(request => request.method === 'PUT' && request.path === '/api/produtos/categorias-comanda/ordem')).toBe(true);

  const catalog = page.locator('details').filter({ has: page.locator('summary').getByText('Catálogo', { exact: true }) });
  await catalog.locator('summary').click();
  await catalog.getByRole('button', { name: 'Organizar categorias' }).click();
  await page.getByRole('button', { name: 'Mover Comidas para cima' }).click();
  await page.getByRole('button', { name: 'Salvar ordem' }).click();
  await expect.poll(() => requests.some(request => request.method === 'PUT' && request.path === '/api/operacao/produtos/categorias/ordem')).toBe(true);

  const payments = page.locator('details').filter({ has: page.locator('summary').getByText('Pagamentos e notificações', { exact: true }) });
  await payments.locator('summary').click();
  await payments.getByRole('button', { name: 'Desativar aviso de pedido pronto pelo WhatsApp' }).click();
  await expect.poll(() => requests.some(request => request.method === 'PATCH' && request.path === '/api/cervejaria/configuracao-operacional' && (request.body as { whatsappPedidoProntoEnabled?: boolean })?.whatsappPedidoProntoEnabled === false)).toBe(true);
});

test('TAPs não são consultados nem montados quando desativados; agenda continua no menu próprio', async ({ page }) => {
  const requests = await mockApi(page, { tapsEnabled: false });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/operacao/configuracoes/pdv');
  await expect(page.locator('summary').getByText('Torneiras', { exact: true })).toHaveCount(0);
  expect(requests.some(request => request.path.startsWith('/api/taps') || request.path === '/api/produtos')).toBe(false);

  const agendaLink = page.getByRole('link', { name: 'Agenda', exact: true });
  await expect(agendaLink).toHaveAttribute('href', '/operacao/agenda');
  await agendaLink.click();
  await expect(page).toHaveURL(/\/operacao\/agenda$/);
  await expect(page.getByRole('heading', { name: 'Agenda operacional' })).toBeVisible();
  await expect.poll(() => requests.some(request => request.path.startsWith('/api/operacao/agenda/ocorrencias'))).toBe(true);
});

test('compatibilidade LEGACY preserva as abas Trailers e Operação', async ({ page }) => {
  await mockApi(page, { source: 'LEGACY' });
  await page.goto('/operacao/configuracoes/operacao');
  await expect(page.getByRole('link', { name: 'Trailers', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Operação', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PDV', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Como você trabalha?' })).toBeVisible();
  await page.goto('/configuracoes/operacao');
  await expect(page).toHaveURL(/\/configuracoes\/operacao$/);
  await expect(page.getByRole('link', { name: 'Operação', exact: true })).toBeVisible();
});
