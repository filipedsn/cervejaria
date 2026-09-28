import { expect, test } from '@playwright/test';
import { apiLogin, apiRequest } from '../helpers/api';
import { CREDENTIALS } from '../helpers/auth';

const runId = `current-matrix-${Date.now()}`;
const ownerEmail = `${runId}@qa.test`;
const ownerPassword = 'CurrentModel-qa-2026';
let adminCookie = '';
let ownerCookie = '';
let companyId = '';
let pointOfSaleId = '';

const cases = (['CAIXA', 'EVENTO'] as const).flatMap((mode) =>
  [false, true].flatMap((taps) => [false, true].flatMap((inventory) => [false, true].map((kitchen) => ({
    mode, taps, inventory, kitchen,
  })))),
);

async function request<T = Record<string, any>>(method: string, path: string, cookie: string, body?: unknown, status = 200) {
  const result = await apiRequest<T>(method, path, { cookie, ...(body === undefined ? {} : { body }) });
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.data)}`).toBe(status);
  return result.data;
}

test.describe('Current operational profile — mode × capability matrix', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(45_000);

  test.beforeAll(async () => {
    adminCookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    const provisioned = await request<{ cervejaria: { id: string } }>('POST', '/api/admin/cervejarias/provision', adminCookie, {
      nome: `E2E current matrix ${runId}`,
      dono: { nome: 'Current Matrix Owner', email: ownerEmail, senha: ownerPassword },
      enablements: { plannedOperations: false, taps: true, inventory: true, kitchen: true },
    }, 201);
    companyId = provisioned.cervejaria.id;
    ownerCookie = await apiLogin(ownerEmail, ownerPassword);
    const pos = await request<{ id: string }>('POST', '/api/operacao/pontos-venda', ownerCookie, { nome: 'Ponto da matriz' }, 201);
    pointOfSaleId = pos.id;
    await request('POST', '/api/trailers', ownerCookie, { nome: 'Trailer da matriz' }, 201);
  });

  test.afterAll(async () => {
    if (companyId && adminCookie) {
      await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/ativo`, {
        cookie: adminCookie, body: { ativo: false },
      });
    }
  });

  for (const item of cases) {
    test(`${item.mode} taps=${Number(item.taps)} inventory=${Number(item.inventory)} kitchen=${Number(item.kitchen)}`, async ({ page }) => {
      await request('PATCH', `/api/admin/cervejarias/${companyId}/configuracao-operacional`, adminCookie, {
        plannedOperationsEnabled: item.mode === 'EVENTO',
        tapsEnabled: item.taps,
        inventoryEnabled: item.inventory,
        kitchenEnabled: item.kitchen,
        confirmacaoEstoque: true,
      });

      const context = await request<Record<string, any>>('GET', '/api/operacao/contexto', ownerCookie);
      expect(context).toMatchObject({
        operationMode: item.mode,
        plannedOperationsEnabled: item.mode === 'EVENTO',
        tapsEnabled: item.taps,
        inventoryEnabled: item.inventory,
        kitchenEnabled: item.kitchen,
        pontosVenda: expect.arrayContaining([expect.objectContaining({ id: pointOfSaleId })]),
      });

      const origin = new URL(process.env.E2E_API_BASE ?? 'http://localhost:3002');
      await page.context().addCookies([{
        name: 'token', value: ownerCookie.replace(/^token=/, ''), domain: origin.hostname, path: '/',
        httpOnly: true, secure: origin.protocol === 'https:', sameSite: 'Lax',
      }]);
      await page.goto(item.mode === 'CAIXA' ? '/operacao/configuracoes/operacao' : '/configuracoes/operacao');
      await expect(page).not.toHaveURL(/\/login/);
      const selected = item.mode === 'CAIXA' ? 'Por caixa' : /Por opera/;
      await expect(page.getByRole('button', { name: selected })).toHaveAttribute('aria-pressed', 'true');

      await page.goto('/operacao/comandas');
      await expect(page).not.toHaveURL(/\/login/);
      const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
      await expect(navigation.getByRole('link', { name: 'Estoque', exact: true })).toHaveCount(item.inventory ? 1 : 0);
      await expect(navigation.getByRole('link', { name: 'Cozinha', exact: true })).toHaveCount(item.kitchen ? 1 : 0);

      const stock = await apiRequest('GET', `/api/operacao/estoque?pontoVendaId=${pointOfSaleId}`, { cookie: ownerCookie });
      expect(stock.status, `estoque capability=${item.inventory}`).toBe(item.inventory ? 200 : 404);
      const kitchen = await apiRequest('GET', '/api/operacao/cozinha', { cookie: ownerCookie });
      expect(kitchen.status, `kitchen capability=${item.kitchen}`).toBe(item.kitchen ? 200 : 404);
    });
  }
});
