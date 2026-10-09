import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function mockCatalog(page: Page, options: { permission?: boolean; canonical?: boolean; chope?: boolean; contextFailure?: boolean } = {}) {
  const { permission = true, canonical = true, chope = false, contextFailure = false } = options;
  const unexpected: string[] = [];
  const categories = [
    { id: 'category-beverages', nome: 'Bebidas', gamificada: false },
    { id: 'category-sweets', nome: 'Doces artesanais', gamificada: false },
    ...(chope ? [{ id: 'category-chope', nome: 'Chope', gamificada: false }] : []),
  ];
  const products: Array<Record<string, unknown>> = chope ? [{ id: 'product-chope', nome: 'Pilsen QA', categoria: 'Chope', categoriaPdvId: 'category-chope', tipo: 'BEBIDA', formato: 'CHOPE', precoUnit: '5', precos: [{ volumeMl: 300, preco: '5' }], ativo: true, ordem: 0, exigePreparo: false, prepararEmPedidoSeparado: false, controlaEstoque: false }] : [];
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const comandaOrder = ['chope', 'comidas', 'bebidas', 'outros'];
  const catalogOrder = categories.map((item) => item.nome);
  let failCreateOnce = true;
  let failUnifiedOrderOnce = true;
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/me' && request.method() === 'GET') return reply({ usuario: { id: 'category-owner', nome: 'QA Owner', email: 'owner@example.invalid', papel: permission ? 'DONO' : 'ATENDENTE', permissoesOperacao: permission ? ['catalog.manage'] : [] }, cervejaria: { id: 'tenant-category-qa', nome: 'QA', slug: 'category-qa' } });
    if (path === '/api/onboarding/readiness') return reply({ mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } });
    if (path === '/api/operacao/contexto') return contextFailure ? reply({ error: 'Contexto indisponível' }, 500) : reply({ ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true, tapsEnabled: chope, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: false, controlaEstoque: false, temCozinha: false, usaCardapio: true, quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'point-category-qa', nome: 'QA', ativo: true }] });
    if (path === '/api/operacao/produtos/categorias' && request.method() === 'GET') return reply({ categorias: catalogOrder, categoriasPdv: categories, ordem: catalogOrder, catalogoCanonico: canonical });
    if (path === '/api/operacao/produtos/categorias' && request.method() === 'POST') {
      writes.push({ method: 'POST', path, body: body ?? {} });
      if (failCreateOnce) { failCreateOnce = false; return reply({ error: 'Falha simulada ao salvar' }, 500); }
      const category = { id: `category-${categories.length + 1}`, nome: String(body?.nome), gamificada: body?.gamificada === true };
      categories.push(category);
      catalogOrder.push(category.nome);
      return reply(category, 201);
    }
    if (path.startsWith('/api/operacao/produtos/categorias/') && request.method() === 'PUT' && path !== '/api/operacao/produtos/categorias/ordem') {
      writes.push({ method: 'PUT', path, body: body ?? {} });
      const category = categories.find((item) => path.endsWith(item.id));
      if (!category) return reply({ error: 'Categoria não encontrada' }, 404);
      const previousName = category.nome;
      Object.assign(category, body);
      const orderIndex = catalogOrder.indexOf(previousName);
      if (orderIndex >= 0) catalogOrder[orderIndex] = category.nome;
      for (const product of products) if (product.categoriaPdvId === category.id) product.categoria = category.nome;
      return reply(category);
    }
    if (path === '/api/operacao/produtos/product-chope' && request.method() === 'PUT') {
      writes.push({ method: 'PUT', path, body: body ?? {} });
      Object.assign(products[0], body);
      return reply(products[0]);
    }
    if (path.startsWith('/api/operacao/produtos/categorias/') && request.method() === 'DELETE') {
      writes.push({ method: 'DELETE', path, body: {} });
      const category = categories.find((item) => path.endsWith(item.id));
      if (products.some((product) => product.categoriaPdvId === category?.id)) return reply({ error: 'Categoria usada por 1 produto(s); remova os vínculos antes de excluir.' }, 409);
      if (category) categories.splice(categories.indexOf(category), 1);
      return reply({ ok: true });
    }
    if (path === '/api/operacao/produtos/categorias/ordem' && request.method() === 'PUT') {
      writes.push({ method: 'PUT', path, body: body ?? {} });
      if (failCatalogOrderOnce) { failCatalogOrderOnce = false; return reply({ error: 'Falha simulada na ordem' }, 500); }
      return reply({ ordem: body?.ordem });
    }
    if (path === '/api/produtos/categorias-comanda/ordem' && request.method() === 'GET') return reply({ ordem: catalogOrder, catalogoCanonico: canonical });
    if (path === '/api/produtos/categorias-comanda/ordem' && request.method() === 'PUT') {
      writes.push({ method: 'PUT', path, body: body ?? {} });
      if (failUnifiedOrderOnce) { failUnifiedOrderOnce = false; return reply({ error: 'Falha simulada na ordem' }, 500); }
      catalogOrder.splice(0, catalogOrder.length, ...((body?.ordem as string[]) ?? []));
      return reply({ ordem: catalogOrder, catalogoCanonico: canonical });
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
  return { categories, products, writes, unexpected, comandaOrder };
}

