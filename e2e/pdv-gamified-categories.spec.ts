import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function mockCatalog(page: Page, options: { permission?: boolean; canonical?: boolean; chope?: boolean; contextFailure?: boolean; initialCategoryNames?: string[] } = {}) {
  const { permission = true, canonical = true, chope = false, contextFailure = false, initialCategoryNames } = options;
  const unexpected: string[] = [];
  const names = initialCategoryNames ?? ['Bebidas', 'Doces artesanais', ...(chope ? ['Chope'] : [])];
  const categories = names.map((nome) => ({
    id: nome === 'Bebidas' ? 'category-beverages' : nome === 'Doces artesanais' ? 'category-sweets' : nome === 'Chope' ? 'category-chope' : `category-${nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    nome,
    gamificada: false,
  }));
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
      if (category) {
        categories.splice(categories.indexOf(category), 1);
        const orderIndex = catalogOrder.indexOf(category.nome);
        if (orderIndex >= 0) catalogOrder.splice(orderIndex, 1);
      }
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
      if ((body?.ordem as string[] | undefined)?.length !== catalogOrder.length) return reply({ error: `Array must contain exactly ${catalogOrder.length} element(s)` }, 400);
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
  const { categories, writes, unexpected } = await mockCatalog(page);
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
  const submitCategory = page.locator('button[form="categoria-pdv-form"][type="submit"]');
  await submitCategory.click();
  await expect(dialog.getByRole('alert')).toContainText('Falha simulada');
  await expect(dialog.getByLabel('Nome')).toHaveValue('Sobremesas');
  await dialog.getByLabel('Nome').press('Enter');
  await expect.poll(() => writes.filter((write) => write.method === 'POST' && write.path.endsWith('/categorias')).length).toBe(2);
  await expect.poll(() => categories.filter((category) => category.nome === 'Sobremesas').length).toBe(1);
  await page.getByRole('button', { name: 'Categorias' }).click();
  await expect(page.locator('ul').getByText('Sobremesas', { exact: true })).toBeVisible();
  expect(writes.filter((write) => write.method === 'POST' && write.path.endsWith('/categorias'))).toHaveLength(2);
  expect(writes.filter((write) => write.method === 'POST' && write.path.endsWith('/categorias'))[1].body.gamificada).toBe(false);
  expect(categories.filter((category) => category.nome === 'Sobremesas')).toHaveLength(1);

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

test('excluir categoria remove a categoria do rascunho de ordem sem perder a ordem restante', async ({ page }) => {
  test.setTimeout(45_000);
  const { writes, unexpected } = await mockCatalog(page, {
    initialCategoryNames: ['Bebidas', 'Cervejas', 'Drinks', 'Outros', 'Porções', 'Teste'],
  });
  await page.goto('/operacao/catalogo');
  await page.getByRole('button', { name: 'Categorias' }).click();

  const orderPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Organizar categorias' }) });
  await expect(orderPanel.locator('ol > li')).toHaveCount(6);
  for (let i = 0; i < 4; i++) await orderPanel.getByRole('button', { name: 'Mover Porções para cima' }).click();
  await expect(orderPanel.locator('ol > li').first()).toContainText('Porções');

  const testCategory = page.locator('ul').getByRole('listitem').filter({ hasText: 'Teste' });
  await testCategory.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();

  await expect(page.locator('ul').getByText('Teste', { exact: true })).toHaveCount(0);
  await expect(orderPanel.locator('ol > li')).toHaveCount(5);
  await expect(orderPanel.getByText('Teste', { exact: true })).toHaveCount(0);
  await expect(orderPanel.getByRole('alert')).toHaveCount(0);
  await expect(orderPanel.locator('ol > li').first()).toContainText('Porções');
  await expect(orderPanel.getByRole('button', { name: 'Salvar ordem' })).toBeEnabled();
  await orderPanel.getByRole('button', { name: 'Salvar ordem' }).click();

  expect(writes.filter((write) => write.path === '/api/produtos/categorias-comanda/ordem').at(-1)?.body.ordem)
    .toEqual(['Porções', 'Bebidas', 'Cervejas', 'Drinks', 'Outros']);
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

test('seletor da comanda usa a mesma ordem canônica e mantém Chope por Tap na posição da categoria', async ({ page }) => {
  test.setTimeout(60_000);
  const order = ['Petiscos', 'Chope da casa', 'Bebidas especiais'];
  const products = [
    { id: 'tap-beer', nome: 'Pilsen QA', categoria: 'Chope da casa', tipo: 'BEBIDA', formato: 'CHOPE', categoriaPdvId: 'cat-tap', precos: [{ volumeMl: 300, preco: 5 }, { volumeMl: 500, preco: 8 }], ativo: true, ordem: 0, controlaEstoque: false, exigePreparo: false, prepararEmPedidoSeparado: false },
    { id: 'snack', nome: 'Pastel QA', categoria: 'Petiscos', tipo: 'COMIDA', formato: null, categoriaPdvId: 'cat-food', precos: [{ volumeMl: 1, preco: 12 }], ativo: true, ordem: 1, controlaEstoque: false, exigePreparo: false, prepararEmPedidoSeparado: false },
    { id: 'drink', nome: 'Soda QA', categoria: 'Bebidas especiais', tipo: 'BEBIDA', formato: 'OUTRO', categoriaPdvId: 'cat-drink', precos: [{ volumeMl: 1, preco: 6 }], ativo: true, ordem: 2, controlaEstoque: false, exigePreparo: false, prepararEmPedidoSeparado: false },
  ];
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path === '/api/auth/me') return reply({ usuario: { id: 'category-owner', nome: 'QA Owner', email: 'owner@example.invalid', papel: 'DONO' }, cervejaria: { id: 'tenant-category-qa', nome: 'QA', slug: 'category-qa' } });
    if (path === '/api/onboarding/readiness') return reply({ mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } });
    if (path === '/api/operacao/contexto') return reply({ ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true, tapsEnabled: true, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: false, controlaEstoque: false, temCozinha: false, usaCardapio: true, quantidadeMesas: 0, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'point-order-qa', nome: 'PDV QA', ativo: true }] });
    if (path === '/api/cervejaria/configuracao-operacional') return reply({ configuration: { setupCompletedAt: '2026-10-09T12:00:00.000Z' } });
    if (path === '/api/operacao/comandas/order-qa') return reply({ id: 'order-qa', tipo: 'APELIDO', status: 'ABERTA', identificador: 'Mesa QA', numero: 21, pontoVendaId: 'point-order-qa', cliente: null, subtotal: 0, total: 0, desconto: 0, valorEmAberto: 0, pedidos: [], itens: [] });
    if (path === '/api/operacao/produtos') return reply(products);
    if (path === '/api/operacao/caixa') return reply({ sessao: { id: 'shift-qa', status: 'ABERTO', abertoEm: '2026-10-09T12:00:00.000Z' } });
    if (path === '/api/operacao/caixa/taps') return reply({ trailerId: 'trailer-qa', taps: [{ id: 'tap-qa', numero: 1, nome: 'Tap 1', trailerId: 'trailer-qa', ativo: true, chopeAtual: { id: 'tap-beer', nome: 'Pilsen QA', tipo: 'BEBIDA', formato: 'CHOPE', precos: [{ volumeMl: 300, preco: 5 }, { volumeMl: 500, preco: 8 }] }, chopeCadastro: null, temMontagemAtiva: true }] });
    if (path === '/api/produtos/categorias-comanda/ordem') return reply({ ordem: order, catalogoCanonico: true });
    if (path === '/api/trailers' || path === '/api/eventos/ativos') return reply([]);
    if (path === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 404, json: { error: `Mock sem rota para ${path} (${request.method()})` } });
  });

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.goto('/operacao/comandas/order-qa');
    await page.getByRole('button', { name: '+ Itens' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar item' });
    const tabs = dialog.locator('.segmented-control button');
    await expect(tabs).toHaveText(['Petiscos', 'Chopes (Tap)', 'Bebidas especiais']);
    await expect(dialog.getByRole('button', { name: 'Pastel QA' })).toBeVisible();
    await page.screenshot({ path: resolve('artifacts/pdv-category-management', `comanda-${width}px.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('portal do cliente mantém a ordem e os nomes das categorias canônicas em celular e tablet', async ({ page }) => {
  const base = '/api/public/cervejarias/qa/pontos-venda/pdv-qa';
  const products = [
    { id: 'drink-special', nome: 'Soda especial', categoria: 'Bebidas especiais', tipo: 'BEBIDA', precoEfetivo: 6 },
    { id: 'drink-basic', nome: 'Água', categoria: 'Bebidas', tipo: 'BEBIDA', precoEfetivo: 3 },
    { id: 'food', nome: 'Pastel', categoria: 'Petiscos', tipo: 'COMIDA', precoEfetivo: 12 },
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === `${base}/info`) return reply({ cervejaria: { nome: 'Cervejaria QA' }, pontoVenda: { nome: 'PDV QA' }, disponivel: true });
    if (path === `${base}/comanda` && request.method() === 'GET') return reply({ error: 'Sem comanda' }, 401);
    if (path === `${base}/cliente-por-telefone`) return reply({ encontrado: false });
    if (path === `${base}/comandas` && request.method() === 'POST') return reply({ reused: false, pontoVenda: { nome: 'PDV QA' }, comanda: { id: 'comanda-qa', numero: 42, cliente: { nome: 'Cliente QA', telefone: '11999999999' }, subtotal: 0, total: 0, desconto: 0, valorEmAberto: 0, pedidos: [] } }, 201);
    if (path === `${base}/cardapio`) return reply({ produtos: products, ordemCategorias: ['Petiscos', 'Bebidas especiais', 'Bebidas'] });
    if (path === `${base}/cardapio/categorias`) return reply({ ordemCategorias: ['Petiscos', 'Bebidas especiais', 'Bebidas'], catalogoCanonico: true });
    if (path === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 404, json: { error: `Mock sem rota para ${path}` } });
  });

  const output = resolve('artifacts/pdv-category-management');
  await mkdir(output, { recursive: true });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.goto('/c/qa/p/pdv-qa');
    await page.getByLabel('Telefone').fill('11999999999');
    await page.getByLabel('Nome').fill('Cliente QA');
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    const categoryHeadings = page.locator('.portal-pdv-category h4');
    await expect(categoryHeadings).toHaveText(['Petiscos', 'Bebidas especiais', 'Bebidas']);
    await expect(page.getByRole('button', { name: /Soda especial/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: resolve(output, `portal-${width}px.png`), fullPage: true });
  }
});
