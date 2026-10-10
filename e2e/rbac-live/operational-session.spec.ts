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
    await page.goto('/login').catch(async (error) => {
      if (new URL(page.url()).pathname !== '/login') throw error;
    });
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
