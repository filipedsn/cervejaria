import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ownerEmail = process.env.RBAC_QA_OWNER_EMAIL!;
const ownerPassword = process.env.RBAC_QA_OWNER_PASSWORD!;
const staffEmail = process.env.RBAC_QA_STAFF_EMAIL!;
const staffPassword = process.env.RBAC_QA_STAFF_PASSWORD!;
const foreignEmail = process.env.RBAC_QA_FOREIGN_OWNER_EMAIL!;
const foreignPassword = process.env.RBAC_QA_FOREIGN_OWNER_PASSWORD!;
const permissionApi = `/api/usuarios/${process.env.RBAC_QA_STAFF_ID}/permissoes-operacao`;
const permission = 'command.read';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByLabel('E-mail')).toBeVisible({ timeout: 15_000 }).catch(async (error) => {
    const body = await page.locator('body').innerText().catch(() => 'unavailable');
    throw new Error(`Login page did not render at ${page.url()}: ${body.slice(0, 500)}; ${error.message}`);
  });
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await expect.poll(async () => (await page.request.get('/api/auth/me')).status()).toBe(200);
}

async function setPermissions(context: BrowserContext, permissions: string[]) {
  const response = await context.request.patch(permissionApi, { data: { permissoesOperacao: permissions } });
  expect(response.status(), await response.text()).toBe(200);
}

test('real login, live grant and revoke, same-user sessions, tenant switch, and mobile layouts', async ({ browser, baseURL }) => {
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await ownerContext.newPage();
  await login(owner, ownerEmail, ownerPassword);
  const ownerMe = await ownerContext.request.get('/api/auth/me');
  expect(ownerMe.status()).toBe(200);
  const ownerUser = (await ownerMe.json()).usuario;
  expect(ownerUser.papel).toBe('DONO');

  const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await login(staff, staffEmail, staffPassword);
  const staffTabContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const staffTab = await staffTabContext.newPage();
  await login(staffTab, staffEmail, staffPassword);
  const initialMe = await staffContext.request.get('/api/auth/me');
  expect((await initialMe.json()).usuario.permissoesOperacao).not.toContain(permission);
  const deniedApi = await staffContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(deniedApi.status());
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');

  // The owner grants via the real administrative endpoint while both staff sessions stay open.
  await setPermissions(ownerContext, [permission]);
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

  await setPermissions(ownerContext, []);
  const revokedApi = await staffContext.request.get('/api/operacao/comandas');
  expect([401, 403]).toContain(revokedApi.status());
  await staff.reload();
  await staff.goto('/operacao/comandas');
  await expect.poll(() => new URL(staff.url()).pathname).toBe('/operacao/caixa');
  expect((await staffContext.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);

  // Reuse the same browser context after logout; tenant identity and permissions must be replaced.
  await staff.getByRole('button', { name: 'Abrir conta' }).click();
  await staff.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(staff).toHaveURL(/\/login$/);
  await login(staff, foreignEmail, foreignPassword);
  const foreignMe = await staffContext.request.get('/api/auth/me');
  const foreignUser = (await foreignMe.json()).usuario;
  expect(foreignUser.papel).toBe('DONO');
  expect(foreignUser.cervejariaId).not.toBe(ownerUser.cervejariaId);
  expect((await staffContext.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);
  const foreignList = await staffContext.request.get('/api/usuarios');
  expect(foreignList.status()).toBe(200);
  const foreignUsers = await foreignList.json();
  expect(foreignUsers.some((user: { id: string }) => user.id === process.env.RBAC_QA_STAFF_ID)).toBe(false);

  await Promise.all([ownerContext.close(), staffContext.close(), staffTabContext.close()]);
  expect(baseURL).toBeTruthy();
});
