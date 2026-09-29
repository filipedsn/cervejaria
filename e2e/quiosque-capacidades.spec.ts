import { expect, test } from '@playwright/test';
import { API_BASE, apiLogin, apiRequest } from './helpers/api';
import { CREDENTIALS, gotoAfterLogin, login } from './helpers/auth';

const stamp = Date.now();
const companyName = `TAP-42 E2E ${stamp}`;
const owner = {
  name: 'Dono TAP-42',
  email: `tap-42-${stamp}@qa.test`,
  password: 'qa123456',
};

let adminCookie = '';
let ownerCookie = '';
let companyId = '';

async function createKioskCompany() {
  const data = new FormData();
  data.append('cervejariaNome', companyName);
  data.append('donoNome', owner.name);
  data.append('donoEmail', owner.email);
  data.append('donoSenha', owner.password);
  data.append('moduloCervejaria', 'false');
  data.append('moduloOperacao', 'true');
  data.append('operacaoControlaEstoque', 'false');
  data.append('operacaoTemCozinha', 'false');

  const response = await fetch(`${API_BASE}/api/admin/cervejarias`, {
    method: 'POST',
    headers: { Cookie: adminCookie, Accept: 'application/json' },
    body: data,
  });
  const body = (await response.json()) as { cervejaria?: { id: string }; error?: string };
  expect(response.status, body.error).toBe(201);
  companyId = body.cervejaria?.id ?? '';
  expect(companyId).not.toBe('');
}

