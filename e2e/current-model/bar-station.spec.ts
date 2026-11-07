import { expect, test, type Page } from '@playwright/test';

type Order = {
  id: string; numero: number; status: string; estacao: 'COZINHA' | 'BAR'; createdAt: string; statusDesde: string; entregueEm: string | null;
  observacao: string | null; comanda: { id: string; tipo: string; identificador: string; numero: number; cliente: null };
  itens: Array<{ id: string; nome: string; quantidade: number; precoUnit: number; observacao: string | null; opcionais: []; cancelamentoPendente: boolean; paraViagem: boolean }>;
};

const contexto = {
  ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true, tapsEnabled: false,
  operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: true, barEnabled: true,
  kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false,
  barItemsChargeAtLaunch: false, allowCloseComandaWithPendingBarOrders: false,
  controlaEstoque: false, temCozinha: true, temBar: true, usaCardapio: true, quantidadeMesas: 0,
  whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, whatsappPedidoProntoNoBar: false,
  pontosVenda: [{ id: 'pdv-test', nome: 'QA', ativo: true }],
};

function order(id: string, numero: number, estacao: 'COZINHA' | 'BAR', nome: string): Order {
  const at = new Date(Date.UTC(2026, 10, 7, 20, 0, numero)).toISOString();
  return {
    id, numero, status: 'RECEBIDO', estacao, createdAt: at, statusDesde: at, entregueEm: null, observacao: null,
    comanda: { id: `comanda-${id}`, tipo: 'MESA', identificador: '4', numero: 4, cliente: null },
    itens: [{ id: `item-${id}`, nome, quantidade: 2, precoUnit: 25, observacao: null, opcionais: [], cancelamentoPendente: false, paraViagem: false }],
  };
}

async function stub(page: Page, permissoesOperacao: string[] = []) {
  const queues = { cozinha: [order('k1', 41, 'COZINHA', 'Batata frita')], bar: [order('b1', 42, 'BAR', 'Caipirinha')] };
  const statusCalls: string[] = [];
  const productBodies: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'user-test', nome: 'QA', email: 'qa@example.test', papel: permissoesOperacao.length ? 'ATENDENTE' : 'DONO', permissoesOperacao }, cervejaria: { id: 'tenant-test', nome: 'Bar QA' } } });
    } else if (path.endsWith('/api/operacao/contexto')) {
      await route.fulfill({ json: contexto });
    } else if (path.endsWith('/api/onboarding/readiness')) {
      await route.fulfill({ json: { mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } } });
    } else if (path.endsWith('/api/operacao/cozinha') || path.endsWith('/api/operacao/bar')) {
      await route.fulfill({ json: path.endsWith('/bar') ? queues.bar : queues.cozinha });
    } else if (/\/api\/operacao\/(cozinha|bar)\/[^/]+\/status$/.test(path)) {
      statusCalls.push(path);
      const estacao = path.includes('/bar/') ? 'bar' : 'cozinha';
      const id = path.split('/').at(-2)!;
      const { status } = route.request().postDataJSON() as { status: string };
      queues[estacao] = queues[estacao].map((o) => (o.id === id ? { ...o, status } : o));
      await route.fulfill({ json: queues[estacao].find((o) => o.id === id) });
    } else if (path.endsWith('/api/operacao/produtos/categorias')) {
      await route.fulfill({ json: { categorias: ['Drinks', 'Porções'], categoriasPdv: [{ id: 'cat-drinks', nome: 'Drinks', gamificada: false }, { id: 'cat-porcoes', nome: 'Porções', gamificada: false }], catalogoCanonico: true } });
    } else if (path.endsWith('/api/operacao/produtos') && route.request().method() === 'POST') {
      productBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: 'novo' } });
    } else if (path.includes('/api/operacao/produtos')) {
      await route.fulfill({ json: [] });
    } else if (path.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.route('**/socket.io/**', (route) => route.abort());
  return { statusCalls, productBodies };
}

test('Bar TV shows only the bar queue with its own title and advances through the bar API', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/operacao/bar/tv');
  await expect(page.locator('.qt-bar-tv .cozinha-tv-eyebrow')).toHaveText('Bar');
  await expect(page.getByText('Caipirinha')).toBeVisible();
  await expect(page.getByText('Batata frita')).toHaveCount(0);
  await page.locator('[data-audit="operacao-cozinha-avancar"]').first().click();
  await expect.poll(() => calls.statusCalls).toEqual(['/api/operacao/bar/b1/status']);
});

test('Kitchen TV keeps showing only kitchen orders when the bar is enabled', async ({ page }) => {
  await stub(page);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.locator('.cozinha-tv-eyebrow')).toHaveText('Cozinha');
  await expect(page.locator('.qt-bar-tv')).toHaveCount(0);
  await expect(page.getByText('Batata frita')).toBeVisible();
  await expect(page.getByText('Caipirinha')).toHaveCount(0);
});

test('Bar operational screen links to the Bar TV and appears in navigation', async ({ page }) => {
  await stub(page);
  await page.goto('/operacao/bar');
  await expect(page.getByText('Caipirinha')).toBeVisible();
  await expect(page.locator('a[href="/operacao/bar/tv"]')).toBeVisible();
  await expect(page.locator('a[href="/operacao/bar"]').first()).toBeVisible();
});

test('kitchen-only staff is redirected away from the bar screen', async ({ page }) => {
  await stub(page, ['kitchen.read', 'kitchen.operate']);
  await page.goto('/operacao/bar');
  await expect(page).not.toHaveURL(/\/operacao\/bar$/);
  await expect(page.getByText('Caipirinha')).toHaveCount(0);
});

test('Bar visual settings and TV simulation are configured separately from the kitchen', async ({ page }) => {
  await stub(page);
  await page.goto('/operacao/bar/tv?demo=1&maxColunas=4&pedidos=3');
  await expect(page.locator('.qt-bar-tv .cozinha-tv-eyebrow')).toHaveText('Bar · Simulação');
});

test('catalog destination selector allows a single station: Balcão, Cozinha or Bar', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/operacao/catalogo');
  await page.getByRole('button', { name: '+ Produto' }).click();
  await page.getByRole('button', { name: 'Drinks' }).click();
  await page.getByLabel('Nome').fill('Gin tônica');
  await page.getByLabel('Preço').fill('3000');

  const balcao = page.getByTestId('destino-preparo-balcao');
  const cozinha = page.getByTestId('destino-preparo-cozinha');
  const bar = page.getByTestId('destino-preparo-bar');
  await expect(balcao).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Preparar em pedido separado')).toHaveCount(0);

  await cozinha.click();
  await expect(cozinha).toHaveAttribute('aria-checked', 'true');
  await bar.click();
  await expect(bar).toHaveAttribute('aria-checked', 'true');
  await expect(cozinha).toHaveAttribute('aria-checked', 'false');
  await expect(balcao).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Gera pedido de preparo na fila do Bar')).toBeVisible();
  await expect(page.getByText('Preparar em pedido separado')).toBeVisible();

  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect.poll(() => calls.productBodies.length).toBe(1);
  expect(calls.productBodies[0]).toMatchObject({ exigePreparo: true, estacaoPreparo: 'BAR' });
});
