import { expect, test, type Page } from '@playwright/test';

const ownerPermissions = [
  'cash.open', 'cash.close', 'cash.values.read', 'cash.movement.write', 'payment.receive',
  'debt.receive', 'command.close', 'discount.apply', 'command.item.cancel', 'command.cancel', 'kitchen.cancel',
  'sale.refund', 'dashboard.read', 'event.dashboard.read', 'reports.read', 'command.read', 'command.operate',
  'kitchen.read', 'kitchen.operate', 'inventory.read', 'inventory.adjust', 'catalog.manage', 'catalog.shift.manage', 'clients.manage',
  'taps.operate', 'agenda.manage', 'event.menu.manage',
];


const groups = ['Atendimento', 'Caixa e pagamentos', 'Cozinha', 'Estoque', 'Catálogo', 'Clientes', 'Agenda e TAPs', 'Dashboard e relatórios'];

async function setup(page: Page, legacy = false) {
  let permissions = ['command.read', 'future.preserved'];
  let discount = false;
  let failNext = false;
  let release: (() => void) | undefined;
  let hold = false;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const owner = { id: 'ui-owner', nome: 'Owner UI', email: 'owner@example.invalid', papel: 'DONO', ...(legacy ? {} : { permissoesOperacao: ownerPermissions }) };
  const staff = () => ({ id: 'ui-staff', nome: 'Atendente QA', email: 'staff@example.invalid', papel: 'ATENDENTE', podeDarDescontoOperacao: discount, ...(legacy ? {} : { permissoesOperacao: [...permissions] }) });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'GET' && url.pathname === '/api/auth/me') return route.fulfill({ json: {
      usuario: owner, cervejaria: { id: 'ui-company', nome: 'Cervejaria UI', slug: 'permissions-ui' },
    } });
    if (method === 'GET' && url.pathname === '/api/usuarios') return route.fulfill({ json: [owner, staff(),
      { ...staff(), id: 'ui-other', nome: 'Outro atendente', email: 'other@example.invalid' },
    ] });
    if (method === 'PATCH' && url.pathname === '/api/usuarios/ui-staff/permissoes-operacao') {
      const body = request.postDataJSON();
      writes.push({ path: url.pathname, body });
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: 'Falha simulada ao salvar' } }); }
      if (legacy) discount = body.podeDarDescontoOperacao;
      else permissions = [...body.permissoesOperacao];
      return route.fulfill({ json: staff() });
    }
    if (method === 'POST' && url.pathname === '/api/usuarios') {
      creates.push(request.postDataJSON());
      return route.fulfill({ json: { id: 'ui-created' } });
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
    unexpected.push(method + ' ' + url.pathname + url.search);
    return route.abort();
  });
  await page.routeWebSocket('**/socket.io/**', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/configuracoes/equipe');
  await expect(page.getByText('Atendente QA', { exact: true })).toBeVisible({ timeout: 20_000 });
  return { writes, creates, unexpected, errors, fail: () => { failNext = true; }, hold: () => { hold = true; }, release: () => { hold = false; release?.(); } };
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Gerenciar acessos de Atendente QA', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Gerenciar acessos', exact: true });
  await expect(editor).toBeVisible();
  return editor;
}

