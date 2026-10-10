import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ownerEmail = process.env.RBAC_QA_OWNER_EMAIL!;
const ownerPassword = process.env.RBAC_QA_OWNER_PASSWORD!;
const staffEmail = process.env.RBAC_QA_STAFF_EMAIL!;
const staffPassword = process.env.RBAC_QA_STAFF_PASSWORD!;
const foreignEmail = process.env.RBAC_QA_FOREIGN_OWNER_EMAIL!;
const foreignPassword = process.env.RBAC_QA_FOREIGN_OWNER_PASSWORD!;
const ownerCookie = process.env.RBAC_QA_OWNER_COOKIE!;
const staffCookie = process.env.RBAC_QA_STAFF_COOKIE!;
const permissionApi = `/api/usuarios/${process.env.RBAC_QA_STAFF_ID}/permissoes-operacao`;
const permission = 'command.read';
const cashValuesPermission = 'cash.values.read';
const reportEventId = process.env.RBAC_QA_REPORT_EVENT_ID!;
const inventoryProductId = process.env.RBAC_QA_INVENTORY_PRODUCT_ID!;
const inventoryProductName = process.env.RBAC_QA_INVENTORY_PRODUCT_NAME!;
const kitchenOrderId = process.env.RBAC_QA_KITCHEN_ORDER_ID!;
const kitchenCommandIdentifier = process.env.RBAC_QA_KITCHEN_COMMAND_IDENTIFIER!;
const eventMenuOwnerCookie = process.env.RBAC_QA_EVENT_MENU_OWNER_COOKIE!;
const eventMenuStaffCookie = process.env.RBAC_QA_EVENT_MENU_STAFF_COOKIE!;
const eventMenuStaffId = process.env.RBAC_QA_EVENT_MENU_STAFF_ID!;
const eventMenuEventId = process.env.RBAC_QA_EVENT_MENU_EVENT_ID!;
const eventMenuEventName = process.env.RBAC_QA_EVENT_MENU_EVENT_NAME!;
const eventMenuForeignProductId = process.env.RBAC_QA_EVENT_MENU_PRODUCT_FOREIGN_ID!;
const eventMenuForeignProductName = process.env.RBAC_QA_EVENT_MENU_PRODUCT_FOREIGN_NAME!;

async function primeAndLogout(page: Page, cookie: string) {
  await page.context().addCookies([{ name: 'token', value: cookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  expect((await page.context().cookies()).some((entry) => entry.name === 'token')).toBe(true);
  await page.goto('/login');
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/operacao/comandas');
  await page.getByRole('button', { name: 'Abrir conta' }).click();
  const logout = page.getByRole('button', { name: 'Sair da conta' });
  await expect(logout).toBeVisible();
  await logout.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page).toHaveURL(/\/login$/);
}

async function logoutInBrowser(page: Page) {
  const logoutStatus = (await page.context().request.post(`${process.env.RBAC_QA_BASE_URL}/api/auth/logout`)).status();
  expect(logoutStatus).toBe(200);
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === 'token')).toBe(false);
  const anonymousStatus = (await page.context().request.get(`${process.env.RBAC_QA_BASE_URL}/api/auth/me`)).status();
  expect(anonymousStatus).toBe(401);
}

async function loginForm(page: Page, email: string, password: string) {
  if (new URL(page.url()).pathname !== '/login') {
    let navigationError: unknown;
    for (let attempt = 0; attempt < 2 && new URL(page.url()).pathname !== '/login'; attempt++) {
      try {
        await page.goto('/login', { waitUntil: 'commit' });
      } catch (error) {
        navigationError = error;
        await page.waitForURL(/\/login$/, { timeout: 1_000 }).catch(() => undefined);
      }
    }
    if (new URL(page.url()).pathname !== '/login' && navigationError) throw navigationError;
  }
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('E-mail')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('E-mail').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/operacao/comandas');
}

