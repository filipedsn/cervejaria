import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type KitchenItem = { id: string; nome: string; quantidade: number; observacao: string | null; opcionais: Array<{ id: string; nome: string; precoAdicional: number; quantidade: number }>; cancelamentoPendente: boolean; paraViagem: boolean };
type KitchenOrder = { id: string; numero: number; status: string; createdAt: string; statusDesde: string; entregueEm: string | null; observacao: string | null; comanda: { id: string; tipo: string; identificador: string; numero: number; cliente: null }; itens: KitchenItem[] };

function fixtures(count: number): KitchenOrder[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `kitchen-${String(index + 1).padStart(3, '0')}`,
    numero: index + 1,
    status: 'RECEBIDO',
    createdAt: new Date(Date.UTC(2026, 9, 8, 12, 0, index)).toISOString(),
    statusDesde: new Date(Date.UTC(2026, 9, 8, 12, 0, index)).toISOString(),
    entregueEm: null,
    observacao: 'Pedido de teste com observação completa.',
    comanda: { id: `command-${index + 1}`, tipo: 'MESA', identificador: `Mesa ${index + 1}`, numero: index + 1, cliente: null },
    itens: [1, 2, 3].map((part) => ({ id: `item-${index + 1}-${part}`, nome: `Hambúrguer da casa ${index + 1} · item ${part}`, quantidade: 1, observacao: 'Sem cebola. Molho à parte.', opcionais: [{ id: `option-${index + 1}-${part}`, nome: 'Queijo', precoAdicional: 2, quantidade: 1 }], cancelamentoPendente: false, paraViagem: false })),
  }));
}

async function stubKitchen(page: Page, count: number, options: { socket?: boolean } = {}) {
  let orders = fixtures(count);
  let addAfterNextStatus = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'user-test', nome: 'QA', email: 'qa@example.test', papel: 'DONO', permissoesOperacao: [] }, cervejaria: { id: 'tenant-test', nome: 'Cozinha QA' } } });
    } else if (url.pathname.endsWith('/api/operacao/contexto')) {
      await route.fulfill({ json: { ativo: true, operationMode: 'CAIXA', plannedOperationsEnabled: false, cashRegisterEnabled: true, tapsEnabled: false, operationalSettingsSource: 'CANONICAL_PDV', inventoryEnabled: false, kitchenEnabled: true, controlaEstoque: false, temCozinha: true, usaCardapio: true, quantidadeMesas: 20, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [{ id: 'pdv-test', nome: 'QA', ativo: true }] } });
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
      if (addAfterNextStatus) {
        addAfterNextStatus = false;
        await new Promise((resolve) => setTimeout(resolve, 900));
        orders.push(fixtures(orders.length + 1).at(-1)!);
      }
      await route.fulfill({ json: orders.find((order) => order.id === id) ?? { id, status } });
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  if (options.socket !== false) await page.route('**/socket.io/**', (route) => route.abort());
  return {
    setCount: (nextCount: number) => { orders = fixtures(nextCount); },
    addOnNextStatus: () => { addAfterNextStatus = true; },
  };
}

async function queueCount(page: Page, count: number) {
  await expect(page.getByRole('navigation', { name: 'Fila da cozinha' })).toBeVisible();
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText(`${count} pedidos`);
}

test('TV e tablets mostram a fila completa com scroll vertical e detalhes acessíveis', async ({ page }) => {
  const evidenceDir = resolve(process.cwd(), 'artifacts', 'kitchen-pagination');
  await mkdir(evidenceDir, { recursive: true });
  const cases = [
    { name: 'tablet-horizontal', width: 1180, height: 820 },
    { name: 'tablet-vertical', width: 820, height: 1180 },
    { name: 'tv', width: 1920, height: 1080 },
  ];
  for (const scenario of cases) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.unrouteAll();
    await stubKitchen(page, 72);
    await page.goto('/operacao/cozinha/tv');
    await queueCount(page, 72);
    await expect(page.locator('.cozinha-tv-grid > article')).toHaveCount(72);
    const scrollMetrics = await page.locator('.cozinha-tv-grid').evaluate((grid) => ({
      scrollHeight: grid.scrollHeight,
      clientHeight: grid.clientHeight,
      overflowY: getComputedStyle(grid).overflowY,
    }));
    expect(scrollMetrics.overflowY).toMatch(/auto|scroll/);
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    const pageScroll = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, innerWidth: innerWidth, innerHeight: innerHeight }));
    expect(pageScroll.width).toBeLessThanOrEqual(pageScroll.innerWidth);
    expect(pageScroll.height).toBeLessThanOrEqual(pageScroll.innerHeight);
    await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = 0; });
    await page.screenshot({ path: resolve(evidenceDir, `kitchen-${scenario.name}-top.png`), fullPage: true });
    await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
    await page.screenshot({ path: resolve(evidenceDir, `kitchen-${scenario.name}-bottom.png`), fullPage: true });
    const firstCard = page.locator('.cozinha-tv-grid > article').first();
    await firstCard.scrollIntoViewIfNeeded();
    const text = await firstCard.innerText();
    expect(text).toContain('Hambúrguer da casa 1 · item 1');
    expect(text).toContain('Hambúrguer da casa 1 · item 2');
    expect(text).toContain('Hambúrguer da casa 1 · item 3');
    expect(text).toContain('Sem cebola. Molho à parte.');
    expect(text).toContain('Pedido de teste com observação completa.');
    await page.goto('about:blank');
  }
});

