import { expect, test, type Page } from '@playwright/test';

const order = {
  id: 'order-cancel-1',
  numero: 41,
  status: 'RECEBIDO',
  createdAt: '2026-10-09T10:00:00.000Z',
  statusDesde: '2026-10-09T10:00:00.000Z',
  entregueEm: null,
  observacao: null,
  comanda: { id: 'command-cancel-1', tipo: 'MESA', identificador: 'Mesa 4', numero: 4, cliente: null },
  itens: [{
    id: 'item-cancel-1',
    nome: 'Hambúrguer sem cebola',
    quantidade: 1,
    observacao: 'Molho à parte',
    opcionais: [],
    cancelamentoPendente: true,
    paraViagem: false,
  }],
};

async function stubApplication(page: Page, onConfirm: () => 'already-confirmed' | 'server-error' | 'success') {
  let orders = [order];
  let confirmationCalls = 0;
  let confirmationWrites = 0;
  let backendPending = true;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'user-cancel-test', nome: 'QA', email: 'qa@example.test', papel: 'DONO', permissoesOperacao: [] }, cervejaria: { id: 'tenant-cancel-test', nome: 'Cozinha QA' } } });
    } else if (url.pathname.endsWith('/api/operacao/contexto')) {
      await route.fulfill({ json: { ativo: true, operationMode: 'CAIXA', kitchenEnabled: true, temCozinha: true, controlaEstoque: false, whatsappPedidoProntoEnabled: false, whatsappPedidoProntoNaCozinha: false, pontosVenda: [] } });
    } else if (url.pathname.endsWith('/api/onboarding/readiness')) {
      await route.fulfill({ json: { mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] } } } });
    } else if (url.pathname.endsWith('/api/cervejaria/configuracao-operacional')) {
      await route.fulfill({ json: { enablements: { kitchen: true }, configuration: { kitchenEnabled: true } } });
    } else if (url.pathname.endsWith('/api/operacao/cozinha')) {
      await route.fulfill({ json: orders });
    } else if (url.pathname.includes('/api/operacao/cozinha/') && url.pathname.endsWith('/confirmar-cancelamento')) {
      confirmationCalls += 1;
      const scenario = onConfirm();
      if (scenario === 'already-confirmed') {
        backendPending = false;
        orders = [];
        await route.fulfill({ status: 409, json: { error: 'Este item não possui cancelamento pendente' } });
      } else if (scenario === 'server-error') {
        await route.fulfill({ status: 500, json: { error: 'Falha temporária ao confirmar cancelamento' } });
      } else if (backendPending) {
        confirmationWrites += 1;
        backendPending = false;
        orders = [];
        await route.fulfill({ json: { ok: true } });
      } else {
        await route.fulfill({ status: 409, json: { error: 'Este item não possui cancelamento pendente' } });
      }
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.route('**/socket.io/**', (route) => route.abort());
  return {
    get confirmationCalls() { return confirmationCalls; },
    get confirmationWrites() { return confirmationWrites; },
  };
}

test('confirmação concorrente sincroniza a fila sem banner nem segunda aplicação', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const api = await stubApplication(page, () => 'already-confirmed');
  await page.goto('/operacao/cozinha/tv');
  const card = page.locator('.cozinha-tv-grid > article').filter({ hasText: 'Hambúrguer sem cebola' });
  await expect(card).toBeVisible();
  const confirm = card.getByRole('button', { name: 'Confirmar cancelamento' });
  await expect(confirm).toBeEnabled();
  await confirm.dblclick();
  await expect(page.getByRole('status')).toContainText('já foi confirmado em outra sessão');
  await expect(page.locator('.cozinha-tv-grid > article')).toHaveCount(0);
  await expect(page.locator('.cozinha-tv-erro')).toHaveCount(0);
  expect(api.confirmationCalls).toBe(1);
});