async function login(page: Page, email: string, password: string, cookie: string) {
  page.on('console', (message) => { if (message.type() === 'error') console.error(`RBAC_BROWSER_CONSOLE ${message.text()}`); });
  page.on('pageerror', (error) => console.error(`RBAC_BROWSER_PAGE_ERROR ${error.message}`));
  page.on('requestfailed', (request) => console.error(`RBAC_BROWSER_REQUEST_FAILED ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/')) console.log(`RBAC_BROWSER_API ${response.status()} ${new URL(response.url()).pathname}`);
  });
  await primeAndLogout(page, cookie);
  await expect(page.getByLabel('E-mail')).toBeVisible({ timeout: 15_000 }).catch(async (error) => {
    const body = await page.locator('body').innerText().catch(() => 'unavailable');
    const probe = await page.evaluate(async () => Promise.race([
      fetch('/api/auth/me').then(async (response) => `${response.status} ${await response.text()}`),
      new Promise<string>((resolve) => setTimeout(() => resolve('fetch timed out'), 5_000)),
    ])).catch((probeError) => `fetch failed: ${probeError}`);
    throw new Error(`Login page did not render at ${page.url()}: ${body.slice(0, 500)}; browser fetch=${probe}; ${error.message}`);
  });
  await loginForm(page, email, password);
  await expect.poll(async () => (await page.request.get('/api/auth/me')).status()).toBe(200);
}

async function setPermissions(context: BrowserContext, permissions: string[]) {
  const response = await context.request.patch(permissionApi, { data: { permissoesOperacao: permissions } });
  expect(response.status(), await response.text()).toBe(200);
}

test('real login, live grant and revoke, same-user sessions, tenant switch, and mobile layouts', async ({ browser, baseURL }, testInfo) => {
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await ownerContext.newPage();
  await login(owner, ownerEmail, ownerPassword, ownerCookie);
  const ownerMe = await ownerContext.request.get('/api/auth/me');
  expect(ownerMe.status()).toBe(200);
  const ownerPayload = await ownerMe.json();
  const ownerUser = ownerPayload.usuario;
  const ownerTenantId = ownerPayload.cervejaria.id;
  expect(ownerUser.papel).toBe('DONO');

  const disabledContext = await browser.newContext();
  await disabledContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  const disabledApi = await disabledContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(disabledApi.status());
  await disabledContext.close();
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  const uiErrors: string[] = [];
  const expectedHttpConsoleErrors: string[] = [];
  staff.on('pageerror', (error) => uiErrors.push(error.message));
  staff.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/\b(?:401|403|503)\b/.test(message.text())) expectedHttpConsoleErrors.push(message.text());
    else uiErrors.push(message.text());
  });
  await loginForm(staff, staffEmail, staffPassword);
  const staffTabContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const staffTab = await staffTabContext.newPage();
  await loginForm(staffTab, staffEmail, staffPassword);
  expect((await staffContext.cookies()).some((cookie) => cookie.name === 'token')).toBe(true);
  expect((await staffTabContext.cookies()).some((cookie) => cookie.name === 'token')).toBe(true);
  const operationalContextResponse = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContextResponse.status()).toBe(200);
  const operationalContext = await operationalContextResponse.json();
  const pointOfSaleId = operationalContext.pontosVenda[0]?.id;
  expect(pointOfSaleId, 'synthetic fixture must have an active point of sale').toBeTruthy();
  const cashUrl = `/api/operacao/caixa?pontoVendaId=${pointOfSaleId}`;
  const initialMe = await staffContext.request.get('/api/auth/me');
  expect((await initialMe.json()).usuario.permissoesOperacao).toEqual([]);
  const disabledCommandApi = await staffContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(disabledCommandApi.status());
  const sanitizedCash = await staffContext.request.get(cashUrl);
  expect(sanitizedCash.status()).toBe(200);
  const sanitizedCashBody = await sanitizedCash.json();
  expect(sanitizedCashBody.valoresRestritos).toBe(true);
  expect(sanitizedCashBody.sessao).toBeTruthy();
  expect(sanitizedCashBody.sessao).not.toHaveProperty('gaveta');
  expect(sanitizedCashBody.sessao).not.toHaveProperty('esperado');
  expect(sanitizedCashBody.sessao).not.toHaveProperty('movimentos');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  await expect(staff.getByText('Os valores financeiros estão restritos à sua permissão.')).toBeVisible();
  expect(uiErrors).toEqual([]);

  // cash.values.read is independent from command.read: it reveals only the
  // cash projection while command listing remains forbidden.
  await setPermissions(ownerContext, [cashValuesPermission]);
  await staff.reload();
  await staffTab.reload();
  const cashGrantMe = await staffContext.request.get('/api/auth/me');
  expect((await cashGrantMe.json()).usuario.permissoesOperacao).toEqual([cashValuesPermission]);
  const commandStillDenied = await staffContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(commandStillDenied.status());
  expect((await (await staffTabContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual([cashValuesPermission]);
  const fullCash = await staffContext.request.get(cashUrl);
  expect(fullCash.status()).toBe(200);
  const fullCashBody = await fullCash.json();
  expect(fullCashBody.valoresRestritos).toBeUndefined();
  expect(typeof fullCashBody.sessao.gaveta.esperadoDinheiro).toBe('number');
  await expect(staff.getByText('Os valores financeiros estão restritos à sua permissão.')).toHaveCount(0);
  // The simulated 503 is an error-state probe only. Authentication, permission
  // decisions and successful cash requests remain backed by the real API.
  await staff.route('**/api/operacao/caixa?*', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'synthetic temporary cash read failure' }),
  }));
  await staff.reload();
  await expect(staff.getByRole('alert')).toContainText('Nao foi possivel consultar o caixa');
  await expect(staff.getByText('Dinheiro esperado na gaveta')).toHaveCount(0);
  await staff.unroute('**/api/operacao/caixa?*');
  await staff.reload();
  await expect(staff.getByText('Dinheiro esperado na gaveta')).toBeVisible();
  expect(uiErrors).toEqual([]);

  // Revoke financial visibility and confirm the same authenticated sessions
  // return to a sanitized payload and usable restricted-state screen.
  await setPermissions(ownerContext, []);
  await staffTab.reload();
  await expect(staffTab.getByText('Os valores financeiros estão restritos à sua permissão.')).toBeVisible();
  const revokedCash = await staffContext.request.get(cashUrl);
  expect(revokedCash.status()).toBe(200);
  const revokedCashBody = await revokedCash.json();
  expect(revokedCashBody.valoresRestritos).toBe(true);
  expect(revokedCashBody.sessao).not.toHaveProperty('gaveta');
  await staff.reload();
  await expect(staff.getByText('Os valores financeiros estão restritos à sua permissão.')).toBeVisible();
  expect(uiErrors).toEqual([]);

  // Grant command.read alone. The command list works while cash remains
  // independently sanitized.
  await setPermissions(ownerContext, [permission]);
  await staff.reload();
  const grantedMe = await staffContext.request.get('/api/auth/me');
  expect((await grantedMe.json()).usuario.permissoesOperacao).toEqual([permission]);
  const allowedApi = await staffContext.request.get('/api/operacao/comandas');
  expect(allowedApi.status(), await allowedApi.text()).toBe(200);
  await staffTab.reload();
  expect((await (await staffTabContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual([permission]);
  const commandOnlyCash = await staffContext.request.get(cashUrl);
  expect((await commandOnlyCash.json()).valoresRestritos).toBe(true);
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/comandas');
  await staffTab.reload();
  await staffTab.goto('/operacao/comandas');
  await expect.poll(() => new URL(staffTab.url()).pathname).toBe('/operacao/comandas');
  for (const page of [staff, staffTab]) {
    await page.goto('/operacao/comandas');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/operacao/comandas');
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `horizontal overflow at ${dimensions.width}px`).toBeLessThanOrEqual(dimensions.width);
  }

  await setPermissions(ownerContext, []);
  const revokedApi = await staffContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(revokedApi.status());
  const revokedSecondSessionApi = await staffTabContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(revokedSecondSessionApi.status());
  await staff.reload();
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  await expect(staff.getByText('Os valores financeiros estão restritos à sua permissão.')).toBeVisible();
  await staffTab.reload();
  await expect.poll(() => new URL(staffTab.url()).pathname).toBe('/operacao/caixa');
  await expect(staffTab.getByText('Os valores financeiros estão restritos à sua permissão.')).toBeVisible();
  expect(uiErrors).toEqual([]);
  console.log('RBAC_LIVE_REGRESSION key=command.read; cash.values.read=absent; fallback=/operacao/caixa; sanitized-state=usable; result=PASS');
  await testInfo.attach('command-read-revocation-cash-fallback.png', { body: await staff.screenshot({ fullPage: true }), contentType: 'image/png' });
  expect((await staffContext.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);

  // dashboard.read grants a separate read-only route and API. A staff identity
  // without command.read must not inherit command access from this grant.
  const disabledDashboard = await staffContext.request.get('/api/cervejaria/dashboard');
  expect([401, 403]).toContain(disabledDashboard.status());
  await staff.goto('/dashboard');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/dashboard');
  console.log('RBAC_LIVE_REGRESSION key=dashboard.read; disabled=route-and-api-denied; result=PASS');
  await setPermissions(ownerContext, ['dashboard.read']);
  await staff.goto('/dashboard');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/dashboard');
  await expect(staff.getByRole('heading', { name: ownerPayload.cervejaria.nome })).toBeVisible();
  const allowedDashboard = await staffContext.request.get('/api/cervejaria/dashboard');
  expect(allowedDashboard.status(), await allowedDashboard.text()).toBe(200);
  expect([401, 403]).toContain((await staffContext.request.get('/api/operacao/comandas')).status());
  await setPermissions(ownerContext, []);
  expect([401, 403]).toContain((await staffContext.request.get('/api/cervejaria/dashboard')).status());
  await staff.reload();
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/dashboard');
  console.log('RBAC_LIVE_REGRESSION key=dashboard.read; grant-and-revoke-same-session; command.read=absent; result=PASS');

  await setPermissions(ownerContext, [permission]);
  await staff.reload();
  await staffTab.reload();
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/comandas');

  // Reuse the same browser context after logout; tenant identity and permissions must be replaced.
  await logoutInBrowser(staff);
  await loginForm(staff, foreignEmail, foreignPassword);
  const foreignMe = await staffContext.request.get('/api/auth/me');
  const foreignPayload = await foreignMe.json();
  const foreignUser = foreignPayload.usuario;
  expect(foreignUser.papel).toBe('DONO');
  expect(foreignPayload.cervejaria.id).not.toBe(ownerTenantId);
  expect((await staffContext.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);
  const foreignList = await staffContext.request.get('/api/usuarios');
  expect(foreignList.status()).toBe(200);
  const foreignUsers = await foreignList.json();
  expect(foreignUsers.some((user: { id: string }) => user.id === process.env.RBAC_QA_STAFF_ID)).toBe(false);

  await Promise.all([ownerContext.close(), staffContext.close(), staffTabContext.close()]);
  expect(baseURL).toBeTruthy();
});

test('agenda.manage blocks, grants and revokes real agenda writes in the live session', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/comandas');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const staffMe = await staffContext.request.get('/api/auth/me');
  expect(staffMe.status()).toBe(200);
  expect((await staffMe.json()).usuario.email).toBe(staffEmail);
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 330 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const existingSchedules = await staffContext.request.get(`/api/operacao/agenda/ocorrencias?inicio=${today}&fim=${horizon}`);
  expect(existingSchedules.status(), await existingSchedules.text()).toBe(200);
  const occupiedDates = new Set((await existingSchedules.json()).ocorrencias.map((item: { data: string }) => item.data));
  let scheduleDate = '';
  for (let offset = 2; offset < 330; offset++) {
    const candidate = new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!occupiedDates.has(candidate)) { scheduleDate = candidate; break; }
  }
  expect(scheduleDate, 'disposable QA tenant must have an unoccupied date for the agenda write').toBeTruthy();
  const range = `inicio=${scheduleDate}&fim=${scheduleDate}`;
  const scheduleUrl = '/api/operacao/agenda/agendamentos';
  const payload = {
    requestId: crypto.randomUUID(), nome: `RBAC QA ${crypto.randomUUID()}`, data: scheduleDate,
    horaInicio: '18:00', horaFim: '19:00', local: null, repetirSemanalmente: false,
  };

  const disabledList = await staffContext.request.get(`/api/operacao/agenda/ocorrencias?${range}`);
  expect(disabledList.status(), await disabledList.text()).toBe(200);
  const before = (await disabledList.json()).ocorrencias.length;
  await staff.goto('/operacao/agenda');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  const deniedWrite = await staffContext.request.post(scheduleUrl, { data: payload });
  expect([401, 403]).toContain(deniedWrite.status());
  const afterDenied = await staffContext.request.get(`/api/operacao/agenda/ocorrencias?${range}`);
  expect((await afterDenied.json()).ocorrencias).toHaveLength(before);

  await setPermissions(ownerContext, ['agenda.manage']);
  await staff.reload();
  await staff.goto('/operacao/agenda');
  await expect(staff.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await staff.getByRole('button', { name: '+ Novo agendamento' }).click();
  await staff.getByLabel('Nome').fill(payload.nome);
  await staff.getByLabel('Data', { exact: true }).fill(scheduleDate);
  await staff.getByLabel('Horário de início').fill(payload.horaInicio);
  await staff.getByLabel('Horário de término').fill(payload.horaFim);
  await staff.getByRole('button', { name: 'Salvar' }).click();
  await expect(staff.getByText(payload.nome, { exact: true })).toBeVisible();
  const saved = await staffContext.request.get(`/api/operacao/agenda/ocorrencias?${range}`);
  expect(saved.status(), await saved.text()).toBe(200);
  const matching = (await saved.json()).ocorrencias.filter((item: { nome: string }) => item.nome === payload.nome);
  expect(matching).toHaveLength(1);
  const savedId = matching[0].id;

  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto('/operacao/agenda');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  const revokedWrite = await staffContext.request.post(scheduleUrl, { data: { ...payload, requestId: crypto.randomUUID(), nome: `${payload.nome} revoked` } });
  expect([401, 403]).toContain(revokedWrite.status());
  const afterRevoke = await staffContext.request.get(`/api/operacao/agenda/ocorrencias?${range}`);
  const finalOccurrences = (await afterRevoke.json()).ocorrencias;
  expect(finalOccurrences.filter((item: { id: string }) => item.id === savedId)).toHaveLength(1);
  expect(finalOccurrences).toHaveLength(before + 1);
  console.log('RBAC_LIVE_REGRESSION key=agenda.manage; disabled=route-and-api-denied-no-write; granted=real-ui-write-persisted; revoked=same-session-route-and-api-denied-no-write; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('command.operate denies, creates through the UI, then denies after same-session revoke', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, ['command.read']);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const staffMe = await staffContext.request.get('/api/auth/me');
  expect(staffMe.status()).toBe(200);
  expect((await staffMe.json()).usuario.permissoesOperacao).toEqual(['command.read']);
  const operationalContext = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContext.status()).toBe(200);
  const pointOfSaleId = (await operationalContext.json()).pontosVenda[0]?.id;
  expect(pointOfSaleId).toBeTruthy();

  const beforeResponse = await ownerContext.request.get(`/api/operacao/comandas?pontoVendaId=${pointOfSaleId}`);
  expect(beforeResponse.status()).toBe(200);
  const beforeCount = (await beforeResponse.json()).length;
  const firstPhone = `119${Math.floor(10000000 + Math.random() * 89999999)}`;
  const firstName = `RBAC command ${crypto.randomUUID()}`;
  const createPayload = { pontoVendaId: pointOfSaleId, tipo: 'APELIDO', identificador: firstName, clienteNome: firstName, clienteTelefone: firstPhone, itens: [] };

  await staff.goto('/operacao/comandas/nova');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  const deniedCreate = await staffContext.request.post('/api/operacao/comandas', { data: createPayload });
  expect([401, 403]).toContain(deniedCreate.status());
  const afterDenied = await ownerContext.request.get(`/api/operacao/comandas?pontoVendaId=${pointOfSaleId}`);
  expect((await afterDenied.json()).length).toBe(beforeCount);

  await setPermissions(ownerContext, ['command.operate', 'command.read']);
  await staff.reload();
  const grantedStaff = await staffContext.request.get('/api/auth/me');
  expect((await grantedStaff.json()).usuario.permissoesOperacao).toEqual(['command.operate', 'command.read']);
  await staff.goto('/operacao/comandas/nova');
  await expect(staff.getByRole('heading', { name: 'Nova comanda' })).toBeVisible();
  await staff.getByPlaceholder('(11) 9 9999-9999').fill(firstPhone);
  await staff.getByPlaceholder('Digite o nome...').fill(firstName);
  const createResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === '/api/operacao/comandas' && response.request().method() === 'POST');
  await staff.getByRole('button', { name: 'Abrir comanda' }).click();
  const createResponse = await createResponsePromise;
  const created = await createResponse.json();
  expect(createResponse.status(), JSON.stringify(created)).toBe(201);
  const commandId = created.id as string;
  await expect.poll(() => new URL(staff.url()).pathname).toBe(`/operacao/comandas/${commandId}`);
  const persistedList = await ownerContext.request.get(`/api/operacao/comandas?pontoVendaId=${pointOfSaleId}`);
  expect(persistedList.status(), await persistedList.text()).toBe(200);
  const persistedCommands = (await persistedList.json()).filter((item: { identificador: string }) => item.identificador === firstName);
  expect(persistedCommands).toHaveLength(1);
  expect(persistedCommands[0]).toMatchObject({ id: commandId, identificador: firstName, status: 'ABERTA' });

  await setPermissions(ownerContext, ['command.read']);
  await staff.reload();
  await staff.goto('/operacao/comandas/nova');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  const secondPayload = { ...createPayload, identificador: `${firstName} denied`, clienteNome: `${firstName} denied`, clienteTelefone: `119${Math.floor(10000000 + Math.random() * 89999999)}` };
  const revokedCreate = await staffContext.request.post('/api/operacao/comandas', { data: secondPayload });
  expect([401, 403]).toContain(revokedCreate.status());
  const afterRevoke = await ownerContext.request.get(`/api/operacao/comandas?pontoVendaId=${pointOfSaleId}`);
  const finalCommands = await afterRevoke.json();
  expect(finalCommands).toHaveLength(beforeCount + 1);
  expect(finalCommands.filter((item: { id: string }) => item.id === commandId)).toHaveLength(1);
  console.log('RBAC_LIVE_REGRESSION key=command.operate; disabled=route-and-api-denied-no-write; granted=real-ui-create-persisted; revoked=same-session-route-and-api-denied-no-write; dependency=command.read; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('reports.read blocks, opens the executive report, and revokes in the live session', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const reportPath = `/eventos/${reportEventId}/resumo`;
  const reportApi = `/api/eventos/${reportEventId}/resumo-executivo`;

  const deniedReport = await staffContext.request.get(reportApi);
  expect([401, 403]).toContain(deniedReport.status());
  await staff.goto(reportPath);
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe(reportPath);

  await setPermissions(ownerContext, ['reports.read']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['reports.read']);
  await staff.goto(reportPath);
  await expect(staff.getByText('Resumo executivo')).toBeVisible();
  const allowedReport = await staffContext.request.get(reportApi);
  expect(allowedReport.status(), await allowedReport.text()).toBe(200);
  const report = await allowedReport.json();
  expect(report.evento.id).toBe(reportEventId);
  const csv = await staffContext.request.get(`/api/relatorios/evento/${reportEventId}/csv`);
  expect(csv.status(), await csv.text()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');

  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto(reportPath);
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe(reportPath);
  expect([401, 403]).toContain((await staffContext.request.get(reportApi)).status());
  expect([401, 403]).toContain((await staffContext.request.get(`/api/relatorios/evento/${reportEventId}/csv`)).status());
  console.log('RBAC_LIVE_REGRESSION key=reports.read; disabled=route-and-api-denied; enabled=executive-report-and-csv-readable; revoked=same-session-route-report-and-csv-denied; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('clients.manage blocks, creates a client through the UI, then denies after same-session revoke', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const key = `RBAC clients ${crypto.randomUUID()}`;
  const phone = `119${Math.floor(10000000 + Math.random() * 89999999)}`;
  const payload = { nome: key, telefone: phone };
  const query = encodeURIComponent(key);
  const listUrl = `/api/clientes?q=${query}`;

  await staff.goto('/clientes/novo');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/clientes/novo');
  await expect(staff.getByRole('heading', { name: 'Novo cliente' })).toHaveCount(0);
  const deniedCreate = await staffContext.request.post('/api/clientes', { data: payload });
  expect([401, 403]).toContain(deniedCreate.status());
  const afterDenied = await ownerContext.request.get(listUrl);
  expect(afterDenied.status()).toBe(200);
  expect((await afterDenied.json()).items).toHaveLength(0);

  await setPermissions(ownerContext, ['clients.manage']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['clients.manage']);
  await staff.goto('/clientes/novo');
  await expect(staff.getByRole('heading', { name: 'Novo cliente' })).toBeVisible();
  await staff.locator('input').nth(0).fill(key);
  await staff.getByPlaceholder('(11) 9 9999-9999').fill(phone);
  const createResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === '/api/clientes' && response.request().method() === 'POST');
  await staff.getByRole('button', { name: 'Cadastrar cliente' }).click();
  const createResponse = await createResponsePromise;
  const created = await createResponse.json();
  expect(createResponse.status(), JSON.stringify(created)).toBe(201);
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/clientes');
  const persisted = await ownerContext.request.get(listUrl);
  expect(persisted.status(), await persisted.text()).toBe(200);
  const matches = (await persisted.json()).items.filter((item: { nome: string; telefone: string }) => item.nome === key);
  expect(matches).toHaveLength(1);
  expect(created.id).toBe(matches[0].id);
  expect(matches[0].telefone.replace(/\D/g, '')).toBe(phone);

  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto('/clientes/novo');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/clientes/novo');
  await expect(staff.getByRole('heading', { name: 'Novo cliente' })).toHaveCount(0);
  const revokedCreate = await staffContext.request.post('/api/clientes', { data: { ...payload, nome: `${key} revoked`, telefone: `119${Math.floor(10000000 + Math.random() * 89999999)}` } });
  expect([401, 403]).toContain(revokedCreate.status());
  const afterRevoke = await ownerContext.request.get(listUrl);
  const finalMatches = (await afterRevoke.json()).items.filter((item: { nome: string }) => item.nome === key);
  expect(finalMatches).toHaveLength(1);
  console.log('RBAC_LIVE_REGRESSION key=clients.manage; disabled=route-and-api-denied-no-write; enabled=real-ui-create-persisted; revoked=same-session-route-and-api-denied-no-write; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('inventory.read blocks, exposes stock read-only, and revokes in the live session', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const operationalContext = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContext.status()).toBe(200);
  const pointOfSaleId = (await operationalContext.json()).pontosVenda[0]?.id;
  expect(pointOfSaleId).toBeTruthy();
  const inventoryUrl = `/api/operacao/estoque?pontoVendaId=${pointOfSaleId}`;
  const entryUrl = '/api/operacao/estoque/entrada';
  const before = await ownerContext.request.get(inventoryUrl);
  expect(before.status(), await before.text()).toBe(200);
  const beforeBalances = await before.json();
  expect(beforeBalances.some((item: { produtoId: string }) => item.produtoId === inventoryProductId)).toBe(true);
  const deniedEntry = await staffContext.request.post(entryUrl, { data: { pontoVendaId: pointOfSaleId, produtoId: inventoryProductId, quantidade: 1, observacao: 'disabled read-only QA probe' } });
  expect([401, 403]).toContain(deniedEntry.status());
  await staff.goto('/operacao/estoque');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/operacao/estoque');
  await expect(staff.getByRole('heading', { name: 'Estoque' })).toHaveCount(0);
  const afterDenied = await ownerContext.request.get(inventoryUrl);
  expect(await afterDenied.json()).toEqual(beforeBalances);

  await setPermissions(ownerContext, ['inventory.read']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['inventory.read']);
  const allowedRead = await staffContext.request.get(inventoryUrl);
  expect(allowedRead.status(), await allowedRead.text()).toBe(200);
  const readableBalances = await allowedRead.json();
  expect(readableBalances.some((item: { produtoId: string }) => item.produtoId === inventoryProductId)).toBe(true);
  const readOnlyEntry = await staffContext.request.post(entryUrl, { data: { pontoVendaId: pointOfSaleId, produtoId: inventoryProductId, quantidade: 1, observacao: 'read-only QA probe' } });
  expect([401, 403]).toContain(readOnlyEntry.status());
  await staff.goto('/operacao/estoque');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/estoque');
  await expect(staff.getByText(inventoryProductName, { exact: true })).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Repor' })).toHaveCount(0);

  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto('/operacao/estoque');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/operacao/estoque');
  expect([401, 403]).toContain((await staffContext.request.get(inventoryUrl)).status());
  const revokedEntry = await staffContext.request.post(entryUrl, { data: { pontoVendaId: pointOfSaleId, produtoId: inventoryProductId, quantidade: 1, observacao: 'revoked read QA probe' } });
  expect([401, 403]).toContain(revokedEntry.status());
  const afterRevoke = await ownerContext.request.get(inventoryUrl);
  expect(await afterRevoke.json()).toEqual(beforeBalances);
  console.log('RBAC_LIVE_REGRESSION key=inventory.read; disabled=route-and-api-denied-no-write; enabled=real-ui-stock-read-only; inventory.adjust=absent-and-entry-denied; revoked=same-session-route-and-api-denied-no-write; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('inventory.adjust denies, changes stock through the UI, and denies after same-session revoke', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, ['inventory.read']);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const operationalContext = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContext.status()).toBe(200);
  const pointOfSaleId = (await operationalContext.json()).pontosVenda[0]?.id;
  expect(pointOfSaleId).toBeTruthy();
  const inventoryUrl = `/api/operacao/estoque?pontoVendaId=${pointOfSaleId}`;
  const entryUrl = '/api/operacao/estoque/entrada';
  const beforeResponse = await ownerContext.request.get(inventoryUrl);
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const before = await beforeResponse.json();
  const beforeProduct = before.find((item: { produtoId: string }) => item.produtoId === inventoryProductId);
  expect(beforeProduct).toBeTruthy();
  const deniedEntry = await staffContext.request.post(entryUrl, { data: { pontoVendaId: pointOfSaleId, produtoId: inventoryProductId, quantidade: 1, observacao: 'adjust disabled QA probe' } });
  expect([401, 403]).toContain(deniedEntry.status());
  await staff.goto('/operacao/estoque');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/estoque');
  await expect(staff.getByText(inventoryProductName, { exact: true })).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Repor' })).toHaveCount(0);
  expect(await (await ownerContext.request.get(inventoryUrl)).json()).toEqual(before);

  await setPermissions(ownerContext, ['inventory.read', 'inventory.adjust']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['inventory.read', 'inventory.adjust']);
  await staff.goto('/operacao/estoque');
  const stockCard = staff.locator('main .card-touch').filter({ has: staff.getByText(inventoryProductName, { exact: true }) }).first();
  await expect(stockCard.getByRole('button', { name: 'Repor' })).toBeVisible();
  await stockCard.getByRole('button', { name: 'Repor' }).click();
  const replenishDialog = staff.getByRole('dialog');
  await expect(replenishDialog).toBeVisible();
  await replenishDialog.locator('input').nth(0).fill('1');
  await replenishDialog.locator('input').nth(1).fill('authorized live RBAC adjustment');
  const entryResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === entryUrl && response.request().method() === 'POST');
  await replenishDialog.getByRole('button', { name: 'Confirmar reposição' }).click();
  const entryResponse = await entryResponsePromise;
  expect(entryResponse.status(), await entryResponse.text()).toBe(201);
  const entryBalances = await entryResponse.json();
  const entryProduct = entryBalances.find((item: { produtoId: string }) => item.produtoId === inventoryProductId);
  expect(Number(entryProduct.quantidade)).toBe(Number(beforeProduct.quantidade) + 1);
  const afterGrant = await ownerContext.request.get(inventoryUrl);
  expect(afterGrant.status()).toBe(200);
  const grantedBalances = await afterGrant.json();
  const grantedProduct = grantedBalances.find((item: { produtoId: string }) => item.produtoId === inventoryProductId);
  expect(Number(grantedProduct.quantidade)).toBe(Number(beforeProduct.quantidade) + 1);

  await setPermissions(ownerContext, ['inventory.read']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['inventory.read']);
  await staff.goto('/operacao/estoque');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/estoque');
  await expect(staff.getByText(inventoryProductName, { exact: true })).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Repor' })).toHaveCount(0);
  const revokedEntry = await staffContext.request.post(entryUrl, { data: { pontoVendaId: pointOfSaleId, produtoId: inventoryProductId, quantidade: 1, observacao: 'revoked adjust QA probe' } });
  expect([401, 403]).toContain(revokedEntry.status());
  expect(await (await ownerContext.request.get(inventoryUrl)).json()).toEqual(grantedBalances);
  console.log('RBAC_LIVE_REGRESSION key=inventory.adjust; dependency=inventory.read retained; disabled=button-hidden-and-api-denied-no-write; enabled=real-ui-entry-persisted; revoked=button-hidden-and-api-denied-with-read-retained; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('kitchen.read blocks, shows the real queue read-only, and revokes in the live session', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const queueUrl = '/api/operacao/cozinha';
  const statusUrl = `/api/operacao/cozinha/${kitchenOrderId}/status`;
  const deniedQueue = await staffContext.request.get(queueUrl);
  expect([401, 403]).toContain(deniedQueue.status());
  await staff.goto('/operacao/cozinha');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/operacao/cozinha');
  const deniedStatus = await staffContext.request.patch(statusUrl, { data: { status: 'EM_PREPARO' } });
  expect([401, 403]).toContain(deniedStatus.status());

  await setPermissions(ownerContext, ['kitchen.read']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['kitchen.read']);
  const allowedQueue = await staffContext.request.get(queueUrl);
  expect(allowedQueue.status(), await allowedQueue.text()).toBe(200);
  const queue = await allowedQueue.json();
  expect(queue.some((order: { id: string }) => order.id === kitchenOrderId)).toBe(true);
  await staff.goto('/operacao/cozinha');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/cozinha');
  const visibleKitchenOrder = staff.locator('article:visible').filter({ hasText: kitchenCommandIdentifier }).first();
  await expect(visibleKitchenOrder).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Iniciar' })).toHaveCount(0);
  const readOnlyStatus = await staffContext.request.patch(statusUrl, { data: { status: 'EM_PREPARO' } });
  expect([401, 403]).toContain(readOnlyStatus.status());

  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto('/operacao/cozinha');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/operacao/cozinha');
  expect([401, 403]).toContain((await staffContext.request.get(queueUrl)).status());
  const revokedStatus = await staffContext.request.patch(statusUrl, { data: { status: 'EM_PREPARO' } });
  expect([401, 403]).toContain(revokedStatus.status());
  console.log('RBAC_LIVE_REGRESSION key=kitchen.read; disabled=route-and-queue-denied; enabled=real-queue-visible; kitchen.operate=absent-button-and-status-denied; revoked=same-session-route-queue-and-status-denied; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('kitchen.operate denies, advances the queue through the UI, and denies after same-session revoke', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, ['kitchen.read']);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const queueUrl = '/api/operacao/cozinha';
  const statusUrl = `/api/operacao/cozinha/${kitchenOrderId}/status`;
  const deniedStatus = await staffContext.request.patch(statusUrl, { data: { status: 'EM_PREPARO' } });
  expect([401, 403]).toContain(deniedStatus.status());
  await staff.goto('/operacao/cozinha');
  const visibleKitchenOrder = staff.locator('article:visible').filter({ hasText: kitchenCommandIdentifier }).first();
  await expect(visibleKitchenOrder).toBeVisible();
  await expect(visibleKitchenOrder.getByRole('button', { name: 'Iniciar' })).toHaveCount(0);

  await setPermissions(ownerContext, ['kitchen.read', 'kitchen.operate']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['kitchen.read', 'kitchen.operate']);
  await staff.goto('/operacao/cozinha');
  const allowedCard = staff.locator('article:visible').filter({ hasText: kitchenCommandIdentifier }).first();
  await expect(allowedCard.getByRole('button', { name: 'Iniciar' })).toBeVisible();
  const advanceResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === statusUrl && response.request().method() === 'PATCH');
  await allowedCard.getByRole('button', { name: 'Iniciar' }).click();
  const advanceResponse = await advanceResponsePromise;
  expect(advanceResponse.status(), await advanceResponse.text()).toBe(200);
  const allowedQueue = await staffContext.request.get(queueUrl);
  const advanced = (await allowedQueue.json()).find((order: { id: string }) => order.id === kitchenOrderId);
  expect(advanced.status).toBe('EM_PREPARO');
  await expect(allowedCard.getByRole('button', { name: 'Pronto' })).toBeVisible();

  await setPermissions(ownerContext, ['kitchen.read']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['kitchen.read']);
  await staff.goto('/operacao/cozinha');
  const revokedCard = staff.locator('article:visible').filter({ hasText: kitchenCommandIdentifier }).first();
  await expect(revokedCard).toBeVisible();
  await expect(revokedCard.getByRole('button', { name: 'Pronto' })).toHaveCount(0);
  const revokedAdvance = await staffContext.request.patch(statusUrl, { data: { status: 'PRONTO', expectedStatus: 'EM_PREPARO' } });
  expect([401, 403]).toContain(revokedAdvance.status());
  const finalQueue = await staffContext.request.get(queueUrl);
  expect((await finalQueue.json()).find((order: { id: string }) => order.id === kitchenOrderId).status).toBe('EM_PREPARO');
  console.log('RBAC_LIVE_REGRESSION key=kitchen.operate; dependency=kitchen.read retained; disabled=button-and-status-api-denied; enabled=real-ui-advance-persisted; revoked=same-session-button-and-status-api-denied-with-read-retained; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('cash.movement.write denies, records exact cash movements through the UI, and denies after revoke', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const operationalContext = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContext.status()).toBe(200);
  const pointOfSaleId = (await operationalContext.json()).pontosVenda[0]?.id;
  expect(pointOfSaleId).toBeTruthy();
  const cashUrl = `/api/operacao/caixa?pontoVendaId=${pointOfSaleId}`;
  const beforeResponse = await ownerContext.request.get(cashUrl);
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.sessao?.status).toBe('ABERTO');
  const movementsBefore = before.sessao.movimentos.length;
  const movementUrl = '/api/operacao/caixa/movimentos';
  const probe = { pontoVendaId: pointOfSaleId, tipo: 'SUPRIMENTO', valor: 12.34, observacao: 'disabled movement QA' };

  await expect(staff.getByRole('button', { name: 'Suprimento' })).toHaveCount(0);
  await expect(staff.getByRole('button', { name: 'Sangria' })).toHaveCount(0);
  const deniedMovement = await staffContext.request.post(movementUrl, { data: probe });
  expect([401, 403]).toContain(deniedMovement.status());
  expect(await (await ownerContext.request.get(cashUrl)).json()).toEqual(before);

  await setPermissions(ownerContext, ['cash.movement.write']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['cash.movement.write']);
  for (const [label, value, observation] of [['Suprimento', '12,34', 'authorized supply QA'], ['Sangria', '3,21', 'authorized withdrawal QA']]) {
    await staff.getByRole('button', { name: label, exact: true }).click();
    const dialog = staff.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input').nth(0).fill(value);
    await dialog.locator('input').nth(1).fill(observation);
    const responsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === movementUrl && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    const response = await responsePromise;
    expect(response.status(), await response.text()).toBe(201);
    const safeResponse = await response.json();
    expect(safeResponse.valoresRestritos).toBe(true);
    expect(JSON.stringify(safeResponse)).not.toContain(value.replace(',', '.'));
  }
  const afterGrantResponse = await ownerContext.request.get(cashUrl);
  const afterGrant = await afterGrantResponse.json();
  expect(afterGrant.sessao.movimentos).toHaveLength(movementsBefore + 2);
  expect(afterGrant.sessao.movimentos.filter((item: { observacao: string }) => ['authorized supply QA', 'authorized withdrawal QA'].includes(item.observacao))).toMatchObject([
    expect.objectContaining({ observacao: 'authorized supply QA' }),
    expect.objectContaining({ observacao: 'authorized withdrawal QA' }),
  ]);
  expect(afterGrant.sessao.gaveta.suprimentos).toBeCloseTo(Number(before.sessao.gaveta.suprimentos) + 12.34, 2);
  expect(afterGrant.sessao.gaveta.sangrias).toBeCloseTo(Number(before.sessao.gaveta.sangrias) + 3.21, 2);

  await setPermissions(ownerContext, []);
  await staff.reload();
  await expect(staff.getByRole('button', { name: 'Suprimento' })).toHaveCount(0);
  await expect(staff.getByRole('button', { name: 'Sangria' })).toHaveCount(0);
  const revokedMovement = await staffContext.request.post(movementUrl, { data: { ...probe, observacao: 'revoked movement QA' } });
  expect([401, 403]).toContain(revokedMovement.status());
  expect(await (await ownerContext.request.get(cashUrl)).json()).toEqual(afterGrant);
  console.log('RBAC_LIVE_REGRESSION key=cash.movement.write; disabled=buttons-hidden-and-api-denied-no-write; enabled=real-ui-supply-and-withdrawal-redacted-response-and-exact-persisted-effects; revoked=same-session-buttons-hidden-and-api-denied-no-write; cash.values.read=absent; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('catalog.manage blocks, creates an operational product through the UI, and denies after revoke', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, []);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const operationalContext = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContext.status()).toBe(200);
  const pointOfSaleId = (await operationalContext.json()).pontosVenda[0]?.id;
  expect(pointOfSaleId).toBeTruthy();
  const key = `RBAC catalog ${crypto.randomUUID()}`;
  const productApi = '/api/operacao/produtos';
  const payload = { nome: key, categoria: 'Bebidas', tipo: 'BEBIDA', precoUnit: 7.25, exigePreparo: false, controlaEstoque: false };
  const before = await ownerContext.request.get(`${productApi}?incluirInativos=true`);
  expect(before.status(), await before.text()).toBe(200);
  const beforeProducts = await before.json();

  await staff.goto('/operacao/catalogo');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/operacao/catalogo');
  const deniedCreate = await staffContext.request.post(productApi, { data: payload });
  expect([401, 403]).toContain(deniedCreate.status());
  expect(await (await ownerContext.request.get(`${productApi}?incluirInativos=true`)).json()).toEqual(beforeProducts);

  await setPermissions(ownerContext, ['catalog.manage']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['catalog.manage']);
  await staff.goto('/operacao/catalogo');
  await expect(staff.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  await staff.getByRole('button', { name: '+ Produto' }).click();
  await expect(staff.getByRole('dialog')).toBeVisible();
  await staff.locator('#produto-pdv-nome').fill(key);
  await staff.locator('#produto-pdv-preco').fill('7,25');
  const createResponsePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === productApi && response.request().method() === 'POST');
  await staff.getByRole('button', { name: 'Salvar' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created = await createResponse.json();
  const persistedResponse = await ownerContext.request.get(`${productApi}?incluirInativos=true`);
  const persisted = (await persistedResponse.json()).filter((product: { id: string; nome: string; precoUnit: string }) => product.id === created.id && product.nome === key);
  expect(persisted).toHaveLength(1);
  expect(Number(persisted[0].precoUnit)).toBe(7.25);
  expect(persisted[0].ativo).toBe(true);

  await setPermissions(ownerContext, []);
  await staff.reload();
  await staff.goto('/operacao/catalogo');
  await expect.poll(() => new URL(staff.url()).pathname).not.toBe('/operacao/catalogo');
  const revokedCreate = await staffContext.request.post(productApi, { data: { ...payload, nome: `${key} revoked` } });
  expect([401, 403]).toContain(revokedCreate.status());
  const finalProducts = await (await ownerContext.request.get(`${productApi}?incluirInativos=true`)).json();
  expect(finalProducts).toHaveLength(beforeProducts.length + 1);
  expect(finalProducts.filter((product: { id: string }) => product.id === created.id)).toHaveLength(1);
  console.log('RBAC_LIVE_REGRESSION key=catalog.manage; disabled=route-and-create-api-denied-no-write; enabled=real-ui-product-create-persisted; revoked=same-session-route-and-create-api-denied-no-write; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('catalog.shift.manage permits only the live shift price and preserves the global template price', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: ownerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/operacao/caixa');
  expect((await ownerContext.request.get('/api/auth/me')).status()).toBe(200);
  await setPermissions(ownerContext, ['cash.values.read']);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: staffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await staff.goto('/operacao/caixa');
  const operationalContext = await staffContext.request.get('/api/operacao/contexto');
  expect(operationalContext.status()).toBe(200);
  const pointOfSaleId = (await operationalContext.json()).pontosVenda[0]?.id;
  expect(pointOfSaleId).toBeTruthy();
  const cardApi = `/api/operacao/caixa/cardapio?pontoVendaId=${pointOfSaleId}`;
  const priceApi = `/api/operacao/caixa/cardapio/preco?pontoVendaId=${pointOfSaleId}`;
  const productCatalogApi = '/api/operacao/produtos?incluirInativos=true';
  const catalogBeforeResponse = await ownerContext.request.get(productCatalogApi);
  expect(catalogBeforeResponse.status(), await catalogBeforeResponse.text()).toBe(200);
  const catalogBefore = await catalogBeforeResponse.json();
  const catalogProductBefore = catalogBefore.find((product: { id: string }) => product.id === inventoryProductId);
  expect(catalogProductBefore).toBeTruthy();
  const templateBefore = Number(catalogProductBefore.precoUnit);
  const cardBeforeResponse = await ownerContext.request.get(cardApi);
  expect(cardBeforeResponse.status(), await cardBeforeResponse.text()).toBe(200);
  const cardBefore = await cardBeforeResponse.json();
  const targetBefore = cardBefore.produtos.find((product: { id: string }) => product.id === inventoryProductId);
  expect(targetBefore).toBeTruthy();
  const turnBefore = Number(targetBefore.precoEfetivo ?? targetBefore.precoUnit);
  expect(turnBefore).toBeGreaterThan(0);
  const deniedPayload = { produtoId: inventoryProductId, volumeMl: 0, precoUnit: turnBefore + 2, escopo: 'TURNO' };

  expect([401, 403]).toContain((await staffContext.request.patch(priceApi, { data: deniedPayload })).status());
  await expect(staff.getByRole('button', { name: 'Editar cardápio do turno' })).toHaveCount(0);
  const unchangedDenied = await (await ownerContext.request.get(cardApi)).json();
  expect(unchangedDenied).toEqual(cardBefore);

  await setPermissions(ownerContext, ['cash.values.read', 'catalog.shift.manage']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['cash.values.read', 'catalog.shift.manage']);
  const targetRow = staff.getByText(inventoryProductName, { exact: true }).locator('..').locator('..');
  const priceInput = targetRow.locator('input').first();
  await expect(priceInput).toBeVisible();
  await priceInput.fill((turnBefore + 2).toFixed(2).replace('.', ','));
  await priceInput.blur();
  const confirmModal = staff.getByRole('dialog').filter({ hasText: inventoryProductName });
  await expect(confirmModal).toBeVisible();
  await expect(confirmModal.getByRole('button', { name: 'Só neste turno' })).toBeVisible();
  await expect(confirmModal.getByRole('button', { name: /Salvar no cardápio/ })).toHaveCount(0);
  const updatePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === '/api/operacao/caixa/cardapio/preco' && response.request().method() === 'PATCH');
  await confirmModal.getByRole('button', { name: 'Só neste turno' }).click();
  const update = await updatePromise;
  expect(update.status(), await update.text()).toBe(200);
  const afterGrant = await (await ownerContext.request.get(cardApi)).json();
  const targetAfter = afterGrant.produtos.find((product: { id: string }) => product.id === inventoryProductId);
  expect(Number(targetAfter.precoEfetivo)).toBe(turnBefore + 2);
  const catalogAfter = await (await ownerContext.request.get(productCatalogApi)).json();
  expect(Number(catalogAfter.find((product: { id: string }) => product.id === inventoryProductId).precoUnit)).toBe(templateBefore);

  await setPermissions(ownerContext, ['cash.values.read']);
  await staff.reload();
  const readOnlyTarget = staff.getByText(inventoryProductName, { exact: true }).locator('..').locator('..');
  await expect(readOnlyTarget.locator('input')).toHaveCount(0);
  expect([401, 403]).toContain((await staffContext.request.patch(priceApi, { data: { ...deniedPayload, precoUnit: turnBefore + 3 } })).status());
  const afterRevoke = await (await ownerContext.request.get(cardApi)).json();
  const targetFinal = afterRevoke.produtos.find((product: { id: string }) => product.id === inventoryProductId);
  expect(Number(targetFinal.precoEfetivo)).toBe(turnBefore + 2);
  const catalogFinal = await (await ownerContext.request.get(productCatalogApi)).json();
  expect(Number(catalogFinal.find((product: { id: string }) => product.id === inventoryProductId).precoUnit)).toBe(templateBefore);
  console.log('RBAC_LIVE_REGRESSION key=catalog.shift.manage; cash.values.read=retained-as-screen-read-dependency; disabled=price-write-denied-no-mutation; enabled=UI-turn-price-only-change; catalog.manage=absent-template-option-hidden-and-global-price-unchanged; revoked=same-session-price-edit-hidden-and-api-denied; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('event.menu.manage controls the event menu editor and persists changes only while granted', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/eventos');
  const ownerMe = await ownerContext.request.get('/api/auth/me');
  expect(ownerMe.status()).toBe(200);
  const ownerTenantId = (await ownerMe.json()).cervejaria.id;
  const menuUrl = `/api/eventos/${eventMenuEventId}/cardapio`;
  const beforeResponse = await ownerContext.request.get(menuUrl);
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.produtoIds).toEqual([]);
  const adminUrl = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  const setMenuPermissions = async (permissoesOperacao: string[]) => {
    const response = await ownerContext.request.patch(adminUrl, { data: { permissoesOperacao } });
    expect(response.status(), await response.text()).toBe(200);
  };
  await setMenuPermissions([]);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  const modeContext = await staffContext.request.get('/api/operacao/contexto');
  expect(modeContext.status(), await modeContext.text()).toBe(200);
  const mode = await modeContext.json();
  expect(mode.operationMode).toBe('EVENTO');
  expect(mode.operationalSettingsSource).toBe('LEGACY');
  await staff.goto('/eventos');
  const disabledStaffMe = await (await staffContext.request.get('/api/auth/me')).json();
  expect(disabledStaffMe.usuario.permissoesOperacao).toEqual([]);
  expect(disabledStaffMe.cervejaria.id).toBe(ownerTenantId);
  const eventCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  await expect(eventCard).toBeVisible();
  await expect(eventCard.locator('button[aria-label*="card"]')).toHaveCount(0);
  const denied = await staffContext.request.put(menuUrl, { data: { produtoIds: [eventMenuForeignProductId] } });
  expect([401, 403]).toContain(denied.status());
  expect(await (await ownerContext.request.get(menuUrl)).json()).toEqual(before);

  await setMenuPermissions(['event.menu.manage']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['event.menu.manage']);
  const grantedCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  const editorButton = grantedCard.locator('button[aria-label*="card"]');
  await expect(editorButton).toHaveCount(1);
  await editorButton.click();
  const dialog = staff.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Montar manual/ }).click();
  await expect(dialog.getByText(eventMenuForeignProductName, { exact: true })).toBeVisible();
  await dialog.locator('label').filter({ hasText: eventMenuForeignProductName }).locator('input[type="checkbox"]').check();
  const savePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === menuUrl && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: /Salvar card/ }).click();
  const saved = await savePromise;
  expect(saved.status(), await saved.text()).toBe(200);
  const afterGrant = await (await ownerContext.request.get(menuUrl)).json();
  expect(afterGrant.produtoIds).toEqual([eventMenuForeignProductId]);
  expect(afterGrant.produtos.map((produto: { id: string }) => produto.id)).toEqual([eventMenuForeignProductId]);

  await setMenuPermissions([]);
  await staff.reload();
  const revokedCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  await expect(revokedCard.locator('button[aria-label*="card"]')).toHaveCount(0);
  const revoked = await staffContext.request.put(menuUrl, { data: { produtoIds: [] } });
  expect([401, 403]).toContain(revoked.status());
  expect(await (await ownerContext.request.get(menuUrl)).json()).toEqual(afterGrant);
  console.log('RBAC_LIVE_REGRESSION key=event.menu.manage; dependency=none; disabled=editor-hidden-and-direct-write-denied-no-mutation; enabled=real-ui-menu-change-persisted; revoked=same-session-editor-hidden-and-direct-write-denied; event-mode=LEGACY; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});

test('event.dashboard.read reveals and revokes event KPIs without changing command access', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  await owner.goto('/eventos');
  const permissionApiForEventStaff = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  const setEventStaffPermissions = async (permissoesOperacao: string[]) => {
    const response = await ownerContext.request.patch(permissionApiForEventStaff, { data: { permissoesOperacao } });
    expect(response.status(), await response.text()).toBe(200);
  };
  const dashboardUrl = `/api/eventos/${eventMenuEventId}/dashboard`;
  const baselineResponse = await ownerContext.request.get(dashboardUrl);
  expect(baselineResponse.status(), await baselineResponse.text()).toBe(200);
  const baseline = await baselineResponse.json();
  await setEventStaffPermissions(['command.read']);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  const modeResponse = await staffContext.request.get('/api/operacao/contexto');
  expect(modeResponse.status(), await modeResponse.text()).toBe(200);
  const mode = await modeResponse.json();
  expect(mode.operationMode).toBe('EVENTO');
  expect(mode.operationalSettingsSource).toBe('LEGACY');
  const disabledMe = await (await staffContext.request.get('/api/auth/me')).json();
  expect(disabledMe.usuario.permissoesOperacao).toEqual(['command.read']);
  const deniedDashboard = await staffContext.request.get(dashboardUrl);
  expect([401, 403]).toContain(deniedDashboard.status());
  const disabledCommands = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  expect(disabledCommands.status(), await disabledCommands.text()).toBe(200);
  await staff.goto('/eventos');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/eventos');
  const eventCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  await expect(eventCard.getByText('Comandas abertas', { exact: true })).toHaveCount(0);
  const openCommandsValue = () => eventCard.getByText('Comandas abertas', { exact: true }).locator('..').locator('p').nth(1);

  await setEventStaffPermissions(['command.read', 'event.dashboard.read']);
  await staff.reload();
  expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['command.read', 'event.dashboard.read']);
  const grantedDashboard = await staffContext.request.get(dashboardUrl);
  expect(grantedDashboard.status(), await grantedDashboard.text()).toBe(200);
  const grantedProjection = await grantedDashboard.json();
  expect(grantedProjection).toEqual(baseline);
  await expect(eventCard.getByText('Comandas abertas', { exact: true })).toBeVisible();
  await expect(openCommandsValue()).toHaveText(String(baseline.resumo.comandasAbertas));

  await setEventStaffPermissions(['command.read']);
  await staff.reload();
  const revokedDashboard = await staffContext.request.get(dashboardUrl);
  expect([401, 403]).toContain(revokedDashboard.status());
  const commandAccessAfterRevoke = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  expect(commandAccessAfterRevoke.status(), await commandAccessAfterRevoke.text()).toBe(200);
  await expect(eventCard.getByText('Comandas abertas', { exact: true })).toHaveCount(0);
  console.log('RBAC_LIVE_REGRESSION key=event.dashboard.read; dependency=command.read retained; disabled=event-dashboard-api-denied-kpis-hidden-command-read-works; enabled=event-kpis-visible-and-api-projection-matches-owner; revoked=same-session-kpis-hidden-dashboard-denied-command-read-remains; event-mode=LEGACY; result=PASS');
  await Promise.all([ownerContext.close(), staffContext.close()]);
});
