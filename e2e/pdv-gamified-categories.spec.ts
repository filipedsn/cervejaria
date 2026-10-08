import { expect, test, type Page } from '@playwright/test';

async function mockCatalog(page: Page) {
  const unexpected: string[] = [];
  const categories = [{ id: 'category-beverages', nome: 'Bebidas', gamificada: false }];
  const products: Array<Record<string, unknown>> = [];
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/me' && request.method() === 'GET') return reply({ usuario: { id: 'category-owner', nome: 'QA Owner', email: 'owner@example.invalid', papel: 'DONO' }, cervejaria: { id: 'tenant-category-qa', nome: 'QA', slug: 'category-qa' } });
    if (path === '/api/onboarding/readiness') return reply({ mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } });
    if (path === '/api/operacao/contexto') return reply({ ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true, tapsEnabled: false, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: false, controlaEstoque: false, temCozinha: false, usaCardapio: false, quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'point-category-qa', nome: 'QA', ativo: true }] });
    if (path === '/api/operacao/produtos/categorias' && request.method() === 'GET') return reply({ categorias: categories.map((item) => item.nome), categoriasPdv: categories, ordem: categories.map((item) => item.nome), catalogoCanonico: true });
    if (path === '/api/operacao/produtos/categorias' && request.method() === 'POST') {
      writes.push({ method: 'POST', path, body: body ?? {} });
      const category = { id: 'category-sweets', nome: String(body?.nome), gamificada: Boolean(body?.gamificada) };
      categories.push(category);
      return reply(category, 201);
    }
    if (path === '/api/operacao/produtos/categorias/category-sweets' && request.method() === 'PUT') {
      writes.push({ method: 'PUT', path, body: body ?? {} });
      Object.assign(categories.find((item) => item.id === 'category-sweets')!, body);
      return reply(categories.find((item) => item.id === 'category-sweets'));
    }
    if (path === '/api/operacao/produtos' && request.method() === 'GET') return reply(products);
    if (path === '/api/operacao/produtos' && request.method() === 'POST') {
      writes.push({ method: 'POST', path, body: body ?? {} });
      products.push({ id: 'product-sweet', ...body });
      return reply(products.at(-1), 201);
    }
    if (path === '/api/audit/events' && request.method() === 'POST') return route.fulfill({ status: 204, body: '' });
    if (path === '/api/trailers' || path === '/api/eventos/ativos') return reply([]);
    if (path === '/api/cervejaria/configuracao-operacional') return reply({ configuration: { setupCompletedAt: '2026-10-08T12:00:00.000Z' } });
    unexpected.push(`${request.method()} ${path}`);
    return route.abort('blockedbyclient');
  });
  return { categories, writes, unexpected };
}

test('cadastra/edita categoria gamificada e seleciona essa categoria no produto com APIs simuladas', async ({ page }) => {
  test.setTimeout(45_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { writes, unexpected } = await mockCatalog(page);
  await page.goto('/operacao/catalogo');

  await page.getByRole('button', { name: '+ Categoria' }).click();
  await page.getByLabel('Nome').fill('Doces artesanais');
  await page.getByRole('button', { name: 'Salvar categoria' }).click();
  await expect(page.getByRole('button', { name: 'Editar Doces artesanais' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar Doces artesanais' }).click();
  const editCategoryDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Editar categoria' }) });
  const gamifiedFlag = editCategoryDialog.getByRole('checkbox', { name: /Categoria gamificada/ });
  await expect(gamifiedFlag).toBeVisible();
  await gamifiedFlag.check();
  await expect(gamifiedFlag).toBeChecked();
  await page.getByRole('button', { name: 'Salvar categoria' }).click();

  await page.getByRole('button', { name: '+ Produto' }).click();
  await page.getByRole('button', { name: 'Doces artesanais', exact: true }).click();
  await page.getByLabel('Nome').fill('Brigadeiro QA');
  await page.getByLabel('Preço').fill('12,00');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => writes.filter((write) => write.path === '/api/operacao/produtos').length).toBe(1);
  expect(writes.at(-1)?.body.categoriaPdvId).toBe('category-sweets');
  expect(writes.at(-1)?.body.categoria).toBe('Doces artesanais');
  expect(writes.find((write) => write.method === 'PUT')?.body.gamificada).toBe(true);
  expect(unexpected).toEqual([]);
});
