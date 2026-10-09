import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server as HttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type KitchenItem = {
  id: string;
  nome: string;
  quantidade: number;
  observacao: string | null;
  opcionais: Array<{ id: string; nome: string; precoAdicional: number; quantidade: number }>;
  cancelamentoPendente: boolean;
  paraViagem: boolean;
};
type KitchenOrder = {
  id: string;
  numero: number;
  status: string;
  createdAt: string;
  statusDesde: string;
  entregueEm: string | null;
  observacao: string | null;
  comanda: { id: string; tipo: string; identificador: string; numero: number; cliente: null };
  itens: KitchenItem[];
};

const tenantId = 'tenant-kitchen-regression-qa';
const socketPort = 3003;
const socketRoom = `cervejaria:${tenantId}`;
const requireFromRepo = createRequire(resolve(process.cwd(), 'package.json'));
const { Server: SocketIOServer } = requireFromRepo(resolve(process.cwd(), 'backend/node_modules/socket.io')) as {
  Server: new (server: HttpServer, options: Record<string, unknown>) => {
    on(event: string, callback: (socket: { on(event: string, callback: (value: string) => void): void; join(room: string): void }) => void): void;
    to(room: string): { emit(event: string, payload: unknown): void };
    sockets: { sockets: Map<string, { conn: { close(): void } }> };
    close(callback: () => void): void;
  };
};

const httpServer = createServer();
const socketServer = new SocketIOServer(httpServer, {
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
});
const joinedTenants = new Set<string>();
let roomJoinCount = 0;

test.beforeAll(async () => {
  socketServer.on('connection', (socket) => {
    socket.on('join:cervejaria', (id) => {
      if (id !== tenantId) return;
      joinedTenants.add(id);
      roomJoinCount += 1;
      void socket.join(socketRoom);
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(socketPort, '127.0.0.1', resolveListen);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => socketServer.close(resolveClose));
  joinedTenants.clear();
});

function fixtures(count: number, itemCounts: number[] = []): KitchenOrder[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `reg-order-${String(index + 1).padStart(3, '0')}`,
    numero: index + 1,
    status: 'RECEBIDO',
    createdAt: new Date(Date.UTC(2026, 9, 9, 12, 0, index)).toISOString(),
    statusDesde: new Date(Date.UTC(2026, 9, 9, 12, 0, index)).toISOString(),
    entregueEm: null,
    observacao: index === 0 ? 'Observação do pedido: entregar na bancada azul.' : null,
    comanda: { id: `reg-command-${index + 1}`, tipo: 'MESA', identificador: `Mesa ${index + 1}`, numero: index + 1, cliente: null },
    itens: Array.from({ length: itemCounts[index] ?? 3 }, (_, itemIndex) => ({
      id: `reg-item-${index + 1}-${itemIndex + 1}`,
      nome: `Produto do pedido ${index + 1}, item ${itemIndex + 1}`,
      quantidade: itemIndex + 1,
      observacao: `Observação do item ${itemIndex + 1}: sem pimenta, molho à parte.`,
      opcionais: [{ id: `reg-option-${index + 1}-${itemIndex + 1}`, nome: `Complemento ${itemIndex + 1}`, precoAdicional: 0, quantidade: 1 }],
      cancelamentoPendente: false,
      paraViagem: itemIndex === 1,
    })),
  }));
}

async function stubKitchen(page: Page, count: number, itemCounts: number[] = []) {
  let orders = fixtures(count, itemCounts);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'user-kitchen-qa', nome: 'QA', email: 'qa@example.test', papel: 'DONO', permissoesOperacao: [] }, cervejaria: { id: tenantId, nome: 'Cozinha QA' } } });
    } else if (url.pathname.endsWith('/api/operacao/contexto')) {
      await route.fulfill({ json: { ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true, tapsEnabled: false, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: true, controlaEstoque: false, temCozinha: true, usaCardapio: true, quantidadeMesas: 20, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'pdv-kitchen-qa', nome: 'QA', ativo: true }] } });
    } else if (url.pathname.endsWith('/api/onboarding/readiness')) {
      await route.fulfill({ json: { mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } } } });
    } else if (url.pathname.endsWith('/api/cervejaria/configuracao-operacional')) {
      await route.fulfill({ json: { configurationSource: 'CANONICAL_PDV', enablements: { plannedOperations: false, cashRegister: true, cashMode: true, taps: false, inventory: false, kitchen: true }, configuration: { setupCompletedAt: '2026-10-09T00:00:00.000Z', plannedOperationsEnabled: false, tapsEnabled: false, inventoryEnabled: false, kitchenEnabled: true, kitchenItemsChargeAtLaunch: false, allowCloseComandaWithPendingKitchenOrders: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false } } });
    } else if (url.pathname.endsWith('/api/operacao/cozinha')) {
      await route.fulfill({ json: orders });
    } else if (url.pathname.includes('/api/operacao/cozinha/') && url.pathname.endsWith('/status')) {
      const id = url.pathname.split('/').at(-2)!;
      const status = (route.request().postDataJSON() as { status: string }).status;
      orders = orders.map((order) => order.id === id ? { ...order, status, entregueEm: status === 'ENTREGUE' ? new Date().toISOString() : order.entregueEm } : order);
      await route.fulfill({ json: orders.find((order) => order.id === id) ?? { id, status } });
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  return {
    setCount: (count: number) => { orders = fixtures(count); },
    addOrder: () => { orders = [...orders, fixtures(orders.length + 1).at(-1)!]; },
    orders: () => orders,
  };
}

