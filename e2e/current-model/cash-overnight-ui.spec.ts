import { expect, test, type Page } from '@playwright/test';

const point = { id: 'cash-overnight-point', nome: 'Principal', ativo: true };
const openSession = {
  id: 'cash-overnight-session', status: 'ABERTO', diaOperacional: '2026-10-09',
  abertoEm: '2026-10-10T02:55:00.000Z', fechadoEm: null, ocorrencia: null,
  gaveta: { esperadoDinheiro: 100 },
  esperado: { totalVendas: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0 },
  movimentos: [],
};

async function mockCashApi(page: Page, options: { failCash?: boolean } = {}) {
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
      if (options.failCash) return route.fulfill({ status: 503, json: { error: 'offline' } });
      return route.fulfill({ json: { sessao: openSession, diaOperacional: '2026-10-09', comandasAbertas: 1 } });
    }
    if (pathname === '/api/operacao/comandas' && searchParams.get('status') === 'ABERTA') return route.fulfill({ json: [{
      id: 'cash-ui-command', tipo: 'APELIDO', identificador: 'Mesa da noite', status: 'ABERTA',
      diaOperacional: '2026-10-09', abertaEm: '2026-10-09T23:20:00.000Z', total: 25, totalPago: 0,
      pedidos: [], pagamentos: [],
    }] });
    if (pathname === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    if (pathname === '/api/trailers' || pathname === '/api/eventos/ativos') return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
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

test('erro ao consultar caixa não é apresentado como turno ausente', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCashApi(page, { failCash: true });
  await page.goto('/operacao/comandas');
  await expect(page.getByRole('alert').filter({ hasText: 'nao confirma que o caixa esta fechado' })).toBeVisible();
  await expect(page.locator('[data-audit="operacao-caixa-abrir"]')).toHaveCount(0);
  await expect(page.getByText('Nenhuma comanda aberta')).toHaveCount(0);
});