test.describe('TAP-42 — capacidades do Quiosque', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    adminCookie = await apiLogin(CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    await createKioskCompany();
    ownerCookie = await apiLogin(owner.email, owner.password);
  });

  test.afterAll(async () => {
    if (!companyId || !adminCookie) return;
    await apiRequest('PATCH', `/api/admin/cervejarias/${companyId}/ativo`, {
      cookie: adminCookie,
      body: { ativo: false },
    });
  });

  test('deriva o tenant da sessão e exige confirmação explícita de estoque', async () => {
    const arbitraryTenant = await apiRequest('PATCH', '/api/operacao/capacidades', {
      cookie: ownerCookie,
      body: { cervejariaId: 'outro-tenant', temCozinha: true },
    });
    expect(arbitraryTenant.status).toBe(400);

    const withoutConfirmation = await apiRequest('PATCH', '/api/operacao/capacidades', {
      cookie: ownerCookie,
      body: { controlaEstoque: true },
    });
    expect(withoutConfirmation.status).toBe(400);
  });

  test('DONO alterna cozinha e estoque, com atualização imediata da navegação', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await gotoAfterLogin(page, '/operacao/configuracoes/operacao');

    await expect(page.getByRole('heading', { name: /Como voc/ })).toBeVisible();

    const kitchenResponse = page.waitForResponse((response) =>
      response.url().includes('/api/cervejaria/configuracao-operacional') && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Ativar Cozinha / preparo' }).click();
    expect((await kitchenResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Desativar Cozinha / preparo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cozinha' })).toBeVisible();

    await page.getByRole('button', { name: 'Desativar Cozinha / preparo' }).click();
    await expect(page.getByRole('button', { name: 'Ativar Cozinha / preparo' })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Ativar Controle de estoque' }).click();
    await expect(page.getByRole('button', { name: 'Desativar Controle de estoque' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Estoque', exact: true })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Desativar Controle de estoque' }).click();
    await expect(page.getByRole('button', { name: 'Ativar Controle de estoque' })).toBeVisible();
  });

  test('mantém CAIXA e EVENTO como escolhas independentes das capabilities', async ({ page }) => {
    const ownerCookie = await apiLogin(CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    const concluiuSetup = await apiRequest('PATCH', '/api/cervejaria/configuracao-operacional', {
      cookie: ownerCookie,
      body: { operationMode: 'CAIXA', tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, completeInitialSetup: true },
    });
    expect(concluiuSetup.status).toBe(200);
    await login(page, CREDENTIALS.caixa.email, CREDENTIALS.caixa.password);
    await gotoAfterLogin(page, '/operacao/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: /Como voc/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Por caixa' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Por caixa' })).toContainText('Selecionado');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link').first()).toHaveAccessibleName('Comandas');

    await page.context().clearCookies();
    await login(page, CREDENTIALS.dono.email, CREDENTIALS.dono.password);
    await gotoAfterLogin(page, '/configuracoes/operacao');
    await expect(page.getByRole('heading', { name: /Como voc/ })).toBeVisible();
    const modoEvento = page.getByRole('button', { name: /^Por operações \/ eventos/ }).first();
    await modoEvento.click();
    await expect(modoEvento).toHaveAttribute('aria-pressed', 'true');
    await expect(modoEvento).toContainText('Selecionado');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link').first()).toHaveAccessibleName('Eventos');

    const restaurouCaixa = await apiRequest('PATCH', '/api/cervejaria/configuracao-operacional', {
      cookie: ownerCookie,
      body: { operationMode: 'CAIXA', tapsEnabled: true, inventoryEnabled: false, kitchenEnabled: false, completeInitialSetup: true },
    });
    expect(restaurouCaixa.status).toBe(200);
  });

  test('cria o primeiro ponto de venda pela tela do caixa', async ({ page }) => {
    await login(page, owner.email, owner.password);
    let forceEmpty = true;
    await page.route('**/api/operacao/contexto', async (route) => {
      const response = await route.fetch();
      if (!forceEmpty) return route.fulfill({ response });
      const body = await response.json() as { pontosVenda?: unknown[] };
      body.pontosVenda = [];
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await gotoAfterLogin(page, '/operacao/configuracoes/operacao');
    await page.getByRole('button', { name: 'Por caixa' }).click();
    await page.goto('/operacao/caixa');
    await expect(page.getByRole('heading', { name: 'Você ainda não possui um ponto de venda.' })).toBeVisible();
    await page.getByLabel('Nome do ponto').fill(`PDV visual ${stamp}`);
    forceEmpty = false;
    await page.getByRole('button', { name: 'Criar ponto de venda' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa do dia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir caixa' })).toBeEnabled();
  });

  test('exibe de forma compreensível o bloqueio devolvido pelo backend', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await gotoAfterLogin(page, '/operacao/configuracoes/operacao');
    await page.getByRole('button', { name: 'Ativar Cozinha / preparo' }).click();
    await expect(page.getByRole('button', { name: 'Desativar Cozinha / preparo' })).toBeVisible();

    await page.route('**/api/cervejaria/configuracao-operacional', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'A cozinha não pode ser desativada enquanto houver pedidos em andamento',
        }),
      });
    });

    await page.getByRole('button', { name: 'Desativar Cozinha / preparo' }).click();
    await expect(page.getByText(/cozinha não pode ser desativada enquanto houver pedidos/i)).toBeVisible();
    await page.unroute('**/api/cervejaria/configuracao-operacional');
    await page.getByRole('button', { name: 'Desativar Cozinha / preparo' }).click();
    await expect(page.getByRole('button', { name: 'Ativar Cozinha / preparo' })).toBeVisible();
  });

  test('preserva CAIXA quando a API bloqueia a mudanca para EVENTO', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await page.goto('/operacao/configuracoes/operacao');
    const caixa = page.getByRole('button', { name: 'Por caixa' });
    const evento = page.getByRole('button', { name: /Por opera/ });
    await expect(caixa).toHaveAttribute('aria-pressed', 'true');
    await page.route('**/api/cervejaria/configuracao-operacional', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Feche o caixa antes de mudar para Opera\u00e7\u00f5es / Eventos.' }),
      });
    });
    await evento.click();
    await expect(page.getByText(/Feche o caixa antes de mudar/i)).toBeVisible();
    await expect(caixa).toHaveAttribute('aria-pressed', 'true');
    await expect(evento).toHaveAttribute('aria-pressed', 'false');
  });

  test('ADMIN edita capacidades operacionais sem modo principal legado', async ({ page }) => {
    await login(page, CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    await page.goto('/admin/cervejarias');

    const row = page.getByRole('row').filter({ hasText: companyName });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Editar' }).click();

    const dialog = page.getByRole('dialog', { name: new RegExp(companyName) });
    await expect(dialog.getByRole('checkbox')).toHaveCount(3);
    await expect(dialog.getByRole('checkbox', { name: /Cervejaria/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Por caixa' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Por operações / eventos' })).toBeVisible();
    await dialog.getByRole('checkbox', { name: /Cozinha \/ preparo/ }).check();
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();

    await expect(dialog).toBeHidden();
    const savedConfiguration = await apiRequest<{ kitchenEnabled: boolean }>(
      'GET', `/api/admin/cervejarias/${companyId}/configuracao-operacional`, { cookie: adminCookie },
    );
    expect(savedConfiguration.data.kitchenEnabled).toBe(true);
    await row.getByRole('button', { name: 'Editar' }).click();
    await expect(dialog.getByRole('checkbox', { name: /Cozinha \/ preparo/ })).toBeChecked();
  });
});