test('TV e modo operacional permanecem manuais mesmo com intervalo antigo salvo', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await stubKitchen(page, 36);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 36);
  const deviceId = await page.evaluate(() => localStorage.getItem('qt:cozinha:device-id'));
  await page.evaluate(({ deviceId, tenantId, userId }) => localStorage.setItem(`qt:cozinha:visual:${tenantId}:${userId}:${deviceId}`, JSON.stringify({ profile: 'automatico', intervalMs: 5_000 })), { deviceId, tenantId: 'tenant-test', userId: 'user-test' });
  await page.reload();
  await queueCount(page, 36);
  const migratedPreference = await page.evaluate(({ deviceId, tenantId, userId }) => localStorage.getItem(`qt:cozinha:visual:${tenantId}:${userId}:${deviceId}`), { deviceId, tenantId: 'tenant-test', userId: 'user-test' });
  expect(JSON.parse(migratedPreference ?? '{}')).toEqual({ profile: 'automatico' });
  await page.locator('.cozinha-tv-grid').evaluate((grid) => { grid.scrollTop = Math.min(240, Math.max(0, grid.scrollHeight - grid.clientHeight)); });
  const scrolled = await page.locator('.cozinha-tv-grid').evaluate((grid) => grid.scrollTop);
  await page.waitForTimeout(5_500);
  expect(await page.locator('.cozinha-tv-grid').evaluate((grid) => grid.scrollTop)).toBe(scrolled);
  expect(await page.getByRole('button', { name: 'Próxima' }).count()).toBe(0);
  await page.goto('/operacao/cozinha');
  await expect(page.locator('.cozinha-tv-pager-bar')).toContainText('pedidos');
  await page.waitForTimeout(5_500);
  expect(await page.getByRole('button', { name: 'Próxima' }).count()).toBe(0);
});

test('ao entregar um pedido, a contagem cai e o cartão some da fila', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await stubKitchen(page, 12);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 12);
  const firstCard = page.locator('.cozinha-tv-grid > article').first();
  await firstCard.getByRole('button', { name: 'Iniciar' }).click();
  await firstCard.getByRole('button', { name: 'Pronto' }).click();
  await firstCard.getByRole('button', { name: 'Entregue' }).click();
  await queueCount(page, 11);
  await expect(page.locator('.cozinha-tv-grid > article')).toHaveCount(11);
  await expect.poll(() => page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents()).toEqual(Array.from({ length: 11 }, (_, index) => `Senha ${index + 2}`));
});

test('pedido recebido durante uma ação fica no fim e não desloca o scroll do cartão em uso', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const kitchen = await stubKitchen(page, 12);
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 12);
  const grid = page.locator('.cozinha-tv-grid');
  await grid.evaluate((node) => { node.scrollTop = 0; });
  const card = page.locator('.cozinha-tv-grid > article').first();
  kitchen.addOnNextStatus();
  await card.getByRole('button', { name: 'Iniciar' }).click();
  await expect(page.locator('.cozinha-tv-grid > article').first()).toContainText('Senha 1');
  await queueCount(page, 13);
  expect(await grid.evaluate((node) => node.scrollTop)).toBeLessThan(40);
});

test('reconexão realtime atualiza a lista sem duplicar pedidos', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const kitchen = await stubKitchen(page, 2, { socket: false });
  let connectionCount = 0;
  const connections: Array<import('@playwright/test').WebSocketRoute> = [];
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const connection = connectionCount++;
    connections.push(socket);
    socket.send(`0${JSON.stringify({ sid: `qa-${connection}`, upgrades: [], pingInterval: 25_000, pingTimeout: 20_000, maxPayload: 1_000_000 })}`);
    socket.onMessage((message) => {
      const frame = String(message);
      if (frame === '40') {
        socket.send(`40${JSON.stringify({ sid: `namespace-${connection}` })}`);
        if (connection > 0) {
          socket.send('42["operacao:pedido-novo",{}]');
        }
      }
    });
  });
  await page.goto('/operacao/cozinha/tv');
  await queueCount(page, 2);
  await expect.poll(() => connectionCount).toBeGreaterThan(0);
  kitchen.setCount(3);
  await connections[connectionCount - 1]!.close({ code: 1000, reason: 'qa reconnect' });
  await queueCount(page, 3);
  expect(connectionCount).toBeGreaterThanOrEqual(2);
  const orderNumbers = await page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents();
  expect(orderNumbers).toEqual(['Senha 1', 'Senha 2', 'Senha 3']);
});

test('o painel salva apenas o perfil visual por tenant, usuário e dispositivo', async ({ page }) => {
  await stubKitchen(page, 1);
  await page.goto('/operacao/configuracoes/pdv');
  await page.locator('details').filter({ has: page.getByText('Cozinha', { exact: true }) }).locator('summary').click();
  const profile = page.getByLabel('Perfil padrão neste dispositivo');
  await expect(profile).toBeVisible();
  await expect(page.getByText('Troca automática no modo TV')).toHaveCount(0);
  await profile.selectOption('ampliada');
  const saved = await page.evaluate(() => {
    const device = localStorage.getItem('qt:cozinha:device-id');
    return { device, value: device ? localStorage.getItem(`qt:cozinha:visual:tenant-test:user-test:${device}`) : null };
  });
  expect(saved.device).toBeTruthy();
  expect(JSON.parse(saved.value ?? '{}')).toEqual({ profile: 'ampliada' });
  expect(await page.evaluate(() => localStorage.getItem(`qt:cozinha:visual:tenant-test:user-other:${localStorage.getItem('qt:cozinha:device-id')}`))).toBeNull();
});
