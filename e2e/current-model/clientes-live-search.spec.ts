import { expect, test, type Page, type Route } from '@playwright/test';

type Customer = { id: string; nome: string; telefone?: string | null; email?: string | null };
const client = (id: string, nome: string): Customer => ({ id, nome, telefone: '11999990000', email: `${id}@qa.test` });
const response = (items: Customer[], page = 1, pages = 1, total = items.length) => ({
  items: items.map((item) => ({
    ...item,
    valorPendente: 0,
    totalGasto: 0,
    estatisticas: { totalComandasFechadas: 0, totalGasto: 0, totalMlChope: 0, ultimaVisitaEm: null },
    podeExcluir: false,
  })),
  pagination: { page, limit: 20, total, pages },
});

async function openCustomers(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route('**/api/**', (route) => route.abort());
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: {
    usuario: { id: 'qa-owner', nome: 'QA', email: 'owner@qa.test', papel: 'DONO', permissoesOperacao: [] },
    cervejaria: { id: 'qa-tenant', nome: 'QA', slug: 'qa' },
  } }));
  await page.route('**/api/operacao/contexto', (route) => route.fulfill({ json: {
    ativo: true, operationMode: 'EVENTO', operationalSettingsSource: 'CANONICAL_PDV', plannedOperationsEnabled: false, cashRegisterEnabled: false,
    tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, controlaEstoque: false,
    temCozinha: false, usaCardapio: false, quantidadeMesas: 0, whatsappPedidoProntoEnabled: false,
    whatsappPedidoProntoNaCozinha: false, kitchenItemsChargeAtLaunch: false,
    allowCloseComandaWithPendingKitchenOrders: false, pontosVenda: [],
  } }));
  await page.route('**/api/clientes?*', handler);
  await page.goto('/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
}

test('busca automaticamente nomes além da página inicial, mantém foco e restaura a lista ao limpar', async ({ page }) => {
  const requests: URL[] = [];
  await openCustomers(page, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const q = url.searchParams.get('q') ?? '';
    await route.fulfill({ json: q ? response([client('found', 'Nome fora da primeira página')]) : response(
      Array.from({ length: 20 }, (_, index) => client(`initial-${index}`, `Cliente inicial ${index + 1}`)), 1, 4, 65,
    ) });
  });

  const search = page.getByPlaceholder('Buscar nome, telefone ou e-mail...');
  await search.fill('Nome fora');
  await expect.poll(() => requests.at(-1)?.searchParams.get('q')).toBe('Nome fora');
  await expect(page.getByText('Nome fora da primeira página')).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('q')).toBe('Nome fora');
  expect(await search.evaluate((element) => document.activeElement === element)).toBe(true);

  await search.fill('');
  await expect(page.getByText('Cliente inicial 1', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('q')).toBe('');
});

test('digitação rápida deixa visível apenas o resultado do último termo', async ({ page }) => {
  await openCustomers(page, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (q === 'Al') {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({ json: response([client('old', 'Resultado antigo Al')]) });
      return;
    }
    await route.fulfill({ json: response(q ? [client('new', 'Resultado atual Alice')] : []) });
  });
  const search = page.getByPlaceholder('Buscar nome, telefone ou e-mail...');
  await search.fill('Al');
  await page.waitForTimeout(340);
  await search.fill('Alice');
  await expect(page.getByText('Resultado atual Alice')).toBeVisible();
  await expect(page.getByText('Resultado antigo Al')).toHaveCount(0);
  await page.waitForTimeout(180);
  await expect(page.getByText('Resultado atual Alice')).toBeVisible();
});

test('reinicia em página um e mantém ordenação e paginação no filtro', async ({ page }) => {
  const requests: URL[] = [];
  await openCustomers(page, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const requestedPage = Number(url.searchParams.get('page') ?? '1');
    const q = url.searchParams.get('q') ?? '';
    const ordenar = url.searchParams.get('ordenar') ?? '';
    await route.fulfill({ json: response(
      [client(`${q}-${ordenar}-${requestedPage}`, `${q || 'Lista'} ${ordenar} página ${requestedPage}`)], requestedPage, 3, 45,
    ) });
  });
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.getByText('Lista ultimaVisita página 2')).toBeVisible();
  const search = page.getByPlaceholder('Buscar nome, telefone ou e-mail...');
  await search.fill('Luna');
  await expect(page.getByText('Luna ultimaVisita página 1')).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
  await page.getByRole('button', { name: 'Nome A–Z' }).click();
  await expect(page.getByText('Luna nome página 1')).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('q')).toBe('Luna');
  expect(requests.at(-1)?.searchParams.get('ordenar')).toBe('nome');
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.getByText('Luna nome página 2')).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('q')).toBe('Luna');
  expect(requests.at(-1)?.searchParams.get('page')).toBe('2');
});

test('separa vazio, carregamento e erro de consulta', async ({ page }) => {
  let fail = false;
  await openCustomers(page, async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (fail) {
      await route.fulfill({ status: 503, json: { error: 'Falha sintética da API' } });
      return;
    }
    if (q === 'lento') await new Promise((resolve) => setTimeout(resolve, 450));
    await route.fulfill({ json: response([]) });
  });
  const search = page.getByPlaceholder('Buscar nome, telefone ou e-mail...');
  await search.fill('lento');
  await expect(page.getByText('Carregando...')).toBeVisible();
  await expect(page.getByText('Nenhum cliente encontrado')).toBeVisible();
  fail = true;
  await search.fill('falha');
  await expect(page.getByRole('alert')).toContainText('Falha sintética da API');
  await expect(page.getByText('Nenhum cliente encontrado')).toHaveCount(0);
});

test.describe('layout responsivo de busca', () => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    test(`${viewport.width}px mantém campo utilizável e focado`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openCustomers(page, async (route) => {
        const q = new URL(route.request().url()).searchParams.get('q') ?? '';
        await route.fulfill({ json: response(q ? [client('mobile', 'Cliente responsivo')]: []) });
      });
      const search = page.getByPlaceholder('Buscar nome, telefone ou e-mail...');
      await search.fill('respon');
      await expect(page.getByText('Cliente responsivo')).toBeVisible();
      expect(await search.evaluate((element) => document.activeElement === element)).toBe(true);
      await expect(page.getByRole('button', { name: 'Buscar' })).toBeVisible();
    });
  }
});