async function checkLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const editor = page.getByRole('dialog');
  const bounds = await editor.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  for (const button of await editor.locator('footer button').all()) {
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

for (const width of [390, 768]) {
  test.describe(width + 'px', () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

    test('lista compacta, todos os grupos e cancelamento sem PATCH', async ({ page }, testInfo) => {
      const api = await setup(page);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Gerenciar acessos de/ })).toHaveCount(2);
      await expect(page.getByRole('button', { name: /Gerenciar acessos de Owner/ })).toHaveCount(0);
      await expect(page.getByText(/Acesso integral/)).toBeVisible();
      expect((await page.getByRole('button', { name: '+ Novo Atendente' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath('compact-list.png'), fullPage: true });
      const editor = await openEditor(page);
      await expect(editor.getByText('staff@example.invalid', { exact: false })).toBeVisible();
      await expect(editor.locator('summary')).toHaveCount(8);
      for (const [index, group] of groups.entries()) {
        const summary = editor.locator('summary').nth(index);
        await expect(summary).toContainText(group);
        expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await summary.click();
      }
      await expect(editor.getByRole('checkbox')).toHaveCount(27);
      expect(new Set(await editor.getByRole('checkbox').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).size).toBe(27);
      for (const checkbox of await editor.getByRole('checkbox').all()) {
        expect((await checkbox.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await editor.getByRole('checkbox', { name: 'Fechar caixa', exact: true }).check();
      await expect(editor.getByRole('checkbox', { name: 'Visualizar valores do caixa' })).not.toBeChecked();
      await expect(editor.locator('summary').nth(1)).toContainText('(1/7)');
      await expect(editor.getByText(/Exige também Visualizar valores do caixa/)).toBeVisible();
      expect(api.writes).toEqual([]);
      await checkLayout(page);
      await editor.screenshot({ path: testInfo.outputPath('grouped-editor.png') });
      await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Gerenciar acessos de Atendente QA', exact: true })).toBeFocused();
      const reopened = await openEditor(page);
      await reopened.locator('summary').nth(1).click();
      await expect(reopened.getByRole('checkbox', { name: 'Fechar caixa', exact: true })).not.toBeChecked();
      await reopened.locator('summary').nth(0).click();
      await expect(reopened.getByRole('checkbox', { name: 'Consultar comandas' })).toBeChecked();
      expect(api.writes).toEqual([]);
      expect(api.unexpected).toEqual([]); expect(api.errors).toEqual([]);
    });

    test('salva uma vez no usuario correto, preserva chave oculta e reabre confirmado', async ({ page }) => {
      const api = await setup(page);
      const editor = await openEditor(page);
      await editor.locator('summary').nth(1).click();
      await editor.getByRole('checkbox', { name: 'Abrir caixa', exact: true }).check();
      await editor.getByRole('checkbox', { name: 'Fechar caixa', exact: true }).check();
      expect(api.writes).toEqual([]);
      api.hold();
      await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect.poll(() => api.writes.length).toBe(1);
      await expect(editor.getByRole('button', { name: 'Salvando...' })).toBeDisabled();
      await expect(editor.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
      await editor.getByRole('button', { name: 'Salvando...' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      await page.keyboard.press('Escape');
      await expect(editor).toBeVisible();
      expect(api.writes).toEqual([{ path: '/api/usuarios/ui-staff/permissoes-operacao', body: { permissoesOperacao: ['command.read', 'future.preserved', 'cash.open', 'cash.close'] } }]);
      api.release();
      await expect(editor).toHaveCount(0);
      await page.reload();
      const reopened = await openEditor(page);
      await reopened.locator('summary').nth(1).click();
      await expect(reopened.getByRole('checkbox', { name: 'Abrir caixa', exact: true })).toBeChecked();
      await expect(reopened.getByRole('checkbox', { name: 'Fechar caixa', exact: true })).toBeChecked();
      await expect(reopened.getByRole('checkbox', { name: 'Visualizar valores do caixa' })).not.toBeChecked();
      expect(api.writes).toHaveLength(1);
      expect(api.unexpected).toEqual([]); expect(api.errors).toEqual([]);
    });

    test('erro mantem rascunho e permite retry; fechar e Escape confirmam descarte', async ({ page }) => {
      const api = await setup(page);
      const editor = await openEditor(page);
      await editor.locator('summary').nth(0).click();
      await editor.getByRole('checkbox', { name: 'Consultar comandas' }).uncheck();
      api.fail();
      await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(editor.getByRole('alert')).toContainText('Falha simulada');
      await expect(editor.getByRole('checkbox', { name: 'Consultar comandas' })).not.toBeChecked();
      page.once('dialog', dialog => dialog.dismiss());
      await editor.getByRole('button', { name: 'Fechar', exact: true }).click();
      await expect(editor).toBeVisible();
      page.once('dialog', dialog => dialog.dismiss());
      await page.keyboard.press('Escape');
      await expect(editor).toBeVisible();
      await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(api.writes.map(write => write.body)).toEqual([{ permissoesOperacao: ['future.preserved'] }, { permissoesOperacao: ['future.preserved'] }]);
      const reopened = await openEditor(page);
      await reopened.locator('summary').nth(0).click();
      await expect(reopened.getByRole('checkbox', { name: 'Consultar comandas' })).not.toBeChecked();
      await reopened.getByRole('checkbox', { name: 'Consultar comandas' }).check();
      page.once('dialog', dialog => dialog.accept());
      await page.keyboard.press('Escape');
      await expect(reopened).toHaveCount(0);
      expect(api.writes).toHaveLength(2);
      expect(api.unexpected).toEqual([]); expect(api.errors).toEqual([]);
    });

    test('cadastro reutiliza grupos sem concessoes iniciais e acoes fixas', async ({ page }) => {
      const api = await setup(page);
      await page.getByRole('button', { name: '+ Novo Atendente' }).click();
      const editor = page.getByRole('dialog', { name: 'Novo Atendente' });
      await editor.getByLabel('Nome', { exact: true }).fill('Novo QA');
      await editor.getByLabel('E-mail', { exact: true }).fill('new@example.invalid');
      await editor.getByLabel('Senha inicial', { exact: true }).fill('Teste123!');
      await editor.getByLabel('Confirmar senha', { exact: true }).fill('Teste123!');
      for (const summary of await editor.locator('summary').all()) await summary.click();
      await expect(editor.getByRole('checkbox')).toHaveCount(27);
      await expect(editor.locator('input[type=checkbox]:checked')).toHaveCount(0);
      await checkLayout(page);
      // A short viewport approximates the space remaining above a mobile keyboard.
      await page.setViewportSize({ width, height: 460 });
      await checkLayout(page);
      // Some browsers shrink only visualViewport while the layout viewport stays tall.
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 300 });
        Object.defineProperty(window.visualViewport!, 'offsetTop', { configurable: true, value: 30 });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      const footerBox = await editor.locator('footer').boundingBox();
      expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(330);
      await editor.getByRole('button', { name: 'Cadastrar', exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(api.creates).toEqual([{ nome: 'Novo QA', email: 'new@example.invalid', senha: 'Teste123!', permissoesOperacao: [] }]);
      expect(api.writes).toEqual([]);
      expect(api.unexpected).toEqual([]); expect(api.errors).toEqual([]);
    });

    test('cadastro descarta selecoes locais e reabre vazio', async ({ page }) => {
      const api = await setup(page);
      await page.getByRole('button', { name: '+ Novo Atendente' }).click();
      const editor = page.getByRole('dialog', { name: 'Novo Atendente' });
      await editor.locator('summary').nth(1).click();
      await editor.getByRole('checkbox', { name: 'Abrir caixa', exact: true }).check();
      expect(api.writes).toEqual([]); expect(api.creates).toEqual([]);
      await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.getByRole('button', { name: '+ Novo Atendente' }).click();
      await editor.locator('summary').nth(1).click();
      await expect(editor.getByRole('checkbox', { name: 'Abrir caixa', exact: true })).not.toBeChecked();
      await expect(editor.locator('summary').nth(1)).toContainText('(0/7)');
      expect(api.unexpected).toEqual([]); expect(api.errors).toEqual([]);
    });

    test('flag desligada preserva booleano e endpoint legado', async ({ page }) => {
      const api = await setup(page, true);
      await expect(page.getByRole('button', { name: /Gerenciar acessos/ })).toHaveCount(0);
      expect((await page.getByRole('button', { name: 'Ativar desconto nas comandas', exact: true }).first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Ativar desconto nas comandas', exact: true }).first().click();
      await expect.poll(() => api.writes).toEqual([{ path: '/api/usuarios/ui-staff/permissoes-operacao', body: { podeDarDescontoOperacao: true } }]);
      await page.getByRole('button', { name: '+ Novo Atendente' }).click();
      const editor = page.getByRole('dialog', { name: 'Novo Atendente' });
      await expect(editor.locator('summary')).toHaveCount(0);
      await editor.getByLabel('Nome', { exact: true }).fill('Novo QA');
      await editor.getByLabel('E-mail', { exact: true }).fill('new@example.invalid');
      await editor.getByLabel('Senha inicial', { exact: true }).fill('Teste123!');
      await editor.getByLabel('Confirmar senha', { exact: true }).fill('Teste123!');
      await editor.getByRole('button', { name: 'Cadastrar', exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(api.creates).toEqual([{ nome: 'Novo QA', email: 'new@example.invalid', senha: 'Teste123!', podeDarDescontoOperacao: false }]);
      expect(api.unexpected).toEqual([]); expect(api.errors).toEqual([]);
    });
  });
}
