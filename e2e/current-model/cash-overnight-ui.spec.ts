import { expect, test, type Page } from '@playwright/test';

const point = { id: 'cash-overnight-point', nome: 'Principal', ativo: true };
const openSession = {
  id: 'cash-overnight-session', status: 'ABERTO', diaOperacional: '2026-10-09',
  abertoEm: '2026-10-10T02:55:00.000Z', fechadoEm: null, ocorrencia: null,
  gaveta: { esperadoDinheiro: 100 },
  esperado: { totalVendas: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0 },
  movimentos: [],
};

const overnightClosedCommands = [
  ['cash-ui-136', 'PIX 136', 136],
  ['cash-ui-111', 'PIX 111', 111],
  ['cash-ui-235', 'PIX 235', 235],
  ['cash-ui-121', 'PIX 121', 121],
].map(([id, identificador, total]) => ({
  id, tipo: 'APELIDO', identificador, status: 'FECHADA', pontoVendaId: point.id,
  diaOperacional: '2026-10-09', createdAt: '2026-10-09T23:30:00-03:00',
  fechadaEm: '2026-10-10T03:00:00.000Z', subtotal: total, desconto: 0, total,
  valorEmAberto: 0, cliente: null, pedidos: [],
  pagamentos: [{ id: `${id}-payment`, forma: 'PIX', valor: total, valorRecebido: null, troco: null, pagoEm: '2026-10-10T03:00:00.000Z', sessaoCaixaId: openSession.id }],
}));
const avulsa = {
  id: 'cash-ui-avulsa', tipo: 'AVULSA', identificador: 'Venda avulsa de teste', status: 'FECHADA',
  pontoVendaId: point.id, diaOperacional: '2026-10-09', createdAt: '2026-10-10T00:15:00-03:00',
  fechadaEm: '2026-10-10T03:15:00.000Z', subtotal: 20, desconto: 0, total: 20,
  valorEmAberto: 0, cliente: null, pedidos: [],
  pagamentos: [{ id: 'cash-ui-avulsa-payment', forma: 'PIX', valor: 20, valorRecebido: null, troco: null, pagoEm: '2026-10-10T03:15:00.000Z', sessaoCaixaId: openSession.id }],
};

const newSession = {
  ...openSession, id: 'cash-overnight-session-next', diaOperacional: '2026-10-10',
  abertoEm: '2026-10-10T13:00:00.000Z', gaveta: { esperadoDinheiro: 50 },
  esperado: { totalVendas: 10, pix: 10, cartaoDebito: 0, cartaoCredito: 0 },
};

