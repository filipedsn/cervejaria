import { expect, test } from '@playwright/test';
import { API_BASE, apiLogin, apiRequest } from './helpers/api';
import { CREDENTIALS, login } from './helpers/auth';

type MatrixCase = {
  id: string;
  mode: 'CAIXA' | 'EVENTO';
  taps: boolean;
  inventory: boolean;
  kitchen: boolean;
};

const combinations: MatrixCase[] = ['CAIXA', 'EVENTO'].flatMap((mode) =>
  [false, true].flatMap((taps) => [false, true].flatMap((inventory) => [false, true].map((kitchen) => ({
    id: `${mode === 'CAIXA' ? 'C' : 'E'}${String(1 + Number(taps) * 4 + Number(inventory) * 2 + Number(kitchen)).padStart(2, '0')}`,
    mode,
    taps,
    inventory,
    kitchen,
  })))),
);

const stamp = Date.now();
const owner = { name: 'E2E Matrix Owner', email: `e2e-matrix-${stamp}@qa.test`, password: 'qa123456' };
let adminCookie = '';
let ownerCookie = '';
let companyId = '';

async function configure(item: MatrixCase) {
  const result = await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/configuracao-operacional`, {
    cookie: adminCookie,
    body: {
      plannedOperationsEnabled: item.mode === 'EVENTO',
      directSalesEnabled: item.mode === 'CAIXA',
      tapsEnabled: item.taps,
      inventoryEnabled: item.inventory,
      kitchenEnabled: item.kitchen,
      confirmacaoEstoque: true,
    },
  });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
}

test.describe('TAP-68 — matriz cartesiana operacional', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    adminCookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    const data = new FormData();
    data.append('cervejariaNome', `TAP-68 Matrix ${stamp}`);
    data.append('donoNome', owner.name);
    data.append('donoEmail', owner.email);
    data.append('donoSenha', owner.password);
    data.append('moduloCervejaria', 'false');
    data.append('moduloQuiosque', 'true');
    data.append('quiosqueControlaEstoque', 'false');
    data.append('quiosqueTemCozinha', 'false');
    const response = await fetch(`${API_BASE}/api/admin/cervejarias`, { method: 'POST', headers: { Cookie: adminCookie, Accept: 'application/json' }, body: data });
    expect(response.status).toBe(201);
    companyId = ((await response.json()) as { cervejaria: { id: string } }).cervejaria.id;
    ownerCookie = await apiLogin(owner.email, owner.password);
  });

  test.afterAll(async () => {
    if (companyId) await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/ativo`, { cookie: adminCookie, body: { ativo: false } });
  });

  for (const item of combinations) {
    test(`${item.id} ${item.mode} taps=${Number(item.taps)} inventory=${Number(item.inventory)} kitchen=${Number(item.kitchen)}`, async ({ page }, testInfo) => {
      await configure(item);
      const context = await apiRequest<{ operationMode: string; tapsEnabled: boolean; inventoryEnabled: boolean; kitchenEnabled: boolean }>('GET', '/api/quiosque/contexto', { cookie: ownerCookie });
      expect(context.status).toBe(200);
      expect(context.data).toMatchObject({ operationMode: item.mode, tapsEnabled: item.taps, inventoryEnabled: item.inventory, kitchenEnabled: item.kitchen });

      await login(page, owner.email, owner.password);
      await page.goto(item.mode === 'CAIXA' ? '/quiosque/configuracoes/operacao' : '/configuracoes/operacao');
      await page.reload();
      const selected = item.mode === 'CAIXA' ? 'Por caixa' : /Por opera/;
      await expect(page.getByRole('button', { name: selected })).toHaveAttribute('aria-pressed', 'true');

      const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
      const links = navigation.getByRole('link');
      await expect(links.first()).toHaveAccessibleName(item.mode === 'CAIXA' ? 'Caixa' : 'Eventos');
      await expect(navigation.getByRole('link', { name: 'Quiosque' })).toHaveCount(0);
      await expect(navigation.getByRole('link', { name: 'Estabelecimento' })).toHaveCount(0);
      await expect(navigation.getByRole('link', { name: 'Híbrida' })).toHaveCount(0);
      await expect(navigation.getByRole('link', { name: /Venda avulsa/i })).toHaveCount(0);
      await expect(navigation.getByRole('link', { name: 'Estoque', exact: true })).toHaveCount(item.inventory ? 1 : 0);
      await expect(navigation.getByRole('link', { name: 'Cozinha', exact: true })).toHaveCount(item.kitchen ? 1 : 0);
      await page.screenshot({ path: testInfo.outputPath(`${item.id}.png`), fullPage: true });
    });
  }
});
