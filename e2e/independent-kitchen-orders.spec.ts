import { expect, test, type Page } from '@playwright/test';

const product = {
  id: 'ui-independent-product', nome: 'Churrasquinho UI', categoria: 'Porções', precoUnit: '10.00',
  tipo: 'COMIDA' as const, formato: 'OUTRO' as const, precos: [{ volumeMl: 1, preco: 10 }],
  exigePreparo: true, prepararEmPedidoSeparado: true, controlaEstoque: false, ativo: true, ordem: 1, gruposOpcionais: [],
};

function orders(statusMarked: 'RECEBIDO' | 'ENTREGUE' = 'RECEBIDO') {
  return [
    { id: 'ui-order-marked', numero: 41, status: statusMarked, paraViagem: true, observacao: null, createdAt: '2026-10-07T18:00:00.000Z', statusDesde: '2026-10-07T18:00:00.000Z', entregueEm: statusMarked === 'ENTREGUE' ? '2026-10-07T18:10:00.000Z' : null,
      comanda: { id: 'ui-command-independent', tipo: 'APELIDO', identificador: 'Mesa UI', numero: 11, cliente: null },
      itens: [{ id: 'ui-line-marked', produtoId: product.id, nome: product.nome, quantidade: 3, precoUnit: 10, subtotal: 30, exigePreparo: true, paraViagem: true, observacao: 'Molho separado', opcionais: [{ id: 'ui-extra', nome: 'Molho', precoAdicional: 1, quantidade: 1 }] }] },
    { id: 'ui-order-common', numero: 42, status: 'RECEBIDO', paraViagem: false, observacao: null, createdAt: '2026-10-07T18:01:00.000Z', statusDesde: '2026-10-07T18:01:00.000Z', entregueEm: null,
      comanda: { id: 'ui-command-independent', tipo: 'APELIDO', identificador: 'Mesa UI', numero: 11, cliente: null },
      itens: [{ id: 'ui-line-common', produtoId: 'ui-common-product', nome: 'Batata UI', quantidade: 1, precoUnit: 10, subtotal: 10, exigePreparo: true, paraViagem: false, observacao: 'Sem sal', opcionais: [] }] },
  ];
}

