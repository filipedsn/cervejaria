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
  const statusRequests: Array<{ id: string; status: string; expectedStatus?: string }> = [];
  let holdStatusRequest = false;
  let releaseStatusRequest: (() => void) | null = null;
  let statusFailure: { status: number; error: string; code: string } | null = null;
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
      const request = route.request().postDataJSON() as { status: string; expectedStatus?: string };
      const status = request.status;
      statusRequests.push({ id, status, expectedStatus: request.expectedStatus });
      if (holdStatusRequest) await new Promise<void>((resolveRelease) => { releaseStatusRequest = resolveRelease; });
      if (statusFailure) {
        const failure = statusFailure;
        statusFailure = null;
        await route.fulfill({ status: failure.status, json: { error: failure.error, code: failure.code } });
        return;
      }
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
    statusRequests: () => statusRequests,
    failNextStatusRequest: (failure: { status: number; error: string; code: string }) => { statusFailure = failure; },
    holdNextStatusRequest: () => {
      holdStatusRequest = true;
      return () => {
        holdStatusRequest = false;
        releaseStatusRequest?.();
        releaseStatusRequest = null;
      };
    },
  };
}

async function queueCount(page: Page, count: number) {
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText(`${count} pedidos`);
}

test('mantém cartões na mesma largura e captura scroll em viewports', async ({ page }) => {
  const evidenceDir = resolve(process.cwd(), 'artifacts/kitchen-pagination/regression-after');
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1024, height: 720 });
  await stubKitchen(page, 36);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 36);
  await expect(page.locator('.cozinha-tv-grid > article')).toHaveCount(36);
  const width = await page.locator('.cozinha-tv-grid > article').first().evaluate((card) => Math.round(card.getBoundingClientRect().width));
  expect(width).toBeGreaterThan(100);
  await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = 0; });
  await page.screenshot({ path: resolve(evidenceDir, 'tablet-horizontal-top.png') });
  await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
  await page.screenshot({ path: resolve(evidenceDir, 'tablet-horizontal-bottom.png') });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload();
  await queueCount(page, 36);
  await page.screenshot({ path: resolve(evidenceDir, 'tv-top.png') });
  await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
  await page.screenshot({ path: resolve(evidenceDir, 'tv-bottom.png') });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.reload();
  await queueCount(page, 36);
  await page.screenshot({ path: resolve(evidenceDir, 'tablet-vertical-top.png') });
  await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
  await page.screenshot({ path: resolve(evidenceDir, 'tablet-vertical-bottom.png') });
});

test('distribui um cartão alto e cinco curtos na grade contínua', async ({ page }) => {
  const evidenceDir = resolve(process.cwd(), 'artifacts/kitchen-pagination');
  await mkdir(resolve(evidenceDir, 'masonry-after'), { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubKitchen(page, 6, [3, 1, 1, 1, 1, 1]);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 6);
  await page.screenshot({ path: resolve(evidenceDir, 'masonry-after/page-1.png') });
  const geometry = await page.locator('.cozinha-tv-grid').evaluate((grid) => {
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(':scope > article'));
    return {
      page: grid.parentElement?.querySelector('.cozinha-tv-pager-bar')?.textContent,
      availableWidth: grid.clientWidth,
      gridTop: Math.round(grid.getBoundingClientRect().top),
      display: getComputedStyle(grid).display,
      cards: cards.map((card) => ({
        senha: card.querySelector('.cozinha-tv-card-senha')?.textContent,
        left: Math.round(card.getBoundingClientRect().left - grid.getBoundingClientRect().left),
        top: Math.round(card.getBoundingClientRect().top),
        bottom: Math.round(card.getBoundingClientRect().bottom),
        height: Math.round(card.getBoundingClientRect().height),
        width: Math.round(card.getBoundingClientRect().width),
      })),
    };
  });
  expect(geometry.cards).toHaveLength(6);
  expect(geometry.page).toContain('6 pedidos');
  expect(geometry.display).toBe('grid');
  expect(await page.getByRole('button', { name: 'Anterior' }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Próxima' }).count()).toBe(0);
  expect(geometry.cards.map((card) => card.senha)).toEqual(['Senha 1', 'Senha 2', 'Senha 3', 'Senha 4', 'Senha 5', 'Senha 6']);
  expect(Math.min(...geometry.cards.map((card) => card.top))).toBeGreaterThanOrEqual(geometry.gridTop);
  expect(Math.max(...geometry.cards.map((card) => card.left + card.width))).toBeLessThanOrEqual(geometry.availableWidth + 1);
  for (let index = 0; index < geometry.cards.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < geometry.cards.length; otherIndex += 1) {
      const first = geometry.cards[index]!;
      const second = geometry.cards[otherIndex]!;
      const overlapY = first.top < second.bottom && second.top < first.bottom;
      const overlapX = first.left < second.left + second.width && second.left < first.left + first.width;
      expect(overlapX && overlapY).toBe(false);
    }
  }
});

test('exibe itens e observações do cartão sem cortes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await stubKitchen(page, 12);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 12);
  const firstCard = page.locator('.cozinha-tv-grid > article').first();
  const visibleText = await firstCard.innerText();
  await page.screenshot({ path: resolve(process.cwd(), 'artifacts/kitchen-pagination/regression-after/tablet-horizontal-content.png') });
  expect(visibleText).toContain('Produto do pedido 1, item 2');
  expect(visibleText).toContain('Produto do pedido 1, item 3');
  expect(visibleText).toContain('Observação do pedido: entregar na bancada azul.');
  expect(await firstCard.getByRole('button', { name: /Ver detalhes/ }).count()).toBe(0);
});