test('mantém cartões na mesma largura nas páginas e captura as três páginas', async ({ page }) => {
  const evidenceDir = resolve(process.cwd(), 'artifacts/kitchen-pagination/regression-after');
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 72);
  await page.goto('/operacao/cozinha/tv');
  const label = page.getByText(/Página 1 de \d+ · 72 pedidos/);
  await expect(label).toBeVisible();
  const capacity = await page.locator('.cozinha-tv-grid > article').count();
  expect(capacity).toBeGreaterThan(1);
  kitchen.setCount(capacity * 2 + 1);
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 2 + 1} pedidos`))).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, 'tablet-horizontal-page-1.png') });
  const dimensions: Array<{ width: number; tracks: number }> = [];
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    dimensions.push(await page.locator('.cozinha-tv-grid').evaluate((grid) => ({
      width: Math.round((grid.querySelector('article') as HTMLElement).getBoundingClientRect().width),
      tracks: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
    })));
    if (pageIndex < 2) {
      await page.getByRole('button', { name: 'Próxima' }).click();
      await expect(page.getByText(new RegExp(`Página ${pageIndex + 2} de 3 · ${capacity * 2 + 1} pedidos`))).toBeVisible();
      await page.screenshot({ path: resolve(evidenceDir, `tablet-horizontal-page-${pageIndex + 2}.png`) });
    }
  }
  expect(dimensions[0]).toEqual(dimensions[1]);
  expect(dimensions[1]).toEqual(dimensions[2]);
  expect(await page.locator('.cozinha-tv-grid > article').count()).toBe(1);

  await page.setViewportSize({ width: 1920, height: 1080 });
  kitchen.setCount(72);
  await page.reload();
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const tvCapacity = await page.locator('.cozinha-tv-grid > article').count();
  kitchen.setCount(tvCapacity * 2 + 1);
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${tvCapacity * 2 + 1} pedidos`))).toBeVisible();
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    await page.screenshot({ path: resolve(evidenceDir, `tv-page-${pageIndex + 1}.png`) });
    if (pageIndex < 2) {
      await page.getByRole('button', { name: 'Próxima' }).click();
      await expect(page.getByText(new RegExp(`Página ${pageIndex + 2} de 3 · ${tvCapacity * 2 + 1} pedidos`))).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 820, height: 1180 });
  kitchen.setCount(72);
  await page.reload();
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const portraitCapacity = await page.locator('.cozinha-tv-grid > article').count();
  kitchen.setCount(portraitCapacity * 2 + 1);
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${portraitCapacity * 2 + 1} pedidos`))).toBeVisible();
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    await page.screenshot({ path: resolve(evidenceDir, `tablet-vertical-page-${pageIndex + 1}.png`) });
    if (pageIndex < 2) {
      await page.getByRole('button', { name: 'Próxima' }).click();
      await expect(page.getByText(new RegExp(`Página ${pageIndex + 2} de 3 · ${portraitCapacity * 2 + 1} pedidos`))).toBeVisible();
    }
  }
});

test('exibe itens e observações do cartão sem cortes nem rolagem interna', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await stubKitchen(page, 72);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const firstCard = page.locator('.cozinha-tv-grid > article').first();
  const visibleText = await firstCard.innerText();
  const geometry = await page.locator('.cozinha-tv-grid').evaluate((grid) => {
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(':scope > article'));
    const rows = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)));
    const usedHeight = Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)) - grid.getBoundingClientRect().top;
    return { rows: rows.size, usedHeight, availableHeight: grid.clientHeight };
  });
  console.log('post-fix geometry', geometry);
  await page.screenshot({ path: resolve(process.cwd(), 'artifacts/kitchen-pagination/regression-after/tablet-horizontal-content.png') });
  expect(visibleText).toContain('Produto do pedido 1, item 2');
  expect(visibleText).toContain('Produto do pedido 1, item 3');
  expect(visibleText).toContain('Observação do pedido: entregar na bancada azul.');
  expect(await firstCard.getByRole('button', { name: /Ver detalhes/ }).count()).toBe(0);
  expect(geometry.usedHeight).toBeLessThanOrEqual(geometry.availableHeight);
  expect(await firstCard.evaluate((card) => card.scrollHeight <= card.clientHeight + 1)).toBe(true);
  expect(await firstCard.evaluate((card) => card.getBoundingClientRect().bottom <= card.parentElement!.getBoundingClientRect().bottom + 1)).toBe(true);
});

test('pedido extenso oferece continuações paginadas e mantém Pronto no pedido inteiro', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 1, [30]);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText(/Página 1 de \d+ · 1 pedidos/)).toBeVisible();
  const partLabels = new Set<string>();
  const itemIds = new Set<string>();
  for (let part = 0; part < 20; part += 1) {
    const current = page.locator('.cozinha-tv-grid > article');
    for (const label of await current.locator('.cozinha-tv-card-continuation').allTextContents()) partLabels.add(label);
    for (const id of await current.locator('[data-kitchen-item-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-kitchen-item-id')!))) itemIds.add(id);
    for (const card of await current.all()) {
      const dimensions = await card.evaluate((node) => ({ client: node.clientHeight, scroll: node.scrollHeight, bottom: node.getBoundingClientRect().bottom, pageBottom: node.parentElement!.getBoundingClientRect().bottom }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.pageBottom + 1);
    }
    if (await page.getByRole('button', { name: 'Próxima' }).isDisabled()) break;
    await page.getByRole('button', { name: 'Próxima' }).click();
  }
  expect(itemIds.size).toBe(30);
  expect(partLabels.size).toBeGreaterThan(1);
  expect([...partLabels][0]).toContain('parte');
  const lastFragment = page.locator('.cozinha-tv-grid > article').last();
  await expect(lastFragment.getByRole('button', { name: 'Iniciar' })).toBeVisible();
  await lastFragment.getByRole('button', { name: 'Iniciar' }).click();
  await expect.poll(() => kitchen.orders()[0]?.status).toBe('EM_PREPARO');
});

test('pedido novo chega por cliente Socket.IO real sem alterar status', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 2);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText('Página 1 de 1 · 2 pedidos')).toBeVisible();
  await expect.poll(() => joinedTenants.has(tenantId)).toBe(true);
  const before = kitchen.orders().map((order) => order.status);
  kitchen.addOrder();
  socketServer.to(socketRoom).emit('operacao:pedido-novo', { source: 'qa-real-socket-emitter' });
  await expect(page.getByText('Página 1 de 1 · 3 pedidos')).toBeVisible({ timeout: 5_000 });
  expect(kitchen.orders().map((order) => order.status)).toEqual(before.concat('RECEBIDO'));
  expect(await page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents()).toEqual(['Senha 1', 'Senha 2', 'Senha 3']);
  const joinsBeforeReconnect = roomJoinCount;
  for (const client of socketServer.sockets.sockets.values()) client.conn.close();
  await expect.poll(() => roomJoinCount).toBeGreaterThan(joinsBeforeReconnect);
  kitchen.addOrder();
  socketServer.to(socketRoom).emit('operacao:pedido-novo', { source: 'qa-real-socket-after-reconnect' });
  await expect(page.getByText('Página 1 de 2 · 4 pedidos')).toBeVisible({ timeout: 5_000 });
  expect(await page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents()).toEqual(['Senha 1', 'Senha 2', 'Senha 3']);
  await page.getByRole('button', { name: 'Próxima' }).click();
  expect(await page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents()).toEqual(['Senha 4']);
  expect(kitchen.orders().map((order) => order.status)).toEqual(before.concat('RECEBIDO', 'RECEBIDO'));
});

test('libera interação interrompida ao ocultar e retoma quando a aba volta', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 2);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText('Página 1 de 1 · 2 pedidos')).toBeVisible();
  await page.locator('.cozinha-tv-pager').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
  kitchen.addOrder();
  socketServer.to(socketRoom).emit('operacao:pedido-novo', { source: 'qa-while-hidden' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('Página 1 de 1 · 3 pedidos')).toBeVisible({ timeout: 5_000 });
  const visibleOrders = await page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents();
  expect(visibleOrders).toEqual(['Senha 1', 'Senha 2', 'Senha 3']);
  await page.screenshot({ path: resolve(process.cwd(), 'artifacts/kitchen-pagination/regression-after/interaction-resumed.png') });
});
