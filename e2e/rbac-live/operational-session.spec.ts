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
  const logoutStatus = await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })).status);
  expect(logoutStatus).toBe(200);
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === 'token')).toBe(false);
  const anonymousStatus = await page.evaluate(async () => (await fetch('/api/auth/me')).status);
  expect(anonymousStatus).toBe(401);
}

async function loginForm(page: Page, email: string, password: string) {
  await page.goto('/login');
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

test('real login, live grant and revoke, same-user sessions, tenant switch, and mobile layouts', async ({ browser, baseURL }) => {
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
  await setPermissions(ownerContext, [permission]);

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await loginForm(staff, staffEmail, staffPassword);
  const staffTabContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const staffTab = await staffTabContext.newPage();
  await loginForm(staffTab, staffEmail, staffPassword);
  expect((await staffContext.cookies()).some((cookie) => cookie.name === 'token')).toBe(true);
  expect((await staffTabContext.cookies()).some((cookie) => cookie.name === 'token')).toBe(true);
  const initialMe = await staffContext.request.get('/api/auth/me');
  expect((await initialMe.json()).usuario.permissoesOperacao).toContain(permission);
  await staff.reload();
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/comandas');
  const grantedMe = await staffContext.request.get('/api/auth/me');
  expect((await grantedMe.json()).usuario.permissoesOperacao).toContain(permission);
  const allowedApi = await staffContext.request.get('/api/operacao/comandas');
  expect(allowedApi.status(), await allowedApi.text()).toBe(200);
  for (const page of [staff, staffTab]) {
    await page.goto('/operacao/comandas');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/operacao/comandas');
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `horizontal overflow at ${dimensions.width}px`).toBeLessThanOrEqual(dimensions.width);
  }

  const uiErrors: string[] = [];
  staff.on('pageerror', (error) => uiErrors.push(error.message));
  staff.on('console', (message) => { if (message.type() === 'error') uiErrors.push(message.text()); });
  await setPermissions(ownerContext, []);
  const revokedApi = await staffContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(revokedApi.status());
  await staff.reload();
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  await expect.poll(() => uiErrors.some((message) => message.includes('esperadoDinheiro'))).toBe(true);
  console.log('RBAC_LIVE_PRODUCT_DEFECT key=command.read; fallback=/operacao/caixa; error=esperadoDinheiro; result=FAIL reproduced');
  expect((await staffContext.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);

  await setPermissions(ownerContext, [permission]);
  await staff.reload();
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