test('pedido extenso permanece em um cartão com scroll da grade e mantém Pronto no pedido', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 1, [30]);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 1);
  const card = page.locator('.cozinha-tv-grid > article').first();
  await expect(card.locator('[data-kitchen-item-id]')).toHaveCount(30);
  expect(await page.locator('.cozinha-tv-card-continuation').count()).toBe(0);
  const scrollMetrics = await page.locator('.cozinha-tv-grid').evaluate((grid) => ({
    scrollHeight: grid.scrollHeight,
    clientHeight: grid.clientHeight,
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  await expect(card.getByRole('button', { name: 'Iniciar' })).toBeVisible();
  await card.getByRole('button', { name: 'Iniciar' }).click();
  await expect.poll(() => kitchen.orders()[0]?.status).toBe('EM_PREPARO');
});

test('realtime e reconexão atualizam a fila sem deslocar o scroll nem duplicar pedidos', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 12);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 12);
  const grid = page.locator('.cozinha-tv-grid');
  await grid.evaluate((node) => { node.scrollTop = Math.min(200, node.scrollHeight - node.clientHeight); });
  const scrollBefore = await grid.evaluate((node) => node.scrollTop);
  await expect.poll(() => joinedTenants.has(tenantId)).toBe(true);
  const before = kitchen.orders().map((order) => order.status);
  kitchen.addOrder();
  socketServer.to(socketRoom).emit('operacao:pedido-novo', { source: 'qa-real-socket-emitter' });
  await queueCount(page, 13);
  expect(kitchen.orders().map((order) => order.status)).toEqual(before.concat('RECEBIDO'));
  expect(await grid.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
  await expect.poll(() => page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').count()).toBe(13);
  const joinsBeforeReconnect = roomJoinCount;
  for (const client of socketServer.sockets.sockets.values()) client.conn.close();
  await expect.poll(() => roomJoinCount).toBeGreaterThan(joinsBeforeReconnect);
  kitchen.addOrder();
  socketServer.to(socketRoom).emit('operacao:pedido-novo', { source: 'qa-real-socket-after-reconnect' });
  await queueCount(page, 14);
  await expect.poll(() => page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents()).toEqual(
    Array.from({ length: 14 }, (_, index) => `Senha ${index + 1}`),
  );
  expect(kitchen.orders().map((order) => order.status)).toEqual(before.concat('RECEBIDO', 'RECEBIDO'));
});

test('libera interação interrompida ao ocultar e retoma quando a aba volta', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 2);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 2);
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
  await queueCount(page, 3);
  const visibleOrders = await page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents();
  expect(visibleOrders).toEqual(['Senha 1', 'Senha 2', 'Senha 3']);
  await page.screenshot({ path: resolve(process.cwd(), 'artifacts/kitchen-pagination/regression-after/interaction-resumed.png') });
});

test('duplo toque mantém a ação presa ao ID do pedido e envia um único comando', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 4);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('4 pedidos');
  const release = kitchen.holdNextStatusRequest();
  const target = page.locator('[data-kitchen-order-id="reg-order-001"]');
  const startButton = target.getByRole('button', { name: 'Iniciar' });
  await expect(startButton).toBeVisible();
  await startButton.dispatchEvent('click');
  await startButton.dispatchEvent('click');
  await expect.poll(() => kitchen.statusRequests().length).toBe(1);
  expect(kitchen.statusRequests()[0]).toEqual({ id: 'reg-order-001', status: 'EM_PREPARO', expectedStatus: 'RECEBIDO' });
  await expect(startButton).toBeDisabled();
  kitchen.addOrder();
  socketServer.to(socketRoom).emit('operacao:pedido-novo', { source: 'qa-during-status-request' });
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('4 pedidos');
  expect(kitchen.statusRequests()).toHaveLength(1);
  expect(await page.locator('[data-kitchen-order-id="reg-order-001"]').count()).toBeGreaterThan(0);
  release();
  await expect.poll(() => kitchen.orders()[0]?.status).toBe('EM_PREPARO');
  await expect(page.locator('.cozinha-tv-grid > article[data-kitchen-order-id="reg-order-001"] .cozinha-tv-card-badge')).toHaveText('Preparando');
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('5 pedidos', { timeout: 5_000 });
});

test('conflito real sincroniza o pedido, libera os controles e permanece associado ao cartão', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  const kitchen = await stubKitchen(page, 2);
  await page.goto('/operacao/cozinha/tv');
  const target = page.locator('.cozinha-tv-grid > article[data-kitchen-order-id="reg-order-001"]');
  const startButton = target.getByRole('button', { name: 'Iniciar' });
  kitchen.failNextStatusRequest({ status: 409, error: 'Pedido atualizado de PRONTO para EM_PREPARO; a fila foi sincronizada.', code: 'KITCHEN_ORDER_TRANSITION_INVALID' });
  await startButton.click();
  await expect(page.getByRole('alert')).toContainText('Falha no pedido 1');
  await expect(startButton).toBeEnabled();
  expect(kitchen.statusRequests()).toHaveLength(1);
  expect(kitchen.orders()[0]?.status).toBe('RECEBIDO');
  await expect(target.locator('.cozinha-tv-card-badge')).toHaveText('Na fila');
});