async function mockOwnerAndBlockUnexpectedApis(page: Page) {
  const allowed = new Set<string>();
  const register = (method: string, path: string) => allowed.add(`${method} ${path}`);
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`;
    if (!allowed.has(key) && ![...allowed].some((entry) => entry === `${request.method()} ${new URL(request.url()).pathname}`)) unexpected.push(key);
    await route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  register('GET', '/api/auth/me');
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: {
    usuario: { id: 'ui-owner', nome: 'QA Cozinha', email: 'kitchen-ui@example.invalid', papel: 'DONO' },
    cervejaria: { id: 'ui-tenant', nome: 'Cervejaria UI', slug: 'qa-kitchen-ui' },
  } }));
  register('GET', '/api/onboarding/readiness');
  await page.route('**/api/onboarding/readiness', (route) => route.fulfill({ json: {
    mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true,
    firstSaleCompleted: true, operationReady: true, canConfigure: false,
    modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
  } }));
  register('GET', '/api/operacao/contexto');
  await page.route('**/api/operacao/contexto', (route) => route.fulfill({ json: {
    ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true,
    tapsEnabled: false, operationalSettingsSource: 'LEGACY', inventoryEnabled: false, kitchenEnabled: true,
    controlaEstoque: false, temCozinha: true, usaCardapio: false, quantidadeMesas: 0,
    whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false,
    pontosVenda: [{ id: 'ui-pdv-independent', nome: 'Balcão', ativo: true }],
  } }));
  register('GET', '/api/trailers?ativo=true');
  await page.route('**/api/trailers?ativo=true', (route) => route.fulfill({ json: [] }));
  register('GET', '/api/eventos/ativos');
  await page.route('**/api/eventos/ativos', (route) => route.fulfill({ json: [] }));
  register('GET', '/api/cervejaria/configuracao-operacional');
  await page.route('**/api/cervejaria/configuracao-operacional', (route) => route.fulfill({ json: { configuration: { setupCompletedAt: '2026-10-07T12:00:00.000Z', allowCloseComandaWithPendingKitchenOrders: false } } }));
  register('POST', '/api/audit/events');
  await page.route('**/api/audit/events', (route) => route.fulfill({ status: 204, body: '' }));
  register('GET', '/api/operacao/produtos?pontoVendaId=ui-pdv-independent');
  await page.route('**/api/operacao/produtos?pontoVendaId=ui-pdv-independent', (route) => route.fulfill({ json: [product] }));
  return { register, unexpected };
}

test('edita produto marcado e mantém pedidos irmãos visíveis após entregar apenas um', async ({ page }) => {
  test.setTimeout(90_000);
  await page.context().grantPermissions([]);
  const { register, unexpected } = await mockOwnerAndBlockUnexpectedApis(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  let storedProduct = { ...product };
  register('GET', '/api/operacao/produtos?incluirInativos=true');
  await page.route('**/api/operacao/produtos?incluirInativos=true', (route) => route.fulfill({ json: [storedProduct] }));
  register('PUT', '/api/operacao/produtos/ui-independent-product');
  const productWrites: Array<Record<string, unknown>> = [];
  await page.route('**/api/operacao/produtos/ui-independent-product', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    productWrites.push(body);
    storedProduct = { ...storedProduct, ...body } as typeof product;
    await route.fulfill({ json: storedProduct });
  });

  await page.goto('/operacao/catalogo');
  await expect.poll(() => unexpected.length).toBe(0);
  expect(pageErrors).toEqual([]);
  const productCard = page.locator('.card-touch').filter({ hasText: product.nome });
  await productCard.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByRole('heading', { name: /Editar/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Vai para a cozinha/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Preparar em pedido separado/ })).toBeChecked();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => productWrites.length).toBe(1);
  expect(productWrites[0]?.prepararEmPedidoSeparado).toBe(true);

  const detailOrders = orders('ENTREGUE').map((order) => ({ ...order, status: order.id === 'ui-order-marked' ? 'ENTREGUE' : 'RECEBIDO' }));
  const comanda = {
    id: 'ui-command-independent', tipo: 'APELIDO', identificador: 'Mesa UI', numero: 11, status: 'ABERTA',
    pontoVendaId: 'ui-pdv-independent', createdAt: '2026-10-07T18:00:00.000Z', fechadaEm: null,
    subtotal: 40, desconto: 0, total: 40, valorEmAberto: 40, cliente: null, pedidos: detailOrders, pagamentos: [],
  };
  register('GET', '/api/operacao/comandas/ui-command-independent');
  await page.route('**/api/operacao/comandas/ui-command-independent', (route) => route.fulfill({ json: comanda }));
  register('GET', '/api/operacao/caixa?pontoVendaId=ui-pdv-independent');
  await page.route('**/api/operacao/caixa?pontoVendaId=ui-pdv-independent', (route) => route.fulfill({ json: { sessao: { id: 'ui-session', status: 'ABERTO' }, comandasAbertas: 1, diaOperacional: '2026-10-07' } }));
  register('GET', '/api/operacao/cozinha?incluirEntregues=true');
  let kitchenOrders = orders();
  await page.route('**/api/operacao/cozinha?incluirEntregues=true', (route) => route.fulfill({ json: kitchenOrders }));
  register('PATCH', '/api/operacao/cozinha/ui-order-marked/status');
  const statusWrites: string[] = [];
  await page.route('**/api/operacao/cozinha/ui-order-marked/status', async (route) => {
    const body = route.request().postDataJSON() as { status: 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' };
    statusWrites.push(body.status);
    kitchenOrders = kitchenOrders.map((order) => order.id === 'ui-order-marked' ? { ...order, status: body.status, statusDesde: '2026-10-07T18:10:00.000Z', entregueEm: body.status === 'ENTREGUE' ? '2026-10-07T18:10:00.000Z' : null } : order);
    await route.fulfill({ json: kitchenOrders.find((order) => order.id === 'ui-order-marked') });
  });

  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText('Senha 41')).toBeVisible();
  await expect(page.getByText('Senha 42')).toBeVisible();
  const markedCard = page.locator('article').filter({ hasText: 'Senha 41' });
  await markedCard.getByRole('button', { name: 'Iniciar' }).click();
  await markedCard.getByRole('button', { name: 'Pronto' }).click();
  await markedCard.getByRole('button', { name: 'Entregue' }).click();
  await expect.poll(() => statusWrites).toEqual(['EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  await expect(page.locator('article').filter({ hasText: 'Senha 42' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Senha 41' })).toHaveCount(0);

  await page.goto('/operacao/comandas/ui-command-independent');
  await expect(page.getByRole('button', { name: 'Pedidos (2)' })).toBeVisible();
  const deliveredOrder = page.locator('section.card').filter({ hasText: 'Senha 41' });
  const pendingOrder = page.locator('section.card').filter({ hasText: 'Senha 42' });
  await expect(deliveredOrder).toContainText('Entregue');
  await expect(pendingOrder).toContainText(/Recebido|Na fila|Na cozinha|Pendente/);
  await expect(deliveredOrder.getByText(product.nome, { exact: true })).toBeVisible();
  await expect(pendingOrder.getByText('Batata UI', { exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});