test('falha real fica junto ao item e preserva o pedido pendente', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await stubApplication(page, () => 'server-error');
  await page.goto('/operacao/cozinha/tv');
  const card = page.locator('.cozinha-tv-grid > article').filter({ hasText: 'Hambúrguer sem cebola' });
  const before = await card.boundingBox();
  await card.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByRole('alert')).toContainText('Falha temporária ao confirmar cancelamento');
  await expect(page.locator('.cozinha-tv-erro')).toHaveCount(0);
  await expect(card).toContainText('Cancelamento solicitado');
  expect(await card.boundingBox()).toEqual(before);
});

test('duplo toque confirma uma vez e não duplica a alteração persistida', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const api = await stubApplication(page, () => 'success');
  await page.goto('/operacao/cozinha/tv');
  const card = page.locator('.cozinha-tv-grid > article').filter({ hasText: 'Hambúrguer sem cebola' });
  await card.getByRole('button', { name: 'Confirmar cancelamento' }).dblclick();
  await expect(page.locator('.cozinha-tv-grid > article')).toHaveCount(0);
  expect(api.confirmationCalls).toBe(1);
  expect(api.confirmationWrites).toBe(1);
});

test('comanda mantém o selo, remove a faixa e protege estorno contra duplo toque', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const comanda = {
    id: 'command-cancel-detail',
    tipo: 'MESA',
    identificador: '4',
    numero: 4,
    status: 'ABERTA',
    pontoVendaId: 'pdv-cancel-test',
    createdAt: '2026-10-09T10:00:00.000Z',
    fechadaEm: null,
    subtotal: 25,
    desconto: 0,
    total: 25,
    valorEmAberto: 25,
    cliente: null,
    pedidos: [{
      id: 'command-order-cancel-detail',
      numero: 1,
      status: 'RECEBIDO',
      observacao: null,
      createdAt: '2026-10-09T10:00:00.000Z',
      itens: [{ id: 'command-item-cancel-detail', produtoId: 'product-cancel', nome: 'Hambúrguer teste', precoUnit: 25, quantidade: 1, volumeMl: 0, subtotal: 25, exigePreparo: true, cancelamentoPendenteEm: null as string | null, canceladoEm: null }],
    }],
    pagamentos: [],
  };
  let deletionCalls = 0;
  let stockRefundWrites = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({ json: { usuario: { id: 'user-cancel-test', nome: 'QA', email: 'qa@example.test', papel: 'DONO', permissoesOperacao: [] }, cervejaria: { id: 'tenant-cancel-test', nome: 'Cozinha QA' } } });
    } else if (url.pathname.endsWith('/api/operacao/contexto')) {
      await route.fulfill({ json: { ativo: true, operationMode: 'CAIXA', kitchenEnabled: true, temCozinha: true, controlaEstoque: false, pontosVenda: [] } });
    } else if (url.pathname.endsWith('/api/onboarding/readiness')) {
      await route.fulfill({ json: { mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: true }, hasHistoricalSale: true, firstSaleCompleted: true, operationReady: true, canConfigure: false, modules: { operacao: { enabled: true, ready: true, missingSteps: [] } } } });
    } else if (url.pathname.endsWith('/api/cervejaria/configuracao-operacional')) {
      await route.fulfill({ json: { enablements: { kitchen: true }, configuration: { kitchenEnabled: true } } });
    } else if (url.pathname.endsWith('/api/operacao/comandas/command-cancel-detail')) {
      await route.fulfill({ json: comanda });
    } else if (url.pathname.includes('/api/operacao/produtos')) {
      await route.fulfill({ json: [] });
    } else if (url.pathname.endsWith('/api/operacao/comandas/command-cancel-detail/itens/command-item-cancel-detail')) {
      deletionCalls += 1;
      if (stockRefundWrites === 0) stockRefundWrites += 1;
      comanda.pedidos[0].itens[0].cancelamentoPendenteEm = new Date().toISOString();
      await route.fulfill({ json: comanda });
    } else if (url.pathname.endsWith('/api/audit/events')) {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.goto('/operacao/comandas/command-cancel-detail');
  await page.locator('button[aria-label^="Remover "]').dblclick();
  await expect(page.getByText('Cancelamento solicitado', { exact: true })).toBeVisible();
  await expect(page.locator('.alert-success')).toHaveCount(0);
  expect(deletionCalls).toBe(1);
  expect(stockRefundWrites).toBe(1);
});
