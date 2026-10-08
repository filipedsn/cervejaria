import { expect, test } from '@playwright/test';

const permissions: string[] = [];
const ownerPermissions = [
  'cash.open', 'cash.close', 'cash.values.read', 'cash.movement.write', 'payment.receive',
  'debt.receive', 'command.close', 'discount.apply', 'command.item.cancel', 'command.cancel', 'kitchen.cancel',
  'sale.refund', 'dashboard.read', 'event.dashboard.read', 'reports.read', 'command.read', 'command.operate',
  'kitchen.read', 'kitchen.operate', 'inventory.read', 'inventory.adjust', 'catalog.manage', 'clients.manage',
  'taps.operate', 'agenda.manage', 'event.menu.manage',
];

test('carrega, altera, salva e reabre permissoes individuais da equipe', async ({ page }) => {
  test.setTimeout(60_000);
  const writes: string[][] = [];
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'GET' && url.pathname === '/api/auth/me') {
      return route.fulfill({ json: {
        usuario: { id: 'ui-owner', nome: 'Owner UI', email: 'owner@example.invalid', papel: 'DONO', permissoesOperacao: ownerPermissions },
        cervejaria: { id: 'ui-company', nome: 'Cervejaria UI', slug: 'permissions-ui' },
      } });
    }
    if (method === 'GET' && url.pathname === '/api/usuarios') {
      return route.fulfill({ json: [
        { id: 'ui-owner', nome: 'Owner UI', email: 'owner@example.invalid', papel: 'DONO', permissoesOperacao: ownerPermissions },
        { id: 'ui-staff', nome: 'Atendente QA', email: 'staff@example.invalid', papel: 'ATENDENTE', permissoesOperacao: [...permissions] },
      ] });
    }
    if (method === 'PATCH' && url.pathname === '/api/usuarios/ui-staff/permissoes-operacao') {
      const body = request.postDataJSON() as { permissoesOperacao: string[] };
      permissions.splice(0, permissions.length, ...body.permissoesOperacao);
      writes.push([...permissions]);
      return route.fulfill({ json: { id: 'ui-staff', permissoesOperacao: [...permissions] } });
    }
    if (method === 'GET' && url.pathname === '/api/operacao/contexto') {
      return route.fulfill({ json: { ativo: false, operationMode: 'LEGACY', pontosVenda: [], temCozinha: false, controlaEstoque: false } });
    }
    if (method === 'GET' && url.pathname === '/api/onboarding/readiness') {
      return route.fulfill({ json: {
        mode: 'CAIXA', capacities: { controlaEstoque: false, temCozinha: false }, hasHistoricalSale: true,
        firstSaleCompleted: true, operationReady: true, canConfigure: false,
        modules: { operacao: { enabled: false, ready: true, missingSteps: [] }, cervejaria: { enabled: false, ready: true, missingSteps: [] } },
      } });
    }
    if (method === 'GET' && url.pathname === '/api/trailers') return route.fulfill({ json: [] });
    if (method === 'GET' && url.pathname === '/api/eventos/ativos') return route.fulfill({ json: [] });
    if (method === 'GET' && url.pathname === '/api/cervejaria/configuracao-operacional') return route.fulfill({ json: { configuration: { setupCompletedAt: '2026-10-07T12:00:00.000Z' } } });
    if (method === 'POST' && url.pathname === '/api/audit/events') return route.fulfill({ status: 204, body: '' });
    unexpected.push(`${method} ${url.pathname}${url.search}`);
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/configuracoes/equipe');
  await expect(page.getByText('Atendente QA')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Acesso integral às permissões da empresa.')).toBeVisible();
  const onboarding = page.getByRole('region', { name: 'Como começar a vender' });
  if (await onboarding.count()) await onboarding.getByRole('button', { name: 'Fechar' }).click();
  const openCash = page.getByRole('checkbox', { name: 'Abrir caixa' }).last();
  const readCash = page.getByRole('checkbox', { name: 'Visualizar valores do caixa' }).last();
  await expect(openCash).not.toBeChecked();
  await expect(readCash).not.toBeChecked();
  await openCash.click();
  await expect.poll(() => writes).toEqual([['cash.open']]);
  await expect(openCash).toBeChecked();
  await page.reload();
  await expect(page.getByText('Atendente QA')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Abrir caixa' }).last()).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Visualizar valores do caixa' }).last()).not.toBeChecked();
  const readCommands = page.getByRole('checkbox', { name: 'Consultar comandas' }).last();
  const operateCommands = page.getByRole('checkbox', { name: 'Abrir comandas e lançar itens' }).last();
  await expect(readCommands).not.toBeChecked();
  await expect(operateCommands).not.toBeChecked();
  await readCommands.click();
  await expect.poll(() => writes.at(-1)).toEqual(['cash.open', 'command.read']);
  await expect(operateCommands).not.toBeChecked();
  expect(writes).toEqual([['cash.open'], ['cash.open', 'command.read']]);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