test('três abas e manutenção centralizada com rascunho, erro/retry, flag false e descarte', async ({ page }) => {
  test.setTimeout(45_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { writes, unexpected } = await mockCatalog(page);
  await page.goto('/operacao/catalogo');
  await expect(page.getByRole('button', { name: 'Catálogo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cardápios salvos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Categorias' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Categoria' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Categorias' }).click();
  await expect(page.getByRole('button', { name: '+ Categoria' })).toBeVisible();
  await page.getByRole('button', { name: '+ Categoria' }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Nova categoria' }) });
  await dialog.getByLabel('Nome').fill('Doces artesanais');
  await dialog.getByLabel('Nome').fill('Sobremesas');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Falha simulada');
  await expect(dialog.getByLabel('Nome')).toHaveValue('Sobremesas');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('ul').getByText('Sobremesas', { exact: true })).toBeVisible();
  expect(writes.filter((write) => write.method === 'POST' && write.path.endsWith('/categorias'))).toHaveLength(2);
  expect(writes.filter((write) => write.method === 'POST' && write.path.endsWith('/categorias'))[1].body.gamificada).toBe(false);

  const editRow = page.locator('li').filter({ hasText: 'Doces artesanais' });
  await editRow.getByRole('button', { name: 'Editar' }).click();
  const edit = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Editar categoria' }) });
  await edit.getByLabel('Categoria gamificada').check();
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('li').filter({ hasText: 'Doces artesanais' }).getByText('Gamificada', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '+ Categoria' }).click();
  const discardDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Nova categoria' }) });
  await discardDialog.getByLabel('Nome').fill('Rascunho');
  await discardDialog.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('heading', { name: 'Descartar alterações?' }).waitFor();
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByRole('heading', { name: 'Nova categoria' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Editar Doces artesanais' })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('usa uma ordem única no catálogo, comanda e seleção de categoria no produto', async ({ page }) => {
  test.setTimeout(45_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { writes, products, unexpected, comandaOrder } = await mockCatalog(page);
  await page.goto('/operacao/catalogo');
  await page.getByRole('button', { name: 'Categorias' }).click();
  await expect(page.getByRole('heading', { name: 'Organizar categorias' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ordem no catálogo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mover Doces artesanais para cima' }).click();
  await page.getByRole('button', { name: 'Salvar ordem' }).first().click();
  const orderPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Organizar categorias' }) });
  await expect(orderPanel.getByRole('alert')).toContainText('Falha simulada na ordem');
  await expect(orderPanel.locator('ol > li').first()).toContainText('Doces artesanais');
  await orderPanel.getByRole('button', { name: 'Salvar ordem' }).click();
  expect(writes.filter((write) => write.path === '/api/produtos/categorias-comanda/ordem').at(-1)?.body.ordem).toEqual(['Doces artesanais', 'Bebidas']);

  await page.getByRole('button', { name: 'Catálogo' }).click();
  await page.getByRole('button', { name: '+ Produto' }).click();
  await page.getByRole('button', { name: 'Doces artesanais', exact: true }).click();
  await page.getByLabel('Nome').fill('Brigadeiro QA');
  await page.locator('#produto-pdv-preco').fill('12,00');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => products.length).toBe(1);
  expect(products[0].categoriaPdvId).toBe('category-sweets');
  expect(products[0].categoria).toBe('Doces artesanais');
  await page.getByRole('button', { name: 'Categorias' }).click();
  const beveragesRow = page.locator('ul').getByRole('listitem').filter({ hasText: 'Bebidas' });
  await beveragesRow.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(page.locator('ul').getByText('Bebidas', { exact: true })).toHaveCount(0);
  const sweetsRow = page.locator('ul').getByRole('listitem').filter({ hasText: 'Doces artesanais' });
  await sweetsRow.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(page.getByRole('alert')).toContainText('produto(s)');
  expect(unexpected).toEqual([]);
});

test('categorias respeitam permissão e modo LEGACY', async ({ page }) => {
  await mockCatalog(page, { permission: false });
  await page.goto('/operacao/catalogo');
  await expect(page.getByRole('button', { name: 'Categorias' })).toHaveCount(0);
});

test('renomear categoria Chope mantém formulário e payload por volume', async ({ page }) => {
  page.on('pageerror', (error) => console.log('PAGEERROR', error.stack));
  const { writes, unexpected } = await mockCatalog(page, { chope: true });
  await page.goto('/operacao/catalogo');
  await page.getByRole('button', { name: 'Categorias' }).click();
  const chopeRow = page.locator('ul').getByRole('listitem').filter({ hasText: 'Chope' });
  await chopeRow.getByRole('button', { name: 'Editar' }).click();
  const categoryDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Editar categoria' }) });
  await categoryDialog.getByLabel('Nome').fill('Cerveja de torneira');
  await categoryDialog.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('button', { name: 'Catálogo' }).click();
  await page.getByRole('button', { name: /Pilsen QA/ }).click();
  const productDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Editar/ }) });
  await expect(productDialog.getByText('300ml', { exact: true })).toBeVisible();
  await productDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  const productWrite = writes.find((write) => write.path.endsWith('/product-chope'));
  expect(productWrite?.body.categoriaPdvId).toBe('category-chope');
  expect(productWrite?.body.categoria).toBe('Cerveja de torneira');
  expect(productWrite?.body).not.toHaveProperty('tipo');
  expect(productWrite?.body).not.toHaveProperty('formato');
  await page.getByRole('button', { name: '+ Produto' }).click();
  await page.getByRole('button', { name: 'Cerveja de torneira', exact: true }).click();
  const newProductDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Novo produto' }) });
  await expect(newProductDialog.getByText('300ml', { exact: true })).toBeVisible();
  await newProductDialog.getByLabel('Nome').fill('Growler QA');
  await newProductDialog.getByText('300ml', { exact: true }).locator('..').locator('input').fill('7,00');
  await newProductDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  const chopeCreate = writes.find((write) => write.path === '/api/operacao/produtos' && write.method === 'POST');
  expect(chopeCreate?.body.categoriaPdvId).toBe('category-chope');
  expect(chopeCreate?.body.formato).toBe('CHOPE');
  expect(unexpected).toEqual([]);
});

test('modo LEGACY não monta manutenção canônica', async ({ page }) => {
  await mockCatalog(page, { canonical: false });
  await page.goto('/operacao/catalogo');
  await page.getByRole('button', { name: 'Categorias' }).click();
  await expect(page.getByText(/catálogo canônico ainda não está ativo/i)).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Categoria' })).toHaveCount(0);
});

test('erro de contexto não mostra manutenção de categorias', async ({ page }) => {
  await mockCatalog(page, { contextFailure: true });
  await page.goto('/operacao/catalogo');
  await expect(page.getByText(/não foi possível validar o contexto do PDV/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Categorias' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Categoria' })).toHaveCount(0);
});

test('capturas celular 390px e tablet 768px da aba Categorias', async ({ page }) => {
  test.setTimeout(45_000);
  const { unexpected } = await mockCatalog(page);
  const output = resolve('artifacts/pdv-category-management');
  await mkdir(output, { recursive: true });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/operacao/catalogo');
    await page.getByRole('button', { name: 'Categorias' }).click();
    await expect(page.getByRole('button', { name: '+ Categoria' })).toBeVisible();
    const sweetsRow = page.locator('ul').getByRole('listitem').filter({ hasText: 'Doces artesanais' });
    await sweetsRow.getByRole('button', { name: 'Editar' }).click();
    const editDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Editar categoria' }) });
    await editDialog.getByLabel('Categoria gamificada').check();
    await editDialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.locator('ul').getByRole('listitem').filter({ hasText: 'Doces artesanais' }).getByText('Gamificada', { exact: true })).toBeVisible();
    await page.addStyleTag({ content: '.app-bottom-nav,.fixed.top-0.z-50 { display:none!important }' });
    await page.screenshot({ path: resolve(output, `categorias-${width}px.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(unexpected).toEqual([]);
});