async function mockCashApi(page: Page, options: { failCommands?: boolean } = {}) {
  let activeSession = openSession;
  const openedBySession: Record<string, unknown[]> = {
    [openSession.id]: [{
      id: 'cash-ui-command', tipo: 'APELIDO', identificador: 'Mesa da noite', status: 'ABERTA',
      pontoVendaId: point.id, diaOperacional: '2026-10-09', createdAt: '2026-10-09T23:20:00.000Z',
      fechadaEm: null, subtotal: 25, desconto: 0, total: 25, valorEmAberto: 25,
      cliente: null, pedidos: [], pagamentos: [],
    }],
    [newSession.id]: [{
      id: 'cash-ui-new-command', tipo: 'APELIDO', identificador: 'Mesa do novo turno', status: 'ABERTA',
      pontoVendaId: point.id, diaOperacional: '2026-10-10', createdAt: '2026-10-10T13:01:00.000Z',
      fechadaEm: null, subtotal: 12, desconto: 0, total: 12, valorEmAberto: 12,
      cliente: null, pedidos: [], pagamentos: [],
    }],
  };
  const closedBySession: Record<string, unknown[]> = {
    [openSession.id]: [...overnightClosedCommands, avulsa],
    [newSession.id]: [],
  };

  await page.route('**/api/**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname === '/api/auth/me') return route.fulfill({ json: {
      usuario: { id: 'cash-ui-owner', nome: 'Operador QA', email: 'owner@example.invalid', papel: 'DONO', permissoesOperacao: [] },
      cervejaria: { id: 'cash-ui-company', nome: 'Empresa QA', slug: 'cash-ui' },
    } });
    if (pathname === '/api/operacao/contexto') return route.fulfill({ json: {
      ativo: true, operationMode: 'CAIXA', cashRegisterEnabled: true, plannedOperationsEnabled: false,
      operationalSettingsSource: 'LEGACY', pontosVenda: [point], quantidadeMesas: 0, usaCardapio: false,
      controlaEstoque: false, temCozinha: false, tapsEnabled: false,
    } });
    if (pathname === '/api/onboarding/readiness') return route.fulfill({ json: {
      mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true,
      firstSaleCompleted: true, operationReady: true, canConfigure: false,
      modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
    } });
    if (pathname === '/api/operacao/caixa') {
      return route.fulfill({ json: { sessao: activeSession, diaOperacional: activeSession.diaOperacional, comandasAbertas: 1 } });
    }
    if (pathname === '/api/operacao/comandas') {
      if (options.failCommands && searchParams.get('sessaoCaixaId')) return route.fulfill({ status: 503, json: { error: 'offline' } });
      if (searchParams.get('sessaoCaixaId') !== activeSession.id) return route.fulfill({ json: [] });
      const rows = searchParams.get('status') === 'ABERTA'
        ? openedBySession[activeSession.id]
        : closedBySession[activeSession.id];
      return route.fulfill({ json: rows ?? [] });
    }
    if (pathname === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    if (pathname === '/api/trailers' || pathname === '/api/eventos/ativos') return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  return {
    setSession: (session: typeof openSession) => { activeSession = session; },
  };
}

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`turno noturno segue visível e comandas acessíveis em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockCashApi(page);
    await page.goto('/operacao/comandas');
    await expect(page.getByTestId('caixa-turno-anterior')).toContainText('Caixa aberto em 09/10');
    await expect(page.getByTestId('caixa-turno-anterior')).toContainText('turno ainda em andamento');
    await expect(page.getByText('Mesa da noite')).toBeVisible();
    await expect(page.locator('[data-audit="operacao-caixa-abrir"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Nova comanda/ })).toHaveAttribute('aria-disabled', 'false');
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`comandas do turno ativo mantêm lista e contador após meia-noite em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockCashApi(page);
    await page.goto('/operacao/comandas');
    await expect(page.getByRole('button', { name: 'Abertas (1)' })).toBeVisible();
    await expect(page.getByText('Mesa da noite')).toBeVisible();
    await page.getByTestId('comandas-fechadas-tab').click();
    await expect(page.getByRole('button', { name: 'Fechadas (4)' })).toBeVisible();
    for (const label of ['PIX 136', 'PIX 111', 'PIX 235', 'PIX 121']) {
      await expect(page.getByText(label)).toBeVisible();
    }
    await expect(page.getByText('Venda avulsa de teste')).toHaveCount(0);
    await expect(page.locator('.metric-card').filter({ hasText: 'Comandas fechadas' })).toContainText('4');
    await expect(page.locator('.metric-card').filter({ hasText: 'Vendas avulsas' })).toContainText('1');
    await expect(page.getByText('R$ 603,00')).toBeVisible();
  });
}

test('session cache key changes open and closed lists when a new session becomes active', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockCashApi(page);
  await page.goto('/operacao/comandas');
  await expect(page.getByText('Mesa da noite')).toBeVisible();
  api.setSession(newSession);
  await page.clock.fastForward(31_000);
  await expect(page.getByText('Mesa do novo turno')).toBeVisible();
  await expect(page.getByText('Mesa da noite')).toHaveCount(0);
  await page.getByTestId('comandas-fechadas-tab').click();
  await expect(page.getByRole('button', { name: 'Fechadas (0)' })).toBeVisible();
  await expect(page.getByText('PIX 136')).toHaveCount(0);
});

test('erro de consulta de comandas mostra indisponibilidade e não lista vazia', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCashApi(page, { failCommands: true });
  await page.goto('/operacao/comandas');
  await expect(page.getByRole('alert').filter({ hasText: 'lista e os contadores estao indisponiveis' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechadas (—)' })).toBeVisible();
  await expect(page.getByText('Nenhuma comanda aberta neste turno')).toHaveCount(0);
});
