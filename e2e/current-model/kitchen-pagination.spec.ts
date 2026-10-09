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

test('TV e tablets paginam por espaço medido, mostram 3 páginas e deixam todos os detalhes acessíveis', async ({ page }) => {
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
    const kitchen = await stubKitchen(page, 72);
    await page.goto('/operacao/cozinha/tv');
    await expect(page.getByRole('navigation', { name: 'Paginação dos pedidos' })).toBeVisible();
    await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible({ timeout: 10_000 });
    const pageCapacity = await page.locator('.cozinha-tv-grid > article').count();
    expect(pageCapacity).toBeGreaterThan(0);
    const count = pageCapacity * 3;
    kitchen.setCount(count);
    await page.reload();
    await expect(page.getByText(new RegExp(`Página 1 de 3 · ${count} pedidos`))).toBeVisible({ timeout: 10_000 });
    const scroll = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, innerWidth: innerWidth, innerHeight: innerHeight }));
    expect(scroll.width).toBeLessThanOrEqual(scroll.innerWidth);
    expect(scroll.height).toBeLessThanOrEqual(scroll.innerHeight);
    await page.screenshot({ path: resolve(evidenceDir, `kitchen-${scenario.name}-page-1.png`), fullPage: true });
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByText(new RegExp(`Página 2 de 3 · ${count} pedidos`))).toBeVisible();
    await page.screenshot({ path: resolve(evidenceDir, `kitchen-${scenario.name}-page-2.png`), fullPage: true });
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByText(new RegExp(`Página 3 de 3 · ${count} pedidos`))).toBeVisible();
    await page.screenshot({ path: resolve(evidenceDir, `kitchen-${scenario.name}-page-3.png`), fullPage: true });
    await page.getByRole('button', { name: 'Anterior' }).click();
    await page.getByRole('button', { name: 'Anterior' }).click();
    const seenItems = new Set<string>();
    for (let detailPage = 0; detailPage < 12; detailPage += 1) {
      for (const text of await page.locator('.cozinha-tv-grid > article').allTextContents()) seenItems.add(text);
      if (await page.getByRole('button', { name: 'Próxima' }).isDisabled()) break;
      await page.getByRole('button', { name: 'Próxima' }).click();
    }
    expect([...seenItems].join(' ')).toContain(`Hambúrguer da casa 1 · item 1`);
    expect([...seenItems].join(' ')).toContain(`Hambúrguer da casa 1 · item 2`);
    expect([...seenItems].join(' ')).toContain(`Hambúrguer da casa 1 · item 3`);
    expect([...seenItems].join(' ')).toContain('Sem cebola. Molho à parte.');
    expect([...seenItems].join(' ')).toContain('Pedido de teste com observação completa.');
    await page.goto('about:blank');
  }
});

test('TV e modo operacional permanecem manuais mesmo com intervalo antigo salvo', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const kitchen = await stubKitchen(page, 72);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const capacity = await page.locator('.cozinha-tv-grid > article').count();
  kitchen.setCount(capacity * 3);
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  const deviceId = await page.evaluate(() => localStorage.getItem('qt:cozinha:device-id'));
  await page.evaluate(({ deviceId, tenantId, userId }) => localStorage.setItem(`qt:cozinha:visual:${tenantId}:${userId}:${deviceId}`, JSON.stringify({ profile: 'automatico', intervalMs: 5_000 })), { deviceId, tenantId: 'tenant-test', userId: 'user-test' });
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  const migratedPreference = await page.evaluate(({ deviceId, tenantId, userId }) => localStorage.getItem(`qt:cozinha:visual:${tenantId}:${userId}:${deviceId}`), { deviceId, tenantId: 'tenant-test', userId: 'user-test' });
  expect(JSON.parse(migratedPreference ?? '{}')).toEqual({ profile: 'automatico' });
  await page.waitForTimeout(5_500);
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.getByText(new RegExp(`Página 2 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  await page.goto('/operacao/cozinha');
  await expect(page.getByText(/Página 1 de \d+ · \d+ pedidos/)).toBeVisible();
  await page.waitForTimeout(5_500);
  await expect(page.getByText(/Página 1 de \d+ · \d+ pedidos/)).toBeVisible();
});

test('ao entregar um pedido, os pedidos seguintes preenchem a página sem duplicações', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const kitchen = await stubKitchen(page, 72);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const capacity = await page.locator('.cozinha-tv-grid > article').count();
  kitchen.setCount(capacity * 3);
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  const firstCard = page.locator('.cozinha-tv-grid > article').first();
  const visibleCapacity = await page.locator('.cozinha-tv-grid > article').count();
  await firstCard.getByRole('button', { name: 'Iniciar' }).click();
  await firstCard.getByRole('button', { name: 'Pronto' }).click();
  await firstCard.getByRole('button', { name: 'Entregue' }).click();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 3 - 1} pedidos`))).toBeVisible();
  await expect(page.locator('.cozinha-tv-grid > article')).toHaveCount(visibleCapacity, { timeout: 2_000 });
  await expect.poll(() => page.locator('.cozinha-tv-grid .cozinha-tv-card-senha').allTextContents()).toEqual(Array.from({ length: visibleCapacity }, (_, index) => `Senha ${index + 2}`));
});

test('pedido recebido durante uma ação fica no fim e não desloca o cartão em uso', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const kitchen = await stubKitchen(page, 72);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const capacity = await page.locator('.cozinha-tv-grid > article').count();
  kitchen.setCount(capacity * 3);
  await page.reload();
  const total = capacity * 3;
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${total} pedidos`))).toBeVisible();
  const card = page.locator('.cozinha-tv-grid > article').first();
  kitchen.addOnNextStatus();
  await card.getByRole('button', { name: 'Iniciar' }).click();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${total} pedidos`))).toBeVisible();
  await expect(page.getByText(new RegExp(`Página 1 de \\d+ · ${total + 1} pedidos`))).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.cozinha-tv-grid > article').first()).toContainText('Senha 1');
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeEnabled();
});

test('a página atual é corrigida quando uma atualização remove a última página', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const kitchen = await stubKitchen(page, 72);
  await page.goto('/operacao/cozinha/tv');
  await expect(page.getByText(/Página 1 de \d+ · 72 pedidos/)).toBeVisible();
  const capacity = await page.locator('.cozinha-tv-grid > article').count();
  kitchen.setCount(capacity * 3);
  await page.reload();
  await expect(page.getByText(new RegExp(`Página 1 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  await page.getByRole('button', { name: 'Próxima' }).click();
  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect(page.getByText(new RegExp(`Página 3 de 3 · ${capacity * 3} pedidos`))).toBeVisible();
  kitchen.setCount(capacity * 2);
  await page.locator('.cozinha-tv-grid > article').first().getByRole('button', { name: 'Iniciar' }).click();
  await expect(page.getByText(new RegExp(`Página 2 de 2 · ${capacity * 2} pedidos`))).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeDisabled();
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
  await expect(page.getByText('Página 1 de 1 · 2 pedidos')).toBeVisible();
  await expect.poll(() => connectionCount).toBeGreaterThan(0);
  kitchen.setCount(3);
  await connections[connectionCount - 1]!.close({ code: 1000, reason: 'qa reconnect' });
  await expect(page.getByText('Página 1 de 1 · 3 pedidos')).toBeVisible({ timeout: 8_000 });
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
